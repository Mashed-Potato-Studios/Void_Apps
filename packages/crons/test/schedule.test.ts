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

  it("treats impossible-but-parseable expressions as never due instead of throwing", () => {
    // '0 0 31 6,4 *' parses (31 days in Apr/Jun impossible → parser loop throws lazily)
    assert.doesNotThrow(() => computeDue(["0 0 31 6,4 *"], Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)));
    assert.deepEqual(computeDue(["0 0 31 6,4 *"], Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)), []);
  });
});

describe("timezone", () => {
  it("computeDue fires 09:00 in the given zone, not server-local", () => {
    // 2026-01-05 00:30Z: 09:00 in Tokyo already passed, in New York still ahead.
    const nowMs = Date.UTC(2026, 0, 5, 0, 30);
    const window = nowMs + 24 * 3600_000;
    const tokyo = computeDue(["0 9 * * *"], nowMs, window, { tz: "Asia/Tokyo" });
    const ny = computeDue(["0 9 * * *"], nowMs, window, { tz: "America/New_York" });
    assert.notEqual(tokyo[0]?.dueMs, ny[0]?.dueMs);
    assert.equal(new Date(ny[0]?.dueMs ?? 0).toISOString(), "2026-01-05T14:00:00.000Z");
    assert.equal(new Date(tokyo[0]?.dueMs ?? 0).toISOString(), "2026-01-06T00:00:00.000Z");
  });

  it("runScheduleOnce rejects unknown zones instead of firing blind", async () => {
    const app = makeSchedApp({ "nine.ts": `export const cron = '0 9 * * *';\nexport default async () => {};\n` });
    try {
      await assert.rejects(() => runScheduleOnce(app, { origin: "http://localhost:5173", tz: "Foo/Bar" }), /unknown timezone/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
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
      // Cloudflare day-of-week: 2 = Monday. Monday 02:00 lies ahead of the
      // Sunday 10:00 checkpoint, so it falls outside the trailing window.
      "late.ts": `export const cron = ['0 2 * * 2'];\nexport default async () => {};\n`,
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
