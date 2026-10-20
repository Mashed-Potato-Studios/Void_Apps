import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createState, reduce, type JobView, type Snapshot, type TuiState } from "../src/tui/model.ts";
import type { CronActivityEntry, CronJob } from "../src/types.ts";
import { render, truncate } from "../src/tui/render.ts";

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

describe("tui render", () => {
  it("renders a full 80x24 frame without wrapping", () => {
    const s = state({
      activity: [
        {
          id: "1",
          jobName: "alpha",
          cron: "* * * * *",
          scheduledTime: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
          durationMs: 24,
          status: "success",
          source: "local",
        } satisfies CronActivityEntry,
      ],
    });
    const lines = render(s, 60_000, false);
    assert.equal(lines.length, 24);
    assert.ok(lines.every((line) => [...line].length <= 80));
    const text = lines.join("\n");
    assert.match(text, /void-crons · demo/);
    assert.match(text, /alpha/);
    assert.match(text, /Activity/);
    assert.match(text, /status: ready/);
    assert.ok(!text.includes("\u001b"));
  });

  it("keeps narrow frames inside the terminal width", () => {
    const s = state({
      width: 50,
      height: 20,
      jobs: [job("very-long-job-name-that-would-overflow", "active", ["*/15 * * * *", "30 9 * * 1"])],
    });
    const lines = render(s, 60_000, false);
    assert.equal(lines.length, 20);
    assert.ok(lines.every((line) => [...line].length <= 50), "all lines fit 50 columns");
    assert.ok(lines.some((line) => line.includes("very-long-")));
    assert.ok(lines.some((line) => line.includes("move")));
  });

  it("drops the activity pane on short terminals", () => {
    const s = state({ width: 39, height: 13 });
    const lines = render(s, 60_000, false);
    assert.equal(lines.length, 13);
    assert.ok(lines.every((line) => [...line].length <= 39));
    assert.ok(!lines.some((line) => line.includes("Activity")));
  });

  it("shows an empty state and drift lines", () => {
    const empty = render(state({ jobs: [] }), 60_000, false).join("\n");
    assert.match(empty, /no jobs in crons\//);

    const drift = render(
      state({ manifest: "drift", drift: ["+crons/new.ts added"] }),
      60_000,
      false,
    ).join("\n");
    assert.match(drift, /Drift \(1\)/);
    assert.match(drift, /\+crons\/new\.ts added/);
  });

  it("truncates long text with an ellipsis", () => {
    assert.equal(truncate("abcdef", 4), "abc…");
    assert.equal(truncate("abc", 4), "abc");
  });
});
