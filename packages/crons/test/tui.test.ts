import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createState, reduce, type JobView, type Snapshot, type TuiState } from "../src/tui/model.ts";
import type { CronJob } from "../src/types.ts";

function job(name: string, status: CronJob["status"] = "active", expressions = ["* * * * *"]): JobView {
  return {
    path: `crons/${name}.ts`,
    name,
    expressions,
    status,
    usesDefineScheduled: true,
    sharedExpression: false,
    nextFireMs: 1_000,
  };
}

function snapshot(jobs: JobView[] = [job("alpha"), job("beta"), job("gamma")], over: Partial<Snapshot> = {}): Snapshot {
  return {
    appName: "demo",
    jobs,
    manifest: "clean",
    drift: [],
    activity: [],
    disabled: [],
    scannedAt: 5,
    ...over,
  };
}

function state(over: Partial<TuiState> = {}): TuiState {
  return {
    ...createState({
      appPath: "/tmp/demo",
      origin: "http://localhost:5173",
      storeMode: "jsonl",
      color: false,
      snapshot: snapshot(),
      width: 80,
      height: 24,
    }),
    ...over,
  };
}

describe("tui model", () => {
  it("clamps selection at both ends and keeps scroll visible", () => {
    let s = state({ selected: 0, height: 8 });
    s = reduce(s, { type: "move", delta: -1 });
    assert.equal(s.selected, 0);

    s = reduce(s, { type: "move", delta: 99 });
    assert.equal(s.selected, 2);

    const tall = state({ selected: 0, height: 24 });
    const moved = reduce(tall, { type: "move", delta: 2 });
    assert.equal(moved.selected, 2);
    assert.equal(moved.scroll, 0);
  });

  it("toggles a job in the session overlay and ignores invalid jobs", () => {
    let s = state();
    s = reduce(s, { type: "toggle" });
    assert.equal(s.jobs[0]?.status, "disabled");
    assert.deepEqual([...s.disabled], ["alpha"]);
    assert.equal(s.status?.kind, "info");

    s = reduce(s, { type: "toggle" });
    assert.equal(s.jobs[0]?.status, "active");
    assert.deepEqual([...s.disabled], []);

    const invalid = state({ jobs: [job("broken", "invalid")], selected: 0 });
    const after = reduce(invalid, { type: "toggle" });
    assert.equal(after.status?.kind, "error");
    assert.equal(after.disabled.size, 0);
  });

  it("clamps selection when a loaded snapshot has fewer jobs", () => {
    const s = state({ selected: 2 });
    const loaded = reduce(s, {
      type: "loaded",
      snapshot: snapshot([job("only")]),
    });
    assert.equal(loaded.selected, 0);
    assert.equal(loaded.jobs.length, 1);
    assert.equal(loaded.busy, null);
    assert.equal(loaded.status, null);
  });

  it("clears status on movement and tracks busy", () => {
    let s = state({ status: { kind: "error", message: "boom" } });
    s = reduce(s, { type: "move", delta: 1 });
    assert.equal(s.status, null);

    s = reduce(s, { type: "busy", label: "trigger alpha" });
    assert.equal(s.busy, "trigger alpha");

    s = reduce(s, { type: "status", kind: "success", message: "ok" });
    assert.equal(s.busy, null);
    assert.equal(s.status?.message, "ok");
  });
});
