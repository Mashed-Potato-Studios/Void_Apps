import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDue, latestDue } from "../src/schedule.ts";

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
