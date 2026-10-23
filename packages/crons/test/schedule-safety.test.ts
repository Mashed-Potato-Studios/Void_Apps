import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectScheduleTargets,
  computeDue,
  initScheduleState,
  latestDue,
  nextDue,
  runScheduleOnce,
  startScheduleLoop,
  tickSchedule,
} from "../src/schedule.ts";
import type { CronJob } from "../src/types.ts";

const origin = "http://localhost:5173";
const minuteMs = 60_000;
const startMs = Date.UTC(2026, 9, 22, 10);

function job(name: string, expressions = ["* * * * *"], status: CronJob["status"] = "active"): CronJob {
  return { name, path: `crons/${name}.ts`, expressions, status, usesDefineScheduled: false, sharedExpression: false };
}

function makeApp(expressions: Record<string, string>, disabled: string[] = []): string {
  const appRoot = mkdtempSync(join(tmpdir(), "crons-safety-"));
  mkdirSync(join(appRoot, "crons"));
  for (const [name, expression] of Object.entries(expressions)) {
    writeFileSync(join(appRoot, "crons", `${name}.ts`), `export const cron = ${JSON.stringify(expression)};\nexport default async () => {};\n`);
  }
  writeFileSync(join(appRoot, "void.crons.json"), JSON.stringify({ disabled }));
  return appRoot;
}

function responseFetch(onFetch: () => void = () => {}, status = 200): typeof fetch {
  return (async () => {
    onFetch();
    return { ok: status < 400, status } as Response;
  }) as typeof fetch;
}

describe("expression target safety", () => {
  it("blocks mixed groups regardless of job order or disable source", () => {
    for (const reverse of [false, true]) {
      for (const source of ["name", "path", "status"]) {
        const jobs = [job("enabled"), job("paused", undefined, source === "status" ? "disabled" : "active")];
        const disabled = new Set(source === "status" ? [] : [source === "path" ? "crons/paused.ts" : "paused"]);
        const targets = collectScheduleTargets(reverse ? jobs.reverse() : jobs, disabled);
        assert.equal(targets.active.size, 0);
        assert.equal(targets.skipped.length, 1);
        assert.equal(targets.skipped[0]!.jobName, "expression:* * * * *");
        assert.match(targets.skipped[0]!.reason, /fans out.*enabled.*paused.*disabled/);
      }
    }
  });

  it("labels shared dispatches by expression but retains single-job labels", () => {
    const targets = collectScheduleTargets([job("alpha"), job("beta"), job("solo", ["0 * * * *"])], new Set());
    assert.deepEqual([...targets.active], [["* * * * *", "expression:* * * * *"], ["0 * * * *", "solo"]]);
  });

  it("reports every blocked expression without blocking unrelated expressions", () => {
    const targets = collectScheduleTargets([
      job("paused", ["* * * * *", "0 * * * *"], "disabled"),
      job("enabled", ["* * * * *", "0 9 * * *"]),
      job("invalid", ["0 9 * * *"], "invalid"),
    ], new Set());
    assert.deepEqual([...targets.active], [["0 9 * * *", "enabled"]]);
    assert.deepEqual(targets.skipped.map((skip) => skip.cron), ["* * * * *", "0 * * * *"]);
  });

  it("does not interpret duplicate expressions within one job as shared", () => {
    const targets = collectScheduleTargets([job("solo", ["* * * * *", "* * * * *"])], new Set());
    assert.equal(targets.active.get("* * * * *"), "solo");
  });
});

describe("bounded scheduling windows", () => {
  it("previews only the next occurrence over long horizons, sorted and deduplicated", () => {
    assert.deepEqual(nextDue(["0 0 1 * *", "* * * * *", "* * * * *"], startMs, startMs + 40 * 24 * 60 * minuteMs), [
      { expr: "* * * * *", dueMs: startMs + minuteMs },
      { expr: "0 0 1 * *", dueMs: Date.UTC(2026, 10, 1) },
    ]);
    assert.deepEqual(nextDue(["* * * * *"], startMs, startMs + minuteMs - 1), []);
    assert.deepEqual(nextDue(["* * * * *"], startMs, startMs), []);
  });

  it("previews extended expressions and explicit timezones without enumerating all matches", () => {
    const endMs = startMs + 40 * 24 * 60 * minuteMs;
    assert.deepEqual(nextDue(["* * LW * *"], startMs, endMs), [
      { expr: "* * LW * *", dueMs: Date.UTC(2026, 9, 30) },
    ]);
    assert.deepEqual(nextDue(["0 9 * * *"], startMs, endMs, { tz: "Asia/Tokyo" }), [
      { expr: "0 9 * * *", dueMs: Date.UTC(2026, 9, 23) },
    ]);
    assert.deepEqual(nextDue(["0 0 31 6,4 *"], startMs, endMs), []);
  });

  it("allows exactly 2,000 occurrences but rejects an actual overflow", () => {
    assert.equal(computeDue(["* * * * *"], startMs, startMs + 2000 * minuteMs).length, 2000);
    assert.throws(() => computeDue(["* * * * *"], startMs, startMs + 2001 * minuteMs), /more than 2000.*window/);
    assert.throws(() => latestDue(["* * * * *"], startMs, startMs + 2001 * minuteMs), /occurrence limit/);
  });

  it("detects overflow in the capped extended-expression evaluator", () => {
    const fromMs = Date.UTC(2026, 0, 29, 23, 59);
    assert.equal(computeDue(["* * LW * *"], fromMs, Date.UTC(2026, 1, 27, 9, 19)).length, 2000);
    assert.throws(() => computeDue(["* * LW * *"], fromMs, Date.UTC(2026, 1, 27, 9, 20)), /occurrence limit.*LW/);
  });

  it("rejects overflow before any dispatch or checkpoint mutation", async () => {
    const state = initScheduleState(startMs);
    let fetches = 0;
    await assert.rejects(() => tickSchedule(state, {
      active: new Map([["0 * * * *", "hourly"], ["* * * * *", "frequent"]]), skipped: [],
    }, { origin, nowMs: startMs + 2001 * minuteMs, fetchImpl: responseFetch(() => fetches++) }), /occurrence limit/);
    assert.equal(fetches, 0);
    assert.equal(state.checkpointMs, startMs);
    assert.equal(state.firedMinutes.size, 0);
  });
});

describe("dispatch state policy", () => {
  it("leaves a pre-aborted window pending and retains target skips", async () => {
    const state = initScheduleState(startMs);
    const controller = new AbortController();
    controller.abort();
    const skipped = [{ cron: "0 * * * *", jobName: "paused", reason: "disabled" }];
    const result = await tickSchedule(state, { active: new Map([["* * * * *", "alpha"]]), skipped }, {
      origin, nowMs: startMs + minuteMs, signal: controller.signal,
      fetchImpl: responseFetch(() => assert.fail("must not dispatch")),
    });
    assert.deepEqual(result.state, state);
    assert.deepEqual(result.skipped, skipped);
    assert.equal(state.firedMinutes.size, 0);
  });

  it("consumes failed dispatch attempts without implying successful handler execution", async () => {
    const targets = { active: new Map([["* * * * *", "alpha"]]), skipped: [] };
    const state = initScheduleState(startMs);
    let fetches = 0;
    const fetchImpl = responseFetch(() => fetches++, 500);
    const result = await tickSchedule(state, targets, { origin, nowMs: startMs + minuteMs, fetchImpl });
    assert.equal(result.fired[0]!.status, "failed");
    assert.equal(result.state.checkpointMs, startMs + minuteMs);
    assert.equal(state.firedMinutes.size, 0);
    await tickSchedule(result.state, targets, { origin, nowMs: startMs + minuteMs, fetchImpl });
    assert.equal(fetches, 1);
  });

  it("retains unattempted work after abort without replaying attempted minutes", async () => {
    const targets = { active: new Map([["* * * * *", "alpha"], ["*/1 * * * *", "beta"]]), skipped: [] };
    const controller = new AbortController();
    let fetches = 0;
    const interrupted = await tickSchedule(initScheduleState(startMs), targets, {
      origin, nowMs: startMs + 2 * minuteMs, signal: controller.signal,
      fetchImpl: responseFetch(() => { fetches++; controller.abort(); }),
    });
    assert.equal(interrupted.state.checkpointMs, startMs);
    assert.equal(interrupted.state.firedMinutes.size, 1);
    const resumed = await tickSchedule(interrupted.state, targets, {
      origin, nowMs: startMs + 2 * minuteMs, fetchImpl: responseFetch(() => fetches++),
    });
    assert.equal(fetches, 4);
    assert.equal(resumed.state.checkpointMs, startMs + 2 * minuteMs);
  });

  it("does not move the checkpoint backwards", async () => {
    const result = await tickSchedule(initScheduleState(startMs), { active: new Map(), skipped: [] }, { origin, nowMs: startMs - minuteMs });
    assert.equal(result.state.checkpointMs, startMs);
  });
});

describe("direct schedule APIs", () => {
  it("combines manifest and option disables, including shared fanout", async (context) => {
    const appRoot = makeApp({ paused: "* * * * *", sibling: "* * * * *", option: "0 * * * *" }, ["crons/paused.ts"]);
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    const result = await runScheduleOnce(appRoot, {
      origin, nowMs: startMs, disabled: ["option"], fetchImpl: responseFetch(() => assert.fail("must not dispatch")),
    });
    assert.equal(result.fired.length, 0);
    assert.equal(result.skipped.length, 2);
    assert.ok(result.skipped.some((skip) => /fans out/.test(skip.reason)));
  });

  it("records shared activity as an expression dispatch", async (context) => {
    const appRoot = makeApp({ alpha: "0 * * * *", beta: "0 * * * *" });
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    const result = await runScheduleOnce(appRoot, { origin, nowMs: startMs, fetchImpl: responseFetch() });
    assert.equal(result.fired.length, 1);
    assert.equal(result.fired[0]!.jobName, "expression:0 * * * *");
  });

  it("forwards framework transport and remote-binding consent in catch-up", async (context) => {
    const appRoot = makeApp({ alpha: "0 * * * *" });
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    let fetches = 0;
    const result = await runScheduleOnce(appRoot, {
      origin: "https://example.com", transport: "framework", allowRemote: true, cronSecret: "test-internal-token",
      bindingMode: "remote", allowRemoteBindings: true, nowMs: startMs,
      fetchImpl: responseFetch(() => fetches++),
    });
    assert.equal(fetches, 1);
    assert.equal(result.fired[0]!.status, "success");
  });

  it("forwards binding policy and job groups through direct ticks", async () => {
    const targets = { active: new Map([["* * * * *", "alpha"]]), skipped: [] };
    for (const policy of [
      { bindingMode: "remote" as const },
      { jobs: [job("alpha"), job("paused", undefined, "disabled")] },
      { jobs: [job("alpha")], disabled: ["alpha"] },
    ]) {
      const result = await tickSchedule(initScheduleState(startMs), targets, {
        origin, nowMs: startMs + minuteMs, ...policy,
        fetchImpl: responseFetch(() => assert.fail("policy must block dispatch")),
      });
      assert.equal(result.fired.length, 0);
      assert.equal(result.skipped.length, 1);
      assert.equal(result.state.firedMinutes.size, 0);
    }
    let fetches = 0;
    await tickSchedule(initScheduleState(startMs), targets, {
      origin: "https://example.com", transport: "framework", allowRemote: true, cronSecret: "test-internal-token",
      bindingMode: "remote", allowRemoteBindings: true, nowMs: startMs + minuteMs,
      fetchImpl: responseFetch(() => fetches++),
    });
    assert.equal(fetches, 1);
  });

  it("forwards framework transport and binding consent through live ticks", async (context) => {
    const appRoot = makeApp({ alpha: "* * * * *", beta: "* * * * *" });
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    const controller = new AbortController();
    const logs: string[] = [];
    context.mock.method(console, "log", (message: string) => logs.push(message));
    const timer = setTimeout(() => controller.abort(), 100);
    context.after(() => clearTimeout(timer));
    let fetches = 0;
    await startScheduleLoop(appRoot, {
      origin: "https://example.com", transport: "framework", allowRemote: true, cronSecret: "test-internal-token",
      bindingMode: "remote", allowRemoteBindings: true, nowMs: Date.now() - minuteMs,
      intervalMs: 1, signal: controller.signal,
      fetchImpl: responseFetch(() => { fetches++; controller.abort(); }),
    });
    assert.equal(fetches, 1);
    assert.ok(logs.some((message) => message.startsWith("fired expression:* * * * *")));
  });

  it("logs the nearest occurrence without enumerating a long frequent window", async (context) => {
    const appRoot = makeApp({ frequent: "* * * * *", monthly: "0 0 1 * *" });
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    const controller = new AbortController();
    const logs: string[] = [];
    context.mock.method(console, "log", (message: string) => { logs.push(message); controller.abort(); });
    await startScheduleLoop(appRoot, { origin, nowMs: startMs, signal: controller.signal });
    assert.match(logs[0]!, /next \* \* \* \* \* in 1m/);
  });

  it("looks far enough ahead for monthly schedules", async (context) => {
    const appRoot = makeApp({ monthly: "0 0 1 * *" });
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    const controller = new AbortController();
    const logs: string[] = [];
    context.mock.method(console, "log", (message: string) => { logs.push(message); controller.abort(); });
    await startScheduleLoop(appRoot, { origin, nowMs: Date.UTC(2026, 9, 22), signal: controller.signal });
    assert.match(logs[0]!, /next 0 0 1 \* \* in 240h/);
  });

  it("honors manifest disables in the live loop", async (context) => {
    const appRoot = makeApp({ paused: "* * * * *", sibling: "* * * * *" }, ["paused"]);
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    const controller = new AbortController();
    const logs: string[] = [];
    context.mock.method(console, "log", (message: string) => logs.push(message));
    const timer = setTimeout(() => controller.abort(), 20);
    context.after(() => clearTimeout(timer));
    const result = await startScheduleLoop(appRoot, {
      origin, nowMs: Date.now() - minuteMs, intervalMs: 1, signal: controller.signal,
      fetchImpl: responseFetch(() => assert.fail("must not dispatch")),
    });
    assert.match(logs[0]!, /scheduled 0 expressions/);
    assert.equal(result.firedTotal, 0);
  });

  it("propagates live abort to an in-flight request", async (context) => {
    const appRoot = makeApp({ alpha: "* * * * *" });
    context.after(() => rmSync(appRoot, { recursive: true, force: true }));
    context.mock.method(console, "log", () => {});
    const controller = new AbortController();
    let fetches = 0;
    const fetchImpl = (async (_url, init) => {
      fetches++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        controller.abort();
      });
    }) as typeof fetch;
    await startScheduleLoop(appRoot, { origin, nowMs: Date.now() - minuteMs, intervalMs: 1, signal: controller.signal, fetchImpl });
    assert.equal(fetches, 1);
  });
});
