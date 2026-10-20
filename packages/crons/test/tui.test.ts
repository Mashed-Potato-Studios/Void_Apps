import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createState, reduce, type JobView, type Snapshot, type TuiState } from "../src/tui/model.ts";
import type { CronActivityEntry, CronJob } from "../src/types.ts";
import { render, truncate } from "../src/tui/render.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadSnapshot } from "../src/tui/data.ts";
import { appendActivityLog, readActivityLog } from "../src/store.ts";
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
import { runScheduleOnce } from "../src/schedule.ts";

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
    assert.equal(result.entry, undefined);
    assert.match(result.reason ?? "", /aborted/);
  });

  it("does not write activity for aborted catch-up work", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    try {
      const controller = new AbortController();
      controller.abort();
      let fetches = 0;
      const run = await runScheduleOnce(app, {
        origin: "http://localhost:5173",
        signal: controller.signal,
        nowMs: Date.UTC(2026, 0, 1, 0, 1),
        store: "jsonl",
        fetchImpl: (async () => {
          fetches++;
          return { ok: true, status: 200 } as Response;
        }) as typeof fetch,
      });
      assert.equal(fetches, 0);
      assert.equal(run.fired.length, 0);
      assert.equal(readActivityLog(app, 10, "jsonl").length, 0);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

import { startTui, type TuiActions } from "../src/tui/run.ts";

class FakeInput {
  isTTY = true;
  rawMode: boolean[] = [];
  private listeners: Array<(str: string | undefined, key: { name?: string; ctrl?: boolean } | undefined) => void> = [];
  setRawMode(value: boolean): void {
    this.rawMode.push(value);
  }
  resume(): void {}
  pause(): void {}
  setEncoding(): void {}
  on(_event: "keypress", listener: (str: string | undefined, key: { name?: string } | undefined) => void): void {
    this.listeners.push(listener);
  }
  off(_event: "keypress", listener: (str: string | undefined, key: { name?: string } | undefined) => void): void {
    this.listeners = this.listeners.filter((item) => item !== listener);
  }
  press(str: string, key: { name?: string; ctrl?: boolean } = {}): void {
    for (const listener of [...this.listeners]) listener(str, key);
  }
}

class ThrowingRawInput extends FakeInput {
  override setRawMode(value: boolean): void {
    super.setRawMode(value);
    if (value) throw new Error("raw mode failed");
  }
}

class FakeOutput {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}

class FakeSignals {
  handlers = new Map<string, () => void>();
  on(signal: string, handler: () => void): void {
    this.handlers.set(signal, handler);
  }
  off(signal: string, _handler: () => void): void {
    this.handlers.delete(signal);
  }
  emit(signal: string): void {
    this.handlers.get(signal)?.();
  }
}

function fakeActions(over: Partial<TuiActions> = {}): TuiActions {
  return {
    load: () => snapshot(),
    trigger: async () => [],
    emit: () => ({ path: "/tmp/demo/void.crons.json" }),
    catchUp: async () => ({ fired: [], skipped: [] }),
    ...over,
  };
}

describe("tui runner", () => {
  it("refuses non-TTY streams before entering the alternate screen", async () => {
    const input = new FakeInput();
    input.isTTY = false;
    const output = new FakeOutput();
    const errors: string[] = [];
    const code = await startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        stderr: { write: (line: string) => errors.push(line) },
        signals: new FakeSignals() as never,
      },
    );
    assert.equal(code, 2);
    assert.ok(errors.join("").includes("interactive terminal"));
    assert.equal(output.chunks.length, 0);
  });

  it("rejects a missing app directory before entering the alternate screen", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const errors: string[] = [];
    const promise = startTui(
      {
        appPath: join(tmpdir(), `void-crons-missing-${process.pid}-${Date.now()}`),
        origin: "http://localhost:5173",
        storeMode: "jsonl",
        retries: 0,
        timeoutMs: 1000,
      },
      {
        stdin: input as never,
        stdout: output as never,
        stderr: { write: (line: string) => errors.push(line) },
        signals: new FakeSignals() as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
      },
    );
    input.press("q", { name: "q" });
    assert.equal(await promise, 2);
    assert.match(errors.join(""), /not a directory/);
    assert.ok(!output.chunks.some((chunk) => chunk.includes("\u001b[?1049h")));
  });

  it("restores the terminal when setup throws after entering", async () => {
    const input = new ThrowingRawInput();
    const output = new FakeOutput();
    const errors: string[] = [];
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        stderr: { write: (line: string) => errors.push(line) },
        signals: new FakeSignals() as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions(),
      },
    );
    assert.equal(await promise, 1);
    assert.match(errors.join(""), /raw mode failed/);
    assert.deepEqual(input.rawMode, [true, false]);
    assert.ok(output.chunks.at(-1)?.includes("\u001b[?1049l"));
  });

  it("quits cleanly and restores the terminal", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions(),
      },
    );
    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
    assert.deepEqual(input.rawMode, [true, false]);
    assert.ok(output.chunks.some((chunk) => chunk.includes("\u001b[?1049h")));
    assert.equal(output.chunks.filter((chunk) => chunk.includes("\u001b[?1049l")).length, 1);
    assert.ok(output.chunks.at(-1)?.includes("\u001b[?25h"));
  });

  it("runs one trigger at a time while busy", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let calls = 0;
    let finish: (() => void) | undefined;
    const actions = fakeActions({
      trigger: async () => {
        calls++;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return [];
      },
    });
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions,
      },
    );
    input.press("\r", { name: "return" });
    input.press("\r", { name: "return" });
    assert.equal(calls, 1);
    finish?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
  });

  it("reports an error instead of firing an invalid job", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let calls = 0;
    const actions = fakeActions({
      load: () => snapshot([job("broken", "invalid")]),
      trigger: async () => {
        calls++;
        return [];
      },
    });
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions,
      },
    );
    input.press("\r", { name: "return" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 0);
    const frame = output.chunks.at(-1) ?? "";
    assert.match(frame, /invalid/);
    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
  });

  it("passes the session disabled set to emit", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const emitted: string[][] = [];
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions({
          emit: (disabled) => {
            emitted.push(disabled);
            return { path: "/tmp/demo/void.crons.json" };
          },
        }),
      },
    );
    input.press("d", { name: "d" });
    input.press("e", { name: "e" });
    assert.deepEqual(emitted, [["alpha"]]);
    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
  });

  it("cleans up on SIGTERM", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const signals = new FakeSignals();
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: signals as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions(),
      },
    );
    signals.emit("SIGTERM");
    assert.equal(await promise, 143);
    assert.equal(output.chunks.filter((chunk) => chunk.includes("\u001b[?1049l")).length, 1);
  });

  it("cleans up on SIGINT", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const signals = new FakeSignals();
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: signals as never,
        setInterval: () => 1,
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions(),
      },
    );
    signals.emit("SIGINT");
    assert.equal(await promise, 130);
    assert.ok(output.chunks.at(-1)?.includes("\u001b[?1049l"));
  });
});

import { run } from "../src/cli.ts";
import type { TuiOptions } from "../src/tui/run.ts";

describe("ui command", () => {
  it("passes app and flag options to the TUI runner", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    try {
      const calls: TuiOptions[] = [];
      const fake = async (opts: TuiOptions): Promise<number> => {
        calls.push(opts);
        return 0;
      };
      const code = await run(
        ["ui", app, "--tz", "UTC", "--store", "jsonl", "--origin", "http://localhost:9999", "--retries", "2", "--timeout", "500"],
        process.cwd(),
        fake,
      );
      assert.equal(code, 0);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.appPath, app);
      assert.equal(calls[0]?.tz, "UTC");
      assert.equal(calls[0]?.storeMode, "jsonl");
      assert.equal(calls[0]?.origin, "http://localhost:9999");
      assert.equal(calls[0]?.retries, 2);
      assert.equal(calls[0]?.timeoutMs, 500);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("rejects --json and --all for the interactive UI", async () => {
    const app = makeApp({ "heartbeat.ts": HEARTBEAT });
    try {
      const fake = async (): Promise<number> => 0;
      assert.equal(await run(["ui", app, "--json"], process.cwd(), fake), 2);
      assert.equal(await run(["ui", app, "--all"], process.cwd(), fake), 2);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

import {
  nextActiveFireMs,
  selectedJob,
  visibleJobs,
} from "../src/tui/model.ts";

describe("tui live-ops model", () => {
  it("filters by name, path, or expression", () => {
    const s = state({
      jobs: [job("alpha"), job("beta", "active", ["*/15 * * * *"]), job("gamma")],
      filter: "*/15",
    });
    assert.deepEqual(visibleJobs(s).map((j) => j.name), ["beta"]);

    assert.deepEqual(
      visibleJobs({ ...s, filter: "crons/gamma" }).map((j) => j.name),
      ["gamma"],
    );
    assert.deepEqual(
      visibleJobs({ ...s, filter: "ALP" }).map((j) => j.name),
      ["alpha"],
    );
  });

  it("sorts by next fire, name, and status", () => {
    const jobs = [
      { ...job("zeta"), nextFireMs: 300 },
      { ...job("alpha"), nextFireMs: 100 },
      { ...job("beta", "disabled"), nextFireMs: null },
      { ...job("broken", "invalid"), nextFireMs: null },
    ];
    assert.deepEqual(
      visibleJobs(state({ jobs, sort: "next" })).map((j) => j.name),
      ["alpha", "zeta", "beta", "broken"],
    );
    assert.deepEqual(
      visibleJobs(state({ jobs, sort: "name" })).map((j) => j.name),
      ["alpha", "beta", "broken", "zeta"],
    );
    assert.deepEqual(
      visibleJobs(state({ jobs, sort: "status" })).map((j) => j.name),
      ["alpha", "zeta", "beta", "broken"],
    );
  });

  it("targets the visible selection, not the raw index", () => {
    const s = state({
      jobs: [job("alpha"), job("beta"), job("gamma")],
      filter: "gamma",
    });
    const selected = selectedJob(s);
    assert.equal(selected?.name, "gamma");

    const after = reduce(s, { type: "toggle" });
    assert.equal(after.jobs.find((j) => j.name === "gamma")?.status, "disabled");
    assert.equal(after.jobs.find((j) => j.name === "alpha")?.status, "active");
  });

  it("preserves the selected job by path across loaded snapshots", () => {
    const s = state({
      jobs: [job("alpha"), job("beta"), job("gamma")],
      selected: 1,
    });
    assert.equal(selectedJob(s)?.name, "beta");

    const loaded = reduce(s, {
      type: "loaded",
      snapshot: snapshot([job("gamma"), job("beta"), job("alpha")]),
    });
    assert.equal(selectedJob(loaded)?.name, "beta");
  });

  it("tracks loop start, results, and stop", () => {
    let s = state();
    s = reduce(s, { type: "loop-start", nowMs: 1_000 });
    assert.equal(s.loop.running, true);
    assert.equal(s.loop.checkpointMs, 1_000);

    s = reduce(s, {
      type: "loop-result",
      checkpointMs: 61_000,
      firedMinutes: new Map([["* * * * *", 1]]),
      fired: 2,
    });
    assert.equal(s.loop.checkpointMs, 61_000);
    assert.equal(s.loop.firedTotal, 2);

    s = reduce(s, { type: "loop-error", message: "boom" });
    assert.equal(s.loop.running, false);
    assert.equal(s.status?.kind, "error");

    s = reduce(s, { type: "loop-start", nowMs: 10_000 });
    s = reduce(s, { type: "loop-stop" });
    assert.equal(s.loop.running, false);
    assert.equal(s.loop.firedTotal, 0);
  });

  it("edits, applies, and clears the filter", () => {
    let s = state({ selected: 2 });
    s = reduce(s, { type: "filter-open" });
    assert.equal(s.filterInput, true);

    s = reduce(s, { type: "filter-char", char: "b" });
    s = reduce(s, { type: "filter-char", char: "e" });
    assert.equal(s.filter, "be");
    assert.equal(s.selected, 0);

    s = reduce(s, { type: "filter-backspace" });
    assert.equal(s.filter, "b");

    s = reduce(s, { type: "filter-apply" });
    assert.equal(s.filterInput, false);
    assert.equal(s.filter, "b");

    s = reduce(s, { type: "filter-clear" });
    assert.equal(s.filter, "");
    assert.equal(s.selected, 0);
  });

  it("cycles sort, toggles detail, and computes the next active fire", () => {
    let s = state({ sort: "next" });
    s = reduce(s, { type: "sort-cycle" });
    assert.equal(s.sort, "name");
    s = reduce(s, { type: "sort-cycle" });
    assert.equal(s.sort, "status");
    s = reduce(s, { type: "sort-cycle" });
    assert.equal(s.sort, "next");

    s = reduce(s, { type: "detail-toggle" });
    assert.equal(s.detail, true);
    s = reduce(s, { type: "escape" });
    assert.equal(s.detail, false);

    const withFires = state({
      jobs: [
        { ...job("a"), nextFireMs: 5_000 },
        { ...job("b"), nextFireMs: 2_000 },
        job("c", "disabled"),
      ],
    });
    assert.equal(nextActiveFireMs(withFires), 2_000);
  });
});

import { keyToMsg as keys } from "../src/tui/keys.ts";

describe("tui live-ops keys", () => {
  it("maps new normal-mode keys", () => {
    assert.deepEqual(keys("s", { name: "s" }), { type: "loop-toggle" });
    assert.deepEqual(keys("/", { name: "/" }), { type: "filter-open" });
    assert.deepEqual(keys("o", { name: "o" }), { type: "sort-cycle" });
    assert.deepEqual(keys("v", { name: "v" }), { type: "detail-toggle" });
    assert.deepEqual(keys(undefined, { name: "escape" }), { type: "escape" });
  });

  it("captures text while filtering", () => {
    assert.deepEqual(keys("a", { name: "a" }, true), { type: "filter-char", char: "a" });
    assert.deepEqual(keys(" ", { name: "space" }, true), { type: "filter-char", char: " " });
    assert.deepEqual(keys(undefined, { name: "backspace" }, true), { type: "filter-backspace" });
    assert.deepEqual(keys("\r", { name: "return" }, true), { type: "filter-apply" });
    assert.deepEqual(keys(undefined, { name: "escape" }, true), { type: "filter-clear" });
    assert.deepEqual(keys(undefined, { name: "up" }, true), null);
    assert.deepEqual(keys("\u0003", { name: "c", ctrl: true }, true), { type: "quit" });
  });
});

describe("tui live-ops render", () => {
  it("shows loop state, sort, and the detail line", () => {
    let s = state();
    let text = render(s, 60_000, false).join("\n");
    assert.match(text, /loop off/);
    assert.match(text, /sort next/);
    assert.match(text, /crons\/alpha\.ts/);

    s = reduce(s, { type: "loop-start", nowMs: 60_000 });
    s = reduce(s, {
      type: "loop-result",
      checkpointMs: 61_000,
      firedMinutes: new Map(),
      fired: 2,
    });
    text = render(s, 62_000, false).join("\n");
    assert.match(text, /loop LIVE · 2 fired/);
    assert.match(text, /status: live · 2 fired/);
  });

  it("renders filter input and the no-match state", () => {
    let s = state({ selected: 2 });
    s = reduce(s, { type: "filter-open" });
    s = reduce(s, { type: "filter-char", char: "z" });
    s = reduce(s, { type: "filter-char", char: "z" });
    const text = render(s, 60_000, false).join("\n");
    assert.match(text, /filter: zz/);
    assert.match(text, /enter apply/);
    assert.match(text, /no jobs match "zz"/);
    assert.match(text, /no job selected/);
  });

  it("renders the detail pane instead of activity", () => {
    const s = reduce(state(), { type: "detail-toggle" });
    const text = render(s, 60_000, false).join("\n");
    assert.match(text, /Detail · v close/);
    assert.match(text, /path: crons\/alpha\.ts/);
    assert.match(text, /expressions: \* \* \* \* \*/);
    assert.ok(!text.includes(" Activity"));
  });

  it("keeps the detail line inside narrow widths", () => {
    for (const [width, height] of [
      [88, 17],
      [39, 13],
    ] as const) {
      const lines = render(state({ width, height }), 60_000, false);
      assert.equal(lines.length, height);
      assert.ok(lines.every((line) => [...line].length <= width));
      assert.ok(lines.some((line) => line.includes("crons/alpha.ts")));
    }
  });
});

import { initScheduleState, tickSchedule } from "../src/schedule.ts";

describe("tickSchedule abort", () => {
  it("does not fetch when the loop signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetches = 0;
    const state = initScheduleState(Date.UTC(2026, 0, 1, 0, 0));
    const result = await tickSchedule(
      state,
      { active: new Map([["* * * * *", "alpha"]]), skipped: [] },
      {
        origin: "http://localhost:5173",
        nowMs: state.checkpointMs + 60_000,
        signal: controller.signal,
        fetchImpl: (async () => {
          fetches++;
          return { ok: true, status: 200 } as Response;
        }) as typeof fetch,
      },
    );
    assert.equal(fetches, 0);
    assert.equal(result.fired.length, 0);
  });
});
