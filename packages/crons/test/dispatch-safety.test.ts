import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { run } from "../src/cli.ts";
import { triggerExpression, triggerJob } from "../src/trigger.ts";
import { appendActivityLog, readActivityLog } from "../src/store.ts";
import type { CronJob } from "../src/types.ts";

const expression = "0 * * * *";
const job: CronJob = { name: "first", path: "crons/first.ts", status: "active", expressions: [expression], usesDefineScheduled: false, sharedExpression: false };

describe("dispatch safety", () => {
  it("rejects invalid retry and timestamp options without fetching", async () => {
    let calls = 0;
    for (const invalid of [{ maxAttempts: Infinity }, { maxAttempts: NaN }, { maxAttempts: 1.5 }, { timeoutMs: -1 }, { retryBaseMs: Infinity }, { scheduledTime: NaN }]) {
      const result = await triggerExpression(expression, job.name, { origin: "http://localhost:5173", ...invalid, fetchImpl: async () => { calls++; return new Response(); } });
      assert.equal(result.skipped, true);
      assert.equal(result.attempts, 0);
    }
    assert.equal(calls, 0);
  });

  it("honors explicit local disables for a directly supplied active job", async () => {
    const results = await triggerJob(job, { origin: "http://localhost:5173", disabled: [job.path], fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.equal(results[0]?.skipped, true);
    assert.equal(results[0]?.attempts, 0);
  });

  it("retains an unknown dispatch after cancellation stops retries", async () => {
    const controller = new AbortController();
    const result = await triggerExpression(expression, job.name, {
      origin: "http://localhost:5173", maxAttempts: 2, signal: controller.signal,
      fetchImpl: async () => { controller.abort(); throw new Error("sensitive transport detail"); },
    });
    assert.equal(result.attempts, 1);
    assert.equal(result.entry?.status, "unknown");
    assert.equal(result.entry?.error?.includes("sensitive"), false);
  });

  it("rejects invalid origins before sending any credentials", async () => {
    let calls = 0;
    for (const origin of ["https://localhost.attacker.example", "https://example.com/localhost", "file:///localhost", "http://user:pass@localhost", "http://localhost/?secret=test"]) {
      const result = await triggerExpression(expression, job.name, { origin, devToken: "dev-secret", fetchImpl: async () => { calls++; return new Response(); } });
      assert.equal(result.skipped, true);
      assert.equal(result.attempts, 0);
    }
    assert.equal(calls, 0);
  });

  it("recognizes IPv6 and refuses redirects without forwarding internal tokens", async () => {
    const result = await triggerExpression(expression, job.name, {
      origin: "http://[::1]:5173/", devToken: "dev", cronSecret: "internal",
      fetchImpl: async (url, init) => {
        assert.equal(url, "http://[::1]:5173/__void/scheduled");
        assert.equal(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-void-dev-trigger"), "dev");
        assert.equal(headers.has("x-void-internal"), false);
        return new Response();
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.entry?.bindingMode, "unknown");
  });

  it("requires explicit framework transport and never includes a dev token remotely", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls++;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-void-internal"), "internal");
      assert.equal(headers.has("x-void-dev-trigger"), false);
      return new Response();
    };
    const options = { origin: "https://example.com", cronSecret: "internal", devToken: "dev", fetchImpl };
    assert.equal((await triggerExpression(expression, job.name, options)).skipped, true);
    assert.equal((await triggerExpression(expression, job.name, { ...options, transport: "framework", allowRemote: true })).ok, true);
    assert.equal(calls, 1);
  });

  it("requires consent for declared remote bindings and hides arbitrary fetch error details", async () => {
    let calls = 0;
    const options = { origin: "http://localhost", bindingMode: "remote" as const, fetchImpl: async () => { calls++; throw new Error("secret-token-in-fetch-error"); } };
    assert.equal((await triggerExpression(expression, job.name, options)).skipped, true);
    const result = await triggerExpression(expression, job.name, { ...options, allowRemoteBindings: true });
    assert.equal(result.entry?.status, "unknown");
    assert.doesNotMatch(JSON.stringify(result), /secret-token/);
    assert.equal(calls, 1);
  });

  it("blocks disabled siblings and records shared expression dispatches without claiming handler metrics", async () => {
    const second: CronJob = { ...job, name: "second", path: "crons/second.ts", status: "disabled" };
    let calls = 0;
    const options = { origin: "http://localhost", jobs: [job, second], fetchImpl: async () => { calls++; return new Response(); } };
    assert.equal((await triggerJob(job, options))[0]?.skipped, true);
    assert.equal(calls, 0);
    const result = await triggerExpression(expression, job.name, { ...options, jobs: [job, { ...second, status: "active" }] });
    assert.equal(result.entry?.kind, "dispatch");
    assert.equal(result.entry?.jobName, `expression:${expression}`);
    assert.deepEqual(result.entry?.affectedJobs, ["first", "second"]);
    assert.equal(result.entry?.itemsProcessed, undefined);
  });

  it("round-trips dispatch metadata and unknown outcomes through SQLite", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-history-"));
    try {
      const result = await triggerExpression(expression, job.name, { origin: "http://localhost", jobs: [job], fetchImpl: async () => { throw new Error("network"); } });
      assert.ok(result.entry);
      appendActivityLog(root, [result.entry]);
      assert.deepEqual(readActivityLog(root), [result.entry]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("CLI contract safety", () => {
  it("never dispatches a disabled named job or a shared expression with disabled siblings", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-disabled-"));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      mkdirSync(join(root, "crons"));
      for (const name of ["first", "second"]) writeFileSync(join(root, "crons", `${name}.ts`), `export const cron = '${expression}'; export default () => {};`);
      writeFileSync(join(root, "void.crons.json"), JSON.stringify({ disabled: ["second"] }));
      globalThis.fetch = async () => { calls++; return new Response(); };
      assert.equal(await run(["trigger", "second", "--ci", "--store", "jsonl"], root), 1);
      assert.equal(await run(["trigger", "first", "--ci", "--store", "jsonl"], root), 1);
      assert.equal(await run(["trigger", expression, "--ci", "--store", "jsonl"], root), 1);
      assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); }
  });

  it("returns 1 from schedule --once when a dispatch fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-schedule-fail-"));
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    try {
      mkdirSync(join(root, "crons"));
      writeFileSync(join(root, "crons", "first.ts"), `export const cron = '* * * * *'; export default () => {};`);
      globalThis.fetch = (async () => ({ ok: false, status: 500 } as Response)) as typeof fetch;
      console.log = () => {};
      assert.equal(await run(["schedule", "--once", "--ci"], root), 1);
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers modern config-only apps and reports unknown production capability without executing config", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-discovery-"));
    const originalLog = console.log;
    const lines: string[] = [];
    try {
      mkdirSync(join(root, "apps", "modern", "crons"), { recursive: true });
      writeFileSync(join(root, "apps", "modern", "void.config.ts"), "throw new Error('must not execute config');");
      console.log = (value) => { lines.push(String(value)); };
      assert.equal(await run(["doctor", "--all", "--json"], root), 0);
      const report = JSON.parse(lines[0]!);
      assert.equal(report.app, "modern");
      assert.equal(report.config, "void.config.ts");
      assert.equal(report.bindingMode, "unknown");
      assert.equal(report.productionTrigger, "unknown");
      assert.equal(report.manifestRole, "local-inspection");
    } finally { console.log = originalLog; rmSync(root, { recursive: true, force: true }); }
  });
});
