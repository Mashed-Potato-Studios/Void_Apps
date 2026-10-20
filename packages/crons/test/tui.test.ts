import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createState, reduce, type JobView, type Snapshot, type TuiState } from "../src/tui/model.ts";
import type { CronActivityEntry, CronJob } from "../src/types.ts";
import { render, truncate } from "../src/tui/render.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadSnapshot } from "../src/tui/data.ts";
import { appendActivityLog } from "../src/store.ts";
import { emitCronManifest } from "../src/manifest.ts";

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

function makeApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "crons-tui-"));
  mkdirSync(join(dir, "crons"), { recursive: true });
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, "crons", name), source);
  return dir;
}

const HEARTBEAT = `import { defineScheduled } from 'void';\nexport const cron = '* * * * *';\nexport default defineScheduled(async () => {});\n`;

describe("tui snapshot loader", () => {
  it("loads jobs, manifest state, next fires, and activity", () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    try {
      emitCronManifest(app);
      appendActivityLog(
        app,
        [
          {
            id: "a1",
            jobName: "heartbeat",
            cron: "* * * * *",
            scheduledTime: new Date(0).toISOString(),
            finishedAt: new Date(0).toISOString(),
            durationMs: 12,
            status: "success",
            source: "local",
          },
        ],
        "jsonl",
      );
      const snap = loadSnapshot(app, { storeMode: "jsonl", nowMs: Date.UTC(2026, 0, 1) });
      assert.equal(snap.appName, basename(app));
      assert.equal(snap.manifest, "clean");
      assert.equal(snap.jobs.length, 1);
      assert.equal(snap.jobs[0]?.status, "active");
      assert.ok(typeof snap.jobs[0]?.nextFireMs === "number");
      assert.equal(snap.activity[0]?.jobName, "heartbeat");
      assert.equal(snap.jobs[0]?.last?.id, "a1");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("reports missing manifests, drift, and disabled overlays", () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    try {
      const missing = loadSnapshot(app, { storeMode: "jsonl" });
      assert.equal(missing.manifest, "missing");

      emitCronManifest(app);
      writeFileSync(
        join(app, "crons", "heartbeat.ts"),
        `import { defineScheduled } from 'void';\nexport const cron = '5 * * * *';\nexport default defineScheduled(async () => {});\n`,
      );
      const drifted = loadSnapshot(app, { storeMode: "jsonl" });
      assert.equal(drifted.manifest, "drift");
      assert.ok(drifted.drift.length > 0);

      const disabled = loadSnapshot(app, { storeMode: "jsonl", disabled: ["heartbeat"] });
      assert.equal(disabled.jobs[0]?.status, "disabled");
      assert.equal(disabled.jobs[0]?.nextFireMs, null);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

import { keyToMsg } from "../src/tui/keys.ts";

describe("tui keys", () => {
  it("maps navigation and actions", () => {
    assert.deepEqual(keyToMsg(undefined, { name: "up" }), { type: "move", delta: -1 });
    assert.deepEqual(keyToMsg(undefined, { name: "down" }), { type: "move", delta: 1 });
    assert.deepEqual(keyToMsg("j", { name: "j" }), { type: "move", delta: 1 });
    assert.deepEqual(keyToMsg("k", { name: "k" }), { type: "move", delta: -1 });
    assert.deepEqual(keyToMsg("\r", { name: "return" }), { type: "trigger" });
    assert.deepEqual(keyToMsg("d", { name: "d" }), { type: "toggle" });
    assert.deepEqual(keyToMsg("e", { name: "e" }), { type: "emit" });
    assert.deepEqual(keyToMsg("c", { name: "c" }), { type: "catchup" });
    assert.deepEqual(keyToMsg("r", { name: "r" }), { type: "refresh" });
    assert.deepEqual(keyToMsg("q", { name: "q" }), { type: "quit" });
    assert.deepEqual(keyToMsg("\u0003", { name: "c", ctrl: true }), { type: "quit" });
    assert.equal(keyToMsg("x", { name: "x" }), null);
  });
});

import { triggerExpression } from "../src/trigger.ts";

describe("trigger abort", () => {
  it("stops before fetching when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetches = 0;
    const result = await triggerExpression("* * * * *", "alpha", {
      origin: "http://localhost:5173",
      signal: controller.signal,
      fetchImpl: (async () => {
        fetches++;
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch,
    });
    assert.equal(fetches, 0);
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 0);
    assert.equal(result.attempts, 1);
    assert.equal(result.entry?.status, "failed");
    assert.match(result.entry?.error ?? "", /aborted/);
  });
});
