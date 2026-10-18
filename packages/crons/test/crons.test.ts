import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCronFiles } from "../src/scan.ts";
import { buildCronManifest, emitCronManifest, readCronManifest, detectDrift } from "../src/manifest.ts";
import { createCronStore, readActivityLog, appendActivityLog } from "../src/store.ts";
import { triggerExpression, triggerJob } from "../src/trigger.ts";
import { run } from "../src/cli.ts";

function makeApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-"));
  mkdirSync(join(dir, "crons"), { recursive: true });
  for (const [name, src] of Object.entries(files)) {
    writeFileSync(join(dir, "crons", name), src);
  }
  return dir;
}

const HEARTBEAT = `import { defineScheduled } from 'void';
export const cron = '0 * * * *';
export default defineScheduled(async () => {});
`;

const CLEANUP = `import { defineScheduled } from 'void';
export const cron = ['0 * * * *', '30 * * * *'];
export default defineScheduled(async () => {});
`;

const BROKEN = `export default async function handleCron() { return {}; }
`;

describe("scanCronFiles", () => {
  it("parses single + array exports, flags shared expressions, and marks missing cron invalid", () => {
    const app = makeApp({
      "hourly-heartbeat.ts": HEARTBEAT,
      "cleanup.ts": CLEANUP,
      "broken.ts": BROKEN,
      "_ignored.ts": HEARTBEAT,
    });
    try {
      const jobs = scanCronFiles(app);
      assert.equal(jobs.length, 3);
      const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));
      assert.deepEqual(byName["hourly-heartbeat"]?.expressions, ["0 * * * *"]);
      assert.equal(byName["hourly-heartbeat"]?.usesDefineScheduled, true);
      assert.deepEqual(byName["cleanup"]?.expressions, ["0 * * * *", "30 * * * *"]);
      // '0 * * * *' is exported by two files -> shared flag on both.
      assert.equal(byName["hourly-heartbeat"]?.sharedExpression, true);
      assert.equal(byName["cleanup"]?.sharedExpression, true);
      assert.equal(byName["broken"]?.status, "invalid");
      assert.match(byName["broken"]?.error ?? "", /missing `export const cron`/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("marks disabled jobs and ignores bad expressions", () => {
    const app = makeApp({
      "heartbeat.ts": HEARTBEAT,
      "bad.ts": `export const cron = 'not a cron';\nexport default async () => {};\n`,
      "dynamic.ts": `export const name = 'x';\nexport const cron = name;\nexport default async () => {};\n`,
    });
    try {
      const jobs = scanCronFiles(app, { disabled: ["heartbeat"] });
      const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));
      assert.equal(byName["heartbeat"]?.status, "disabled");
      assert.equal(byName["bad"]?.status, "invalid");
      assert.equal(byName["dynamic"]?.status, "invalid");
      assert.match(byName["dynamic"]?.error ?? "", /unsupported cron export/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("manifest", () => {
  it("emits void.crons.json with deployable counts and round-trips", () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "cleanup.ts": CLEANUP });
    try {
      const { manifest, path } = emitCronManifest(app);
      assert.equal(path, join(app, "void.crons.json"));
      // Distinct expressions: '0 * * * *' shared + '30 * * * *' = 2; schedules = 1 + 2 = 3.
      assert.equal(manifest.expressionCount, 2);
      assert.equal(manifest.scheduleCount, 3);
      const reread = readCronManifest(app);
      assert.equal(reread?.jobs.length, 2);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("disabled jobs are excluded from deploy counts", () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "cleanup.ts": CLEANUP });
    try {
      const manifest = buildCronManifest(app, { disabled: ["cleanup"] });
      assert.deepEqual(manifest.disabled, ["cleanup"]);
      assert.equal(manifest.expressionCount, 1);
      assert.equal(manifest.scheduleCount, 1);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("trigger", () => {
  it("POSTs to /__void/scheduled with the dev token and skips disabled/invalid jobs", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;

    const ok = await triggerExpression("0 * * * *", "heartbeat", {
      origin: "http://localhost:5173",
      devToken: "sekret",
      fetchImpl,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.httpStatus, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://localhost:5173/__void/scheduled");
    assert.equal(calls[0]?.headers["x-void-dev-trigger"], "sekret");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}").cron, "0 * * * *");

    const skipped = await triggerJob(
      {
        path: "crons/heartbeat.ts",
        name: "heartbeat",
        expressions: ["0 * * * *"],
        status: "disabled",
        usesDefineScheduled: true,
        sharedExpression: false,
      },
      { origin: "http://localhost:5173", fetchImpl },
    );
    assert.equal(skipped[0]?.skipped, true);
    assert.equal(calls.length, 1);
  });

  it("records failed HTTP as a failed activity entry", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    const res = await triggerExpression("0 * * * *", "heartbeat", {
      origin: "http://localhost:5173",
      fetchImpl,
    });
    assert.equal(res.ok, false);
    assert.equal(res.entry?.status, "failed");
    assert.equal(res.entry?.error, "HTTP 401");
  });

  it("does not send the internal secret header when CRON_SECRET is set but origin is local", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: unknown, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    const local = await triggerExpression("0 * * * *", "heartbeat", {
      origin: "http://localhost:5173",
      devToken: "dev",
      cronSecret: "sekret-prod",
      fetchImpl,
    });
    assert.equal(local.ok, true);
    assert.equal(seen[0]?.["x-void-dev-trigger"], "dev");
    assert.equal(seen[0]?.["x-void-internal"], undefined);

    const prod = await triggerExpression("0 * * * *", "heartbeat", {
      origin: "https://api.example.com",
      cronSecret: "sekret-prod",
      fetchImpl,
    });
    assert.equal(prod.ok, true);
    assert.equal(seen[1]?.["x-void-internal"], "sekret-prod");
    assert.equal(seen[1]?.["x-void-dev-trigger"], undefined);
  });
});

describe("store", () => {
  it("records, lists newest-first, and tracks toggles", () => {
    const store = createCronStore();
    store.record({
      jobName: "heartbeat",
      cron: "0 * * * *",
      scheduledTime: new Date(0).toISOString(),
      durationMs: 12,
      status: "success",
      source: "local",
    });
    assert.equal(store.list().length, 1);
    store.setDisabled("heartbeat", true);
    assert.equal(store.isDisabled("heartbeat"), true);
    assert.deepEqual(store.getDisabled(), ["heartbeat"]);
    store.setDisabled("heartbeat", false);
    assert.equal(store.isDisabled("heartbeat"), false);
  });

  it("persists the activity log capped for CLI/panel sharing", () => {
    const app = mkdtempSync(join(tmpdir(), "crons-log-"));
    try {
      appendActivityLog(app, [
        {
          id: "a",
          jobName: "heartbeat",
          cron: "0 * * * *",
          scheduledTime: new Date(0).toISOString(),
          finishedAt: new Date(1).toISOString(),
          durationMs: 5,
          status: "success",
          source: "local",
        },
      ]);
      assert.equal(readActivityLog(app).length, 1);
      assert.equal(readActivityLog(join(tmpdir(), "crons-missing-xyz")).length, 0);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("void-crons CLI", () => {
  it("list/check/emit agree on an app; check fails on invalid jobs", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "broken.ts": BROKEN });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s: string): void => {
      logs.push(String(s));
    };
    try {
      assert.equal(await run(["emit", app], process.cwd()), 0);
      assert.equal(await run(["check", app], process.cwd()), 1);
      assert.equal(await run(["list", app], process.cwd()), 1);
      assert.match(logs.join("\n"), /heartbeat/);
      assert.match(logs.join("\n"), /missing `export const cron`/);
    } finally {
      console.log = orig;
      rmSync(app, { recursive: true, force: true });
    }
  });
});

function stubFetch(calls: { url: string; init?: RequestInit }[]): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200 };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

describe("void-crons CLI trigger", () => {
  it("fires a job by name and persists entries to the activity log", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    const calls: { url: string; init?: RequestInit }[] = [];
    const restore = stubFetch(calls);
    try {
      assert.equal(await run(["trigger", "heartbeat"], app), 0);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, "http://localhost:5173/__void/scheduled");
      const log = readActivityLog(app);
      assert.equal(log.length, 1);
      assert.equal(log[0]?.jobName, "heartbeat");
      assert.equal(log[0]?.status, "success");
      assert.equal(log[0]?.cron, "0 * * * *");
    } finally {
      restore();
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("fires a raw expression and persists it with the expression as job name", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    const calls: { url: string; init?: RequestInit }[] = [];
    const restore = stubFetch(calls);
    try {
      assert.equal(await run(["trigger", "30 5 * * *"], app), 0);
      assert.equal(calls.length, 1);
      const log = readActivityLog(app);
      assert.equal(log.length, 1);
      assert.equal(log[0]?.jobName, "30 5 * * *");
      assert.equal(log[0]?.status, "success");
    } finally {
      restore();
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("detectDrift", () => {
  // pinned Review Focus input 1: manifest exists but jobs removed → drift lines
  it("reports added/removed/changed files against the manifest", () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "cleanup.ts": CLEANUP });
    try {
      emitCronManifest(app);
      const manifest = readCronManifest(app)!;
      assert.deepEqual(detectDrift(manifest, scanCronFiles(app)), []);
      // change one file on disk, delete another
      writeFileSync(
        join(app, "crons", "cleanup.ts"),
        `export const cron = '0 3 * * *';\nexport default async () => {};\n`,
      );
      rmSync(join(app, "crons", "heartbeat.ts"));
      const drift = detectDrift(manifest, scanCronFiles(app));
      assert.equal(drift.length, 2);
      assert.ok(drift.some((d) => d.includes("-crons/heartbeat.ts removed")));
      assert.ok(drift.some((d) => d.includes("~crons/cleanup.ts cron '0 * * * *, 30 * * * *' → '0 3 * * *'")));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("void-crons CLI schedule", () => {
  it("schedule --once fires due expressions, persists activity, and reports skipped jobs (json)", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT, "cleanup.ts": CLEANUP });
    const calls: { url: string; init?: RequestInit }[] = [];
    const restore = stubFetch(calls);
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s?: string): void => {
      logs.push(String(s));
    };
    try {
      // HEARTBEAT '0 * * * *' + CLEANUP '0 * * * *', '30 * * * *' → 2 distinct expressions, both due in trailing 24h.
      assert.equal(await run(["schedule", "--once", app, "--json"], process.cwd()), 0);
      const jsonLine = logs.find((l) => l !== undefined && l.startsWith("{"));
      const out = JSON.parse(jsonLine ?? "{}");
      assert.equal(out.format, 1);
      assert.equal(typeof out.app, "string");
      assert.ok(out.app.length > 0);
      assert.equal(calls.length, 2);
      assert.equal(out.fired.length, 2);
      const log = readActivityLog(app);
      assert.equal(log.length, 2);
    } finally {
      restore();
      console.log = orig;
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("void-crons json contract", () => {
  it("list/trigger --json carry format: 1", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s?: string): void => {
      logs.push(String(s));
    };
    try {
      await run(["list", app, "--json"], process.cwd());
      assert.equal(JSON.parse(logs.find((l) => l.startsWith("{")) ?? "{}").format, 1);
      logs.length = 0;
      const origFetch = globalThis.fetch;
      const fake = async (): Promise<{ ok: boolean; status: number }> => ({ ok: true, status: 200 });
      globalThis.fetch = fake as unknown as typeof fetch;
      await run(["trigger", "0 * * * *", app, "--json"], process.cwd());
      globalThis.fetch = origFetch;
      assert.equal(JSON.parse(logs.find((l) => l.startsWith("{")) ?? "{}").format, 1);
    } finally {
      console.log = orig;
      rmSync(app, { recursive: true, force: true });
    }
  });
});

describe("void-crons list preview", () => {
  // pinned Review Focus input 4: yearly expr inside 8d window → never, no crash
  it("shows next-fire column; yearly jobs read never; json carries nextFireMs", async () => {
    const app = makeApp({
      "hourly.ts": HEARTBEAT,
      "yearly.ts": `export const cron = '0 0 1 1 *';\nexport default async () => {};\n`,
    });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s?: string): void => {
      logs.push(String(s));
    };
    try {
      assert.equal(await run(["list", app, "--json"], process.cwd()), 0);
      const out = JSON.parse(logs.filter((l) => l.startsWith("{")).join(""));
      const jobs = out.jobs as { name: string; nextFireMs?: number }[];
      assert.ok(jobs.find((j) => j.name === "hourly")?.nextFireMs, "hourly has a next fire");
      assert.ok(!("nextFireMs" in (jobs.find((j) => j.name === "yearly") ?? {})));
      logs.length = 0;
      assert.equal(await run(["list", app], process.cwd()), 0);
      const text = logs.join("\n");
      assert.match(text, /next in \d+[mh]/);
      assert.match(text, /yearly\s+0 0 1 1 \*\s+never/);
    } finally {
      console.log = orig;
      rmSync(app, { recursive: true, force: true });
    }
  });
});
