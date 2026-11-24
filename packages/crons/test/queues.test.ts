import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueCounts, scanQueueFiles, validateQueueName } from "../src/queue-scan.ts";
import { buildQueueBatch, resolveQueueTarget, sendQueueBatch } from "../src/queue-send.ts";
import { run } from "../src/cli.ts";

function makeApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-queues-"));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
  return dir;
}

const QUEUE = `import { defineQueue } from 'void';
interface Message { to: string }
export const maxBatchSize = 50;
export const maxConcurrency = 2;
export default defineQueue<Message>(async (batch) => {
  for (const message of batch.messages) message.ack();
});
`;

function capture(fn: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (value?: string): void => {
    lines.push(String(value));
  };
  return fn().then(
    (code) => {
      console.log = original;
      return { code, lines };
    },
    (error) => {
      console.log = original;
      throw error;
    },
  );
}

describe("queue name validation", () => {
  it("accepts Cloudflare-compatible names", () => {
    for (const name of ["emails", "order-notifications", "a", "queue-2026", "A1-b2"]) {
      assert.equal(validateQueueName(name), null, name);
    }
  });

  it("rejects length, charset, and edge hyphens", () => {
    assert.match(validateQueueName("") ?? "", /empty/);
    assert.match(validateQueueName("-emails") ?? "", /invalid queue name/);
    assert.match(validateQueueName("emails-") ?? "", /invalid queue name/);
    assert.match(validateQueueName("email_queue") ?? "", /invalid queue name/);
    assert.match(validateQueueName("a".repeat(64)) ?? "", /63 characters/);
  });
});

describe("scanQueueFiles", () => {
  it("derives nested names, reads options, and detects defineQueue", () => {
    const app = makeApp({
      "queues/emails.ts": QUEUE,
      "queues/order/notifications.ts": `export default async () => {};\n`,
      "queues/_draft.ts": `export default async () => {};\n`,
      "queues/_internal/thing.ts": `export default async () => {};\n`,
      "queues/types.d.ts": `export default async () => {};\n`,
    });
    try {
      const queues = scanQueueFiles(app);
      assert.deepEqual(queues.map((queue) => queue.name), ["emails", "order-notifications"]);
      assert.deepEqual(queueCounts(queues), { queues: 2, active: 2, invalid: 0 });
      const emails = queues.find((queue) => queue.name === "emails");
      assert.equal(emails?.usesDefineQueue, true);
      assert.equal(emails?.options.maxBatchSize, 50);
      assert.equal(emails?.options.maxConcurrency, 2);
      assert.equal(queues.find((queue) => queue.name === "order-notifications")?.usesDefineQueue, false);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("flags missing handlers, bad options, invalid names, and duplicates", () => {
    const app = makeApp({
      "queues/no-handler.ts": `export const maxRetries = 3;\n`,
      "queues/bad-option.ts": `export const maxConcurrency = 251;\nexport default async () => {};\n`,
      "queues/computed.ts": `export const maxRetries = 1 + 2;\nexport default async () => {};\n`,
      "queues/reexport.ts": `const n = 3;\nexport { n as maxRetries };\nexport default async () => {};\n`,
      "queues/bad_name.ts": `export default async () => {};\n`,
      "queues/a/b.ts": `export default async () => {};\n`,
      "queues/a-b.ts": `export default async () => {};\n`,
    });
    try {
      const queues = scanQueueFiles(app);
      const error = (name: string): string => queues.find((queue) => queue.name === name)?.error ?? "";
      assert.match(error("no-handler"), /missing default handler/);
      assert.match(error("bad-option"), /maxConcurrency.*1-250/);
      assert.match(error("computed"), /whole-number literal/);
      assert.match(error("reexport"), /re-exported/);
      assert.match(error("bad_name"), /invalid queue name/);
      assert.match(error("a-b"), /duplicate queue name/);
      assert.equal(queueCounts(queues).invalid, 7);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("accepts aliased and namespaced defineQueue wrappers", () => {
    const app = makeApp({
      "queues/aliased.ts": `import { defineQueue as dq } from 'void';\nexport default dq(async () => {});\n`,
      "queues/namespaced.ts": `import * as voidNs from 'void';\nexport default voidNs.defineQueue(async () => {});\n`,
      "queues/from-handler.ts": `import { defineQueue } from 'void/handler';\nexport default defineQueue(async () => {});\n`,
    });
    try {
      const queues = scanQueueFiles(app);
      assert.equal(queues.length, 3);
      assert.ok(queues.every((queue) => queue.status === "active" && queue.usesDefineQueue));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("queue dev dispatch", () => {
  it("builds the documented batch shape with defaults", () => {
    const batch = buildQueueBatch("emails", [{ body: { to: "a@b.c" } }], 1_000);
    assert.equal(batch.queue, "emails");
    assert.equal(batch.messages[0]?.timestamp, 1_000);
    assert.equal(batch.messages[0]?.attempts, 1);
    assert.deepEqual(batch.messages[0]?.body, { to: "a@b.c" });
    assert.match(batch.messages[0]?.id ?? "", /^emails-1000-0-/);
    assert.throws(() => buildQueueBatch("emails", [], 0), /at least one message/);
  });

  it("targets /__void/queue with the dev token on loopback only", () => {
    const target = resolveQueueTarget("emails", {
      origin: "http://localhost:5173",
      devToken: "secret",
    });
    assert.equal(target.url, "http://localhost:5173/__void/queue");
    assert.equal(target.headers["x-void-dev-trigger"], "secret");
    assert.throws(
      () => resolveQueueTarget("emails", { origin: "https://example.com" }),
      /loopback origin/,
    );
    assert.throws(
      () => resolveQueueTarget("bad_name", { origin: "http://localhost:5173" }),
      /invalid queue name/,
    );
  });

  it("posts the batch and retries transient responses", async () => {
    const seen: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    let call = 0;
    const result = await sendQueueBatch("emails", [{ body: { to: "a@b.c" } }], {
      origin: "http://localhost:5173",
      devToken: "secret",
      maxAttempts: 3,
      retryBaseMs: 1,
      sleepImpl: async () => {},
      fetchImpl: (async (url: string, init: { body: string; headers: Record<string, string> }) => {
        seen.push({ url, body: init.body, headers: init.headers });
        call++;
        return { ok: call === 2, status: call === 2 ? 200 : 503 } as Response;
      }) as unknown as typeof fetch,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.retried, true);
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.url, "http://localhost:5173/__void/queue");
    assert.equal(seen[0]?.headers["x-void-dev-trigger"], "secret");
    assert.equal((JSON.parse(seen[0]?.body ?? "{}") as { queue: string }).queue, "emails");
  });

  it("classifies connection failures without echoing raw error text", async () => {
    const result = await sendQueueBatch("emails", [{ body: 1 }], {
      origin: "http://localhost:5173",
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5173 x-void-dev-trigger=secret");
      }) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /connection refused or unreachable/);
    assert.match(result.reason ?? "", /dispatch outcome unknown/);
    assert.doesNotMatch(result.reason ?? "", /x-void-dev-trigger=secret/);
  });

  it("does not retry a final 4xx and reports invalid targets without fetching", async () => {
    let calls = 0;
    const failed = await sendQueueBatch("emails", [{ body: 1 }], {
      origin: "http://localhost:5173",
      maxAttempts: 3,
      fetchImpl: (async () => {
        calls++;
        return { ok: false, status: 401 } as Response;
      }) as unknown as typeof fetch,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.httpStatus, 401);
    assert.equal(failed.attempts, 1);
    assert.equal(calls, 1);

    const invalid = await sendQueueBatch("emails", [{ body: 1 }], {
      origin: "https://remote.example.com",
      fetchImpl: (async () => {
        calls++;
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch,
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.reason ?? "", /loopback/);
    assert.equal(calls, 1);
  });
});

describe("queues CLI", () => {
  it("lists scanned queues as JSON", async () => {
    const app = makeApp({ "queues/emails.ts": QUEUE });
    try {
      const { code, lines } = await capture(() => run(["queues", app, "--json"], process.cwd()));
      assert.equal(code, 0);
      const out = JSON.parse(lines.join(""));
      assert.equal(out.format, 1);
      assert.equal(out.counts.active, 1);
      assert.equal(out.queues[0].name, "emails");
      assert.equal(out.queues[0].options.maxBatchSize, 50);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("returns 1 when a queue definition is invalid", async () => {
    const app = makeApp({ "queues/broken.ts": `export const maxConcurrency = 999;\nexport default async () => {};\n` });
    try {
      const { code, lines } = await capture(() => run(["queues", app], process.cwd()));
      assert.equal(code, 1);
      assert.match(lines.join("\n"), /maxConcurrency/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("dispatches a manual batch through queue-send", async () => {
    const app = makeApp({ "queues/emails.ts": QUEUE });
    const original = globalThis.fetch;
    let body = "";
    let url = "";
    globalThis.fetch = (async (target: string, init: { body: string }) => {
      url = target;
      body = init.body;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    try {
      const { code, lines } = await capture(() => run(
        ["queue-send", "emails", app, "--body", '{"to":"a@b.c"}', "--count", "2", "--json"],
        process.cwd(),
      ));
      assert.equal(code, 0);
      assert.equal(url, "http://localhost:5173/__void/queue");
      const sent = JSON.parse(body) as { queue: string; messages: Array<{ body: { to: string } }> };
      assert.equal(sent.queue, "emails");
      assert.equal(sent.messages.length, 2);
      assert.equal(sent.messages[0]?.body.to, "a@b.c");
      const out = JSON.parse(lines.join(""));
      assert.equal(out.format, 1);
      assert.equal(out.count, 2);
    } finally {
      globalThis.fetch = original;
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("defaults queue-send to a single message (next's --count default does not leak)", async () => {
    const original = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_target: string, init: { body: string }) => {
      body = init.body;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    try {
      const { code } = await capture(() => run(["queue-send", "emails"], process.cwd()));
      assert.equal(code, 0);
      const sent = JSON.parse(body) as { messages: unknown[] };
      assert.equal(sent.messages.length, 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects malformed --body and missing selectors", async () => {
    const { code: noSelector } = await capture(() => run(["queue-send"], process.cwd()));
    assert.equal(noSelector, 2);
    const { code: badBody } = await capture(() => run(["queue-send", "emails", "--body", "{nope}"], process.cwd()));
    assert.equal(badBody, 2);
  });
});
