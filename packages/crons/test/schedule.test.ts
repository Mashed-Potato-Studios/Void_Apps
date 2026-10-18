import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeDue, latestDue, runScheduleOnce } from "../src/schedule.ts";
import { readActivityLog } from "../src/store.ts";

describe("computeDue", () => {
  it("lists matching minutes in order, once per expression", () => {
    // 2026-10-18 10:00:01Z → 10:11Z Sunday. */5 fires at 10:05, 10:10. Window (from,to] inclusive.
    const from = Date.UTC(2026, 9, 18, 10, 0, 1, 0);
    const to = Date.UTC(2026, 9, 18, 10, 11, 0, 0);
    const due = computeDue(["*/5 * * * *"], from, to);
    assert.deepEqual(due.map((d) => new Date(d.dueMs).toISOString().slice(11, 19)), [
      "10:05:00",
      "10:10:00",
    ]);
  });

  it("returns empty when nothing is due in the window", () => {
    const due = computeDue(["0 2 * * 1"], Date.UTC(2026, 9, 18, 10), Date.UTC(2026, 9, 18, 11));
    assert.deepEqual(due, []);
  });

  it("dedupes identical expressions", () => {
    const due = computeDue(["* * * * *", "* * * * *"], Date.UTC(2026, 9, 18, 10, 0, 30), Date.UTC(2026, 9, 18, 10, 1, 30));
    assert.equal(due.length, 1);
  });
});

describe("latestDue", () => {
  it("picks the max due time per expression over the catch-up window", () => {
    const from = Date.UTC(2026, 9, 18, 9, 0);
    const to = Date.UTC(2026, 9, 18, 10, 30);
    const latest = latestDue(["*/5 * * * *"], from, to);
    assert.equal(latest.length, 1);
    assert.equal(new Date(latest[0]!.dueMs).getUTCMinutes(), 30);
  });
});

const SHARED = `export const cron = ['0 * * * *'];
export default async () => {};
`;

function makeSchedApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-sched-"));
  mkdirSync(join(dir, "crons"), { recursive: true });
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, "crons", name), src);
  return dir;
}

function okFetch(calls: { url: string; cron: string }[]): typeof fetch {
  const f = async (url: string | URL, init?: { body?: string }): Promise<{ ok: boolean; status: number }> => {
    calls.push({ url: String(url), cron: String(JSON.parse(init?.body ?? "{}").cron) });
    return { ok: true, status: 200 };
  };
  return f as unknown as typeof fetch;
}

describe("runScheduleOnce", () => {
  // pinned Review Focus input 5: disabled job → skipped, never fired
  it("fires catch-up per distinct expression, skips disabled, writes activity log", async () => {
    const app = makeSchedApp({ "heartbeat.ts": SHARED, "cleanup.ts": SHARED });
    const calls: { url: string; cron: string }[] = [];
    const res = await runScheduleOnce(app, {
      origin: "http://localhost:5173",
      fetchImpl: okFetch(calls),
      disabled: ["cleanup"],
      nowMs: Date.UTC(2026, 9, 18, 10, 40, 0),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cron, "0 * * * *");
    assert.equal(res.fired.length, 1);
    assert.equal(res.fired[0]?.status, "success");
    assert.deepEqual(res.skipped, [
      { cron: "0 * * * *", jobName: "cleanup", reason: 'job "cleanup" is disabled' },
    ]);
    const log = readActivityLog(app);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.cron, "0 * * * *");
    rmSync(app, { recursive: true, force: true });
  });

  it("out-of-window and invalid jobs contribute nothing", async () => {
    const app = makeSchedApp({
      "broken.ts": "export default async () => {};\n",
      "late.ts": `export const cron = ['0 2 * * 1'];\nexport default async () => {};\n`,
    });
    const calls: { url: string; cron: string }[] = [];
    // now = Sunday 10:00 → Monday 02:00 due lies ahead of [now-24h, now] window
    const res = await runScheduleOnce(app, {
      origin: "http://localhost:5173",
      fetchImpl: okFetch(calls),
      nowMs: Date.UTC(2026, 9, 18, 10, 0, 0),
    });
    assert.equal(calls.length, 0);
    assert.equal(res.fired.length, 0);
    rmSync(app, { recursive: true, force: true });
  });
});

import { initScheduleState, tickSchedule, collectScheduleTargets } from "../src/schedule.ts";
import { scanCronFiles } from "../src/scan.ts";

describe("tickSchedule", () => {
  // pinned Review Focus inputs 2 & 3: shared expr fires once; overlapping windows don't double-fire
  it("fires an expression once per matched minute even when shared by two jobs or re-ticked", async () => {
    const SHARED5 = `export const cron = ['*/5 * * * *'];\nexport default async () => {};\n`;
    const app = makeSchedApp({ "heartbeat.ts": SHARED5, "cleanup.ts": SHARED5 });
    const jobs = scanCronFiles(app);
    const targets = collectScheduleTargets(jobs, new Set());
    const calls: { url: string; cron: string }[] = [];
    const fetch = okFetch(calls);
    const T0 = Date.UTC(2026, 9, 18, 10, 4, 30);
    let state = initScheduleState(T0);
    const t1 = await tickSchedule(state, targets, {
      origin: "http://localhost:5173",
      fetchImpl: fetch,
      nowMs: T0 + 90_000, // 10:06:00 crossing the :05 due
    });
    state = t1.state;
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cron, "*/5 * * * *");
    const t2 = await tickSchedule(state, targets, {
      origin: "http://localhost:5173",
      fetchImpl: fetch,
      nowMs: T0 + 90_000 + 20_000,
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(t2.fired, []);
    await tickSchedule(state, targets, {
      origin: "http://localhost:5173",
      fetchImpl: fetch,
      nowMs: T0 + 360_000, // 10:10:30 crossing the :10 due
    });
    assert.equal(calls.length, 2);
    rmSync(app, { recursive: true, force: true });
  });
});
