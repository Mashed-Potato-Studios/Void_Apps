# void-crons TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `void-crons ui [app]`, a zero-dependency interactive TUI for inspecting and operating one app's cron jobs.

**Architecture:** Pure core plus a thin terminal adapter. `model.ts` owns state and a reducer; `data.ts` builds snapshots from existing library functions; `render.ts` turns state into width-safe text lines; `keys.ts` maps keypresses to messages; `run.ts` owns raw-mode terminal lifecycle and executes async actions. `cli.ts` wires the new `ui` command.

**Tech Stack:** TypeScript (NodeNext), Node >= 22.6, `node:test`, `node:readline` keypress events, ANSI escape codes, no new dependencies.

**Spec:** `docs/superpowers/specs/crons-tui.md`

## Global Constraints

- Zero new runtime dependencies.
- Node engine is `>=22.6`; no syntax newer than what that Node supports.
- One app per TUI; `--json` and `--all` are usage errors for `ui`.
- Toggles are session-only. Only `emit` writes `void.crons.json`.
- Terminal state must be restored on quit, SIGINT, SIGTERM, uncaught exception, and unhandled rejection.
- Tests must not require a pty. Render and reducer are pure and directly testable.
- `NO_COLOR` disables all ANSI styling.
- One action at a time; keys are ignored while busy except `q`/Ctrl-C.
- Follow existing `node:test` style: `describe`, `it`, `assert/strict`, `.ts` import specifiers.

## Review Focus

- **Terminal restore on non-quit exits:** Ctrl-C/SIGINT/SIGTERM and a thrown error must show the cursor and leave the alternate screen exactly once. Task 6 tests this with a fake signal source.
- **Narrow and short terminals:** at 50x20, 39x13, and very small sizes, no rendered line may exceed the terminal width and the footer must remain. Task 2 tests fixed widths and heights.
- **Empty or broken apps:** no `crons/` jobs, missing manifest, invalid jobs, and drift must render without throwing; actions on invalid rows report an error instead of firing. Tasks 2, 3, and 6 test these.
- **Busy overlap:** pressing Enter twice while a trigger is in flight must not fire two requests or write activity twice. Task 6 tests with a deferred trigger.
- **Non-TTY invocation:** piping stdout or running in CI must exit 2 before writing any alternate-screen escapes. Tasks 6 and 7 test this.

---

### Task 1: State model and reducer

**Files:**
- Create: `packages/crons/src/tui/model.ts`
- Create: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Consumes: `CronJob`, `CronActivityEntry` from `../types.js`.
- Produces:
  - `JobView extends CronJob { nextFireMs: number | null; last?: CronActivityEntry }`
  - `Snapshot { appName: string; jobs: JobView[]; manifest: "missing" | "clean" | "drift"; drift: string[]; activity: CronActivityEntry[]; disabled: string[]; scannedAt: number }`
  - `TuiState`, `Msg`, `StatusKind`
  - `createState(input): TuiState`
  - `reduce(state, msg): TuiState`
  - `jobRowsForHeight(height): number`, `activityRowsForHeight(height): number`

- [ ] **Step 1: Write the failing model tests**

Create `packages/crons/test/tui.test.ts` with:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createState, reduce, type JobView, type Snapshot, type TuiState } from "../src/tui/model.ts";
import type { CronActivityEntry, CronJob } from "../src/types.ts";

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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run from `packages/crons`:

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — cannot resolve `../src/tui/model.ts`.

- [ ] **Step 3: Implement `src/tui/model.ts`**

```ts
import type { CronActivityEntry, CronJob } from "../types.js";

export interface JobView extends CronJob {
  nextFireMs: number | null;
  last?: CronActivityEntry;
}

export type ManifestState = "missing" | "clean" | "drift";

export interface Snapshot {
  appName: string;
  jobs: JobView[];
  manifest: ManifestState;
  drift: string[];
  activity: CronActivityEntry[];
  disabled: string[];
  scannedAt: number;
}

export type StatusKind = "info" | "success" | "error";

export interface TuiState {
  appPath: string;
  appName: string;
  tz?: string;
  origin: string;
  storeMode: "sqlite" | "jsonl";
  jobs: JobView[];
  manifest: ManifestState;
  drift: string[];
  activity: CronActivityEntry[];
  selected: number;
  scroll: number;
  disabled: Set<string>;
  busy: string | null;
  status: { kind: StatusKind; message: string } | null;
  scannedAt: number;
  width: number;
  height: number;
  color: boolean;
}

export type Msg =
  | { type: "loaded"; snapshot: Snapshot }
  | { type: "move"; delta: number }
  | { type: "resize"; width: number; height: number }
  | { type: "toggle" }
  | { type: "trigger" }
  | { type: "emit" }
  | { type: "catchup" }
  | { type: "refresh" }
  | { type: "busy"; label: string | null }
  | { type: "status"; kind: StatusKind; message: string }
  | { type: "clear-status" }
  | { type: "quit" };

export function activityRowsForHeight(height: number): number {
  if (height < 14) return 0;
  return Math.min(5, Math.max(1, height - 9));
}

export function jobRowsForHeight(height: number): number {
  const activity = activityRowsForHeight(height);
  if (activity === 0) return Math.max(1, height - 6);
  return Math.max(1, height - 8 - activity);
}

export function createState(input: {
  appPath: string;
  origin: string;
  storeMode: "sqlite" | "jsonl";
  tz?: string;
  color: boolean;
  snapshot: Snapshot;
  width: number;
  height: number;
}): TuiState {
  return {
    appPath: input.appPath,
    appName: input.snapshot.appName,
    origin: input.origin,
    storeMode: input.storeMode,
    ...(input.tz ? { tz: input.tz } : {}),
    color: input.color,
    jobs: input.snapshot.jobs,
    manifest: input.snapshot.manifest,
    drift: input.snapshot.drift,
    activity: input.snapshot.activity,
    disabled: new Set(input.snapshot.disabled),
    selected: 0,
    scroll: 0,
    busy: null,
    status: null,
    scannedAt: input.snapshot.scannedAt,
    width: Math.max(20, input.width),
    height: Math.max(8, input.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function keepVisible(state: TuiState, selected: number, scroll: number): number {
  const rows = jobRowsForHeight(state.height);
  let next = scroll;
  if (selected < next) next = selected;
  else if (selected >= next + rows) next = selected - rows + 1;
  return clamp(next, 0, Math.max(0, state.jobs.length - rows));
}

export function reduce(state: TuiState, msg: Msg): TuiState {
  switch (msg.type) {
    case "loaded": {
      const selected = clamp(state.selected, 0, Math.max(0, msg.snapshot.jobs.length - 1));
      const next: TuiState = {
        ...state,
        jobs: msg.snapshot.jobs,
        manifest: msg.snapshot.manifest,
        drift: msg.snapshot.drift,
        activity: msg.snapshot.activity,
        disabled: new Set(msg.snapshot.disabled),
        scannedAt: msg.snapshot.scannedAt,
        selected,
        busy: null,
        status: null,
      };
      return { ...next, scroll: keepVisible(next, selected, state.scroll) };
    }
    case "move": {
      if (state.jobs.length === 0) return { ...state, status: null };
      const selected = clamp(state.selected + msg.delta, 0, state.jobs.length - 1);
      return { ...state, selected, scroll: keepVisible(state, selected, state.scroll), status: null };
    }
    case "resize": {
      const resized: TuiState = {
        ...state,
        width: Math.max(20, Math.floor(msg.width)),
        height: Math.max(8, Math.floor(msg.height)),
      };
      return { ...resized, scroll: keepVisible(resized, state.selected, state.scroll) };
    }
    case "toggle": {
      const job = state.jobs[state.selected];
      if (!job || job.status === "invalid") {
        return { ...state, status: { kind: "error", message: "cannot toggle an invalid job" } };
      }
      const disabled = new Set(state.disabled);
      const nowDisabled = !disabled.has(job.name);
      if (nowDisabled) disabled.add(job.name);
      else disabled.delete(job.name);
      const jobs = state.jobs.map((j) =>
        j.name === job.name ? { ...j, status: nowDisabled ? "disabled" : "active" } : j,
      );
      return {
        ...state,
        disabled,
        jobs,
        status: {
          kind: "info",
          message: `${job.name} ${nowDisabled ? "disabled" : "enabled"} (session only — e to persist)`,
        },
      };
    }
    case "trigger":
    case "emit":
    case "catchup":
    case "refresh":
      return { ...state, status: null };
    case "busy":
      return { ...state, busy: msg.label, status: null };
    case "status":
      return { ...state, busy: null, status: { kind: msg.kind, message: msg.message } };
    case "clear-status":
      return { ...state, status: null };
    case "quit":
      return state;
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/crons/src/tui/model.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): add TUI state model and reducer"
```

---

### Task 2: Width-safe renderer

**Files:**
- Create: `packages/crons/src/tui/render.ts`
- Modify: `packages/crons/test/tui.test.ts` (append tests)

**Interfaces:**
- Consumes: `TuiState`, `JobView`, `activityRowsForHeight`, `jobRowsForHeight` from `./model.js`; `CronActivityEntry` from `../types.js`.
- Produces: `render(state: TuiState, nowMs: number, color?: boolean): string[]`, `truncate(text: string, width: number): string`.

- [ ] **Step 1: Write the failing renderer tests**

Append to `packages/crons/test/tui.test.ts`:

```ts
import { render, truncate } from "../src/tui/render.ts";

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
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — cannot resolve `../src/tui/render.ts`.

- [ ] **Step 3: Implement `src/tui/render.ts`**

```ts
import type { CronActivityEntry } from "../types.js";
import { activityRowsForHeight, jobRowsForHeight, type JobView, type TuiState } from "./model.js";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const INVERT = `${ESC}7m`;

function style(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${RESET}` : text;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  const chars = [...text];
  if (chars.length <= width) return text;
  if (width === 1) return "…";
  return `${chars.slice(0, width - 1).join("")}…`;
}

function pad(text: string, width: number): string {
  return truncate(text, width).padEnd(width, " ");
}

function rule(width: number): string {
  return "─".repeat(width);
}

function twoCol(left: string, right: string, width: number): string {
  const l = truncate(left, width);
  const r = truncate(right, width);
  const gap = width - [...l].length - [...r].length;
  if (gap <= 0) return truncate(l, width);
  return truncate(`${l}${" ".repeat(gap)}${r}`, width);
}

function originLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function clock(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

function hhmm(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--:--" : date.toTimeString().slice(0, 5);
}

function fmtNext(job: JobView, nowMs: number): string {
  if (job.status === "disabled") return "disabled";
  if (job.status === "invalid") return "invalid";
  if (job.nextFireMs === null) return "never";
  const seconds = Math.max(60, Math.round((job.nextFireMs - nowMs) / 1000));
  if (seconds < 120) return "next <2m";
  if (seconds < 5400) return `next ${Math.round(seconds / 60)}m`;
  return `next ${Math.round(seconds / 3600)}h`;
}

function fmtLast(job: JobView, nowMs: number): string {
  if (!job.last) return "—";
  const finished = new Date(job.last.finishedAt).getTime();
  if (Number.isNaN(finished)) return job.last.status;
  const minutes = Math.max(0, Math.round((nowMs - finished) / 60_000));
  const when = minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  return `last ${job.last.status === "success" ? "ok" : "fail"} ${when}`;
}

function markerFor(job: JobView): { text: string; code: string } {
  if (job.status === "active") return { text: "●", code: GREEN };
  if (job.status === "disabled") return { text: "○", code: YELLOW };
  return { text: "✕", code: RED };
}

function jobRow(job: JobView, selected: boolean, width: number, nowMs: number, color: boolean): string {
  const sel = selected ? ">" : " ";
  const marker = markerFor(job);
  const next = fmtNext(job, nowMs);
  const expr = job.status === "invalid" ? (job.error ?? "invalid") : job.expressions.join(", ");

  let line: string;
  if (width >= 70) {
    const nameW = 16;
    const exprW = Math.max(12, Math.floor(width * 0.32));
    const nextW = 14;
    const lastW = Math.max(8, width - nameW - exprW - nextW - 6);
    line = `${sel}${marker.text} ${pad(job.name, nameW)} ${pad(expr, exprW)} ${pad(next, nextW)} ${pad(fmtLast(job, nowMs), lastW)}`;
  } else if (width >= 40) {
    const nameW = Math.max(8, width - 21);
    line = `${sel}${marker.text} ${pad(job.name, nameW)} ${pad(next, 14)}`;
  } else {
    line = `${sel}${marker.text} ${pad(job.name, Math.max(4, width - 12))} ${truncate(next, 8)}`;
  }
  const padded = pad(line, width);
  if (selected) return style(padded, INVERT, color);
  if (!color) return padded;
  const index = padded.indexOf(marker.text);
  if (index === -1) return padded;
  return `${padded.slice(0, index)}${style(marker.text, marker.code, true)}${padded.slice(index + marker.text.length)}`;
}

function activityRow(entry: CronActivityEntry, width: number): string {
  const status = entry.status === "success" ? "ok" : "fail";
  return pad(
    truncate(`  ↳ ${hhmm(entry.finishedAt)} ${entry.jobName} ${entry.cron} ${status} ${entry.durationMs}ms`, width),
    width,
  );
}

function keysLine(width: number): string {
  const full = " ↑↓/jk move · enter trigger · d toggle · e emit · c catch-up · r refresh · q quit";
  const mid = " ↑↓ move · ↵ trigger · d toggle · e emit · c catch-up · r refresh · q quit";
  const small = " ↑↓ move · ↵ trigger · d/e/c/r · q quit";
  return truncate(width >= 84 ? full : width >= 64 ? mid : small, width);
}

function statusLine(state: TuiState, width: number): string {
  if (state.busy) return pad(` status: ${state.busy}…`, width);
  if (!state.status) return pad(" status: ready", width);
  const label =
    state.status.kind === "error" ? "error: " : state.status.kind === "success" ? "ok: " : "";
  const text = pad(` status: ${label}${state.status.message}`, width);
  if (state.status.kind === "error") return style(text, RED, state.color);
  if (state.status.kind === "success") return style(text, GREEN, state.color);
  return text;
}

export function render(state: TuiState, nowMs: number, color = state.color): string[] {
  const width = Math.max(20, state.width);
  const height = Math.max(8, state.height);
  const lines: string[] = [];

  const active = state.jobs.filter((job) => job.status === "active");
  const expressions = new Set(active.flatMap((job) => job.expressions)).size;
  const schedules = active.reduce((count, job) => count + job.expressions.length, 0);
  const manifestNote =
    state.manifest === "drift" ? `manifest drift (${state.drift.length})` : `manifest ${state.manifest}`;

  lines.push(
    twoCol(
      ` void-crons · ${state.appName}`,
      `${state.tz ? `tz ${state.tz}` : "tz local"} · ${state.storeMode} · ${originLabel(state.origin)}`,
      width,
    ),
  );
  lines.push(
    twoCol(
      ` ${state.jobs.length} jobs · ${expressions} expr · ${schedules} sched`,
      `${manifestNote} · scan ${clock(state.scannedAt)}`,
      width,
    ),
  );
  lines.push(rule(width));

  const rows = jobRowsForHeight(height);
  const viewport = state.jobs.slice(state.scroll, state.scroll + rows);
  const selectedIndex = state.selected - state.scroll;
  for (let i = 0; i < rows; i++) {
    const job = viewport[i];
    if (!job) {
      lines.push(" ".repeat(width));
      continue;
    }
    lines.push(jobRow(job, i === selectedIndex, width, nowMs, color));
  }
  lines.push(rule(width));

  const activityRows = activityRowsForHeight(height);
  if (activityRows > 0) {
    lines.push(
      pad(
        state.drift.length > 0 ? ` Drift (${state.drift.length}) · Activity` : " Activity",
        width,
      ),
    );
    const drift = state.drift.slice(0, activityRows);
    for (const line of drift) lines.push(pad(`  ${line}`, width));
    const entries = state.activity.slice(0, activityRows - drift.length);
    for (const entry of entries) lines.push(activityRow(entry, width));
    const used = drift.length + entries.length;
    for (let i = used; i < activityRows; i++) lines.push(" ".repeat(width));
    lines.push(rule(width));
  }

  lines.push(pad(keysLine(width), width));
  lines.push(statusLine(state, width));
  return lines.slice(0, height);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Same focused command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/render.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): add width-safe TUI renderer"
```

### Task 3: Snapshot loader

**Files:**
- Create: `packages/crons/src/tui/data.ts`
- Modify: `packages/crons/test/tui.test.ts` (append tests)

**Interfaces:**
- Consumes: `scanCronFiles` (`../scan.js`), `readCronManifest` + `detectDrift` (`../manifest.js`), `readActivityLog` + `ActivityStoreMode` (`../store.js`), `computeDue` (`../schedule.js`), `JobView`/`Snapshot` (`./model.js`).
- Produces: `loadSnapshot(appPath: string, opts?: SnapshotOptions): Snapshot`, `SnapshotOptions { disabled?: string[]; tz?: string; storeMode?: ActivityStoreMode; activityLimit?: number; nowMs?: number }`.

- [ ] **Step 1: Write the failing loader tests**

Append to `packages/crons/test/tui.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadSnapshot } from "../src/tui/data.ts";
import { appendActivityLog } from "../src/store.ts";
import { emitCronManifest } from "../src/manifest.ts";

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
      writeFileSync(join(app, "crons", "heartbeat.ts"), `${HEARTBEAT}// changed\n`);
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
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — cannot resolve `../src/tui/data.ts`.

- [ ] **Step 3: Implement `src/tui/data.ts`**

```ts
import { basename } from "node:path";
import { detectDrift, readCronManifest } from "../manifest.js";
import { scanCronFiles } from "../scan.js";
import { computeDue } from "../schedule.js";
import { readActivityLog, type ActivityStoreMode } from "../store.js";
import type { CronActivityEntry, CronJob } from "../types.js";
import type { JobView, ManifestState, Snapshot } from "./model.js";

const PREVIEW_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

export interface SnapshotOptions {
  disabled?: string[];
  tz?: string;
  storeMode?: ActivityStoreMode;
  activityLimit?: number;
  nowMs?: number;
}

function nextFire(job: CronJob, nowMs: number, tz?: string): number | null {
  const due = computeDue(job.expressions, nowMs + 1, nowMs + PREVIEW_WINDOW_MS, tz ? { tz } : {})[0];
  return due ? due.dueMs : null;
}

export function loadSnapshot(appPath: string, opts: SnapshotOptions = {}): Snapshot {
  const nowMs = opts.nowMs ?? Date.now();
  const storeMode = opts.storeMode ?? "sqlite";
  const stored = readCronManifest(appPath);
  const disabled = opts.disabled ?? stored?.disabled ?? [];
  const jobs = scanCronFiles(appPath, { disabled });
  const activity = readActivityLog(appPath, opts.activityLimit ?? 10, storeMode);
  const lastByJob = new Map<string, CronActivityEntry>();
  for (const entry of activity) {
    if (!lastByJob.has(entry.jobName)) lastByJob.set(entry.jobName, entry);
  }
  const views: JobView[] = jobs.map((job) => {
    const last = lastByJob.get(job.name);
    return {
      ...job,
      nextFireMs: job.status === "active" ? nextFire(job, nowMs, opts.tz) : null,
      ...(last ? { last } : {}),
    };
  });
  let manifest: ManifestState = "missing";
  let drift: string[] = [];
  if (stored) {
    drift = detectDrift(stored, scanCronFiles(appPath, { disabled }), { disabled });
    manifest = drift.length > 0 ? "drift" : "clean";
  }
  return {
    appName: basename(appPath),
    jobs: views,
    manifest,
    drift,
    activity,
    disabled: [...disabled].sort(),
    scannedAt: nowMs,
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Same focused command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/data.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): add TUI snapshot loader"
```

---

### Task 4: Key mapping

**Files:**
- Create: `packages/crons/src/tui/keys.ts`
- Modify: `packages/crons/test/tui.test.ts` (append tests)

**Interfaces:**
- Consumes: `Msg` from `./model.js`.
- Produces: `KeyPress { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }`, `keyToMsg(str: string | undefined, key: KeyPress | undefined): Msg | null`.

- [ ] **Step 1: Write the failing key tests**

Append to `packages/crons/test/tui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — cannot resolve `../src/tui/keys.ts`.

- [ ] **Step 3: Implement `src/tui/keys.ts`**

```ts
import type { Msg } from "./model.js";

export interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export function keyToMsg(str: string | undefined, key: KeyPress | undefined): Msg | null {
  if (key?.ctrl && key.name === "c") return { type: "quit" };

  switch (key?.name) {
    case "up":
      return { type: "move", delta: -1 };
    case "down":
      return { type: "move", delta: 1 };
    case "return":
    case "enter":
      return { type: "trigger" };
    default:
      break;
  }

  switch (str?.toLowerCase()) {
    case "k":
      return { type: "move", delta: -1 };
    case "j":
      return { type: "move", delta: 1 };
    case "d":
      return { type: "toggle" };
    case "e":
      return { type: "emit" };
    case "c":
      return { type: "catchup" };
    case "r":
      return { type: "refresh" };
    case "q":
      return { type: "quit" };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Same focused command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/keys.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): map TUI keypresses to actions"
```

---

### Task 5: Abort plumbing for in-flight actions

**Files:**
- Modify: `packages/crons/src/types.ts` (`CronTriggerOptions`)
- Modify: `packages/crons/src/trigger.ts` (`postOnce`, `triggerExpression`)
- Modify: `packages/crons/src/schedule.ts` (`ScheduleOptions`, `runScheduleOnce`)
- Modify: `packages/crons/test/tui.test.ts` (append test)

**Interfaces:**
- Consumes: existing trigger and schedule code.
- Produces:
  - `CronTriggerOptions.signal?: AbortSignal`
  - `ScheduleOptions.signal?: AbortSignal`
  - Aborted trigger results: `{ ok: false, httpStatus: 0, entry.status: "failed", entry.error: "aborted", attempts: 1, retried: false }`.

- [ ] **Step 1: Write the failing abort test**

Append to `packages/crons/test/tui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — TypeScript/runtime rejects the unknown `signal` property or the fetch runs (`fetches === 1`).

- [ ] **Step 3: Add `signal` to `CronTriggerOptions`**

In `src/types.ts`, inside `CronTriggerOptions`, after `retryBaseMs`:

```ts
  /** Abort in-flight attempts (TUI quit). Aborting never retries. */
  signal?: AbortSignal;
```

- [ ] **Step 4: Honor the signal in `trigger.ts`**

In `postOnce`, replace the controller setup so the fetch signal is composed:

```ts
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  try {
    const res = (await fetchImpl(url, { method: "POST", ...init, signal })) as unknown as {
      ok: boolean;
      status: number;
    };
```

In `triggerExpression`, add a guard at the top of the `for (;;)` loop:

```ts
  for (;;) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", "aborted"),
        httpStatus: 0,
        attempts: Math.max(1, attempt),
        retried: false,
      };
    }
    attempt++;
```

After the `catch` block and before `await sleep(...)`, add:

```ts
    if (opts.signal?.aborted) {
      return {
        ok: false,
        entry: mkEntry(opts, jobName, expression, scheduledTime, startedAt, "failed", "aborted"),
        httpStatus: 0,
        attempts: attempt,
        retried: attempt > 1,
      };
    }
    await sleep(retryBaseMs * 2 ** (attempt - 1));
```

- [ ] **Step 5: Thread the signal through `schedule.ts`**

Add to `ScheduleOptions`:

```ts
  signal?: AbortSignal;
```

In `runScheduleOnce`, add `signal: opts.signal` to the `triggerExpression(expr, active.get(expr)!, { ... })` options object.

- [ ] **Step 6: Run the tests and verify they pass**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the full package test suite**

```bash
pnpm test
```

Expected: PASS (existing trigger/schedule tests unaffected).

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/types.ts packages/crons/src/trigger.ts packages/crons/src/schedule.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): allow aborting trigger and catch-up work"
```

### Task 6: Terminal runner and headless tests

**Files:**
- Create: `packages/crons/src/tui/run.ts`
- Modify: `packages/crons/test/tui.test.ts` (append tests)

**Interfaces:**
- Consumes: `loadSnapshot`, `triggerJob`, `emitCronManifest`, `runScheduleOnce`, `appendActivityLog`, `render`, `keyToMsg`, `createState`, `reduce`.
- Produces:
  - `TuiOptions { appPath: string; origin: string; storeMode: "sqlite" | "jsonl"; tz?: string; devToken?: string; retries: number; timeoutMs: number; color?: boolean }`
  - `TuiActions { load(disabled?: string[]): Snapshot; trigger(job: JobView, signal: AbortSignal): Promise<CronTriggerResult[]>; emit(disabled: string[]): { path: string }; catchUp(disabled: string[], signal: AbortSignal): Promise<ScheduleRun> }`
  - `TuiDeps { stdin?; stdout?; stderr?; now?; actions?; signals?; setInterval?; clearInterval? }`
  - `startTui(opts: TuiOptions, deps?: TuiDeps): Promise<number>`

- [ ] **Step 1: Write the failing runner tests**

Append to `packages/crons/test/tui.test.ts`:

```ts
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
      { appPath: "/tmp/demo", origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
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

  it("quits cleanly and restores the terminal", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const promise = startTui(
      { appPath: "/tmp/demo", origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
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
    assert.ok(output.chunks.at(-1)?.includes("\u001b[?1049l"));
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
      { appPath: "/tmp/demo", origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
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
      { appPath: "/tmp/demo", origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
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
      { appPath: "/tmp/demo", origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
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

  it("cleans up on SIGINT", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const signals = new FakeSignals();
    const promise = startTui(
      { appPath: "/tmp/demo", origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
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
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — cannot resolve `../src/tui/run.ts`.

- [ ] **Step 3: Implement `src/tui/run.ts`**

```ts
import { emitKeypressEvents } from "node:readline";
import { emitCronManifest } from "../manifest.js";
import { runScheduleOnce, type ScheduleRun } from "../schedule.js";
import { appendActivityLog, type ActivityStoreMode } from "../store.js";
import { triggerJob } from "../trigger.js";
import type { CronTriggerResult } from "../types.js";
import { loadSnapshot } from "./data.js";
import { keyToMsg, type KeyPress } from "./keys.js";
import {
  createState,
  reduce,
  type JobView,
  type Msg,
  type Snapshot,
  type StatusKind,
  type TuiState,
} from "./model.js";
import { render } from "./render.js";

export interface TuiOptions {
  appPath: string;
  origin: string;
  storeMode: ActivityStoreMode;
  tz?: string;
  devToken?: string;
  retries: number;
  timeoutMs: number;
  color?: boolean;
}

export interface TuiActions {
  load(disabled?: string[]): Snapshot;
  trigger(job: JobView, signal: AbortSignal): Promise<CronTriggerResult[]>;
  emit(disabled: string[]): { path: string };
  catchUp(disabled: string[], signal: AbortSignal): Promise<ScheduleRun>;
}

interface InputStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
  setEncoding(encoding: BufferEncoding): void;
  on(event: "keypress", listener: (str: string | undefined, key: KeyPress | undefined) => void): void;
  off(event: "keypress", listener: (str: string | undefined, key: KeyPress | undefined) => void): void;
}

interface OutputStream {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  write(chunk: string): unknown;
}

export interface TuiSignals {
  on(signal: "SIGINT" | "SIGTERM" | "SIGWINCH", handler: () => void): void;
  off(signal: "SIGINT" | "SIGTERM" | "SIGWINCH", handler: () => void): void;
}

export interface TuiDeps {
  stdin?: InputStream;
  stdout?: OutputStream;
  stderr?: { write(chunk: string): unknown };
  now?: () => number;
  actions?: TuiActions;
  signals?: TuiSignals;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}

const ENTER = "\u001b[?1049h\u001b[?25l";
const LEAVE = "\u001b[?25h\u001b[?1049l";
const TICK_MS = 1000;

function createActions(opts: TuiOptions): TuiActions {
  return {
    load: (disabled) =>
      loadSnapshot(opts.appPath, { disabled, tz: opts.tz, storeMode: opts.storeMode }),
    trigger: async (job, signal) => {
      const results = await triggerJob(job, {
        origin: opts.origin,
        ...(opts.devToken ? { devToken: opts.devToken } : {}),
        timeoutMs: opts.timeoutMs,
        maxAttempts: opts.retries + 1,
        signal,
      });
      const entries = results.flatMap((result) => (result.entry ? [result.entry] : []));
      appendActivityLog(opts.appPath, entries, opts.storeMode);
      return results;
    },
    emit: (disabled) => emitCronManifest(opts.appPath, { disabled }),
    catchUp: (disabled, signal) =>
      runScheduleOnce(opts.appPath, {
        origin: opts.origin,
        ...(opts.devToken ? { devToken: opts.devToken } : {}),
        disabled,
        ...(opts.tz ? { tz: opts.tz } : {}),
        timeoutMs: opts.timeoutMs,
        maxAttempts: opts.retries + 1,
        signal,
        store: opts.storeMode,
      }),
  };
}

export async function startTui(opts: TuiOptions, deps: TuiDeps = {}): Promise<number> {
  const stdin = deps.stdin ?? process.stdin;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const now = deps.now ?? Date.now;
  const actions = deps.actions ?? createActions(opts);
  const color = opts.color ?? !process.env["NO_COLOR"];

  if (!stdin.isTTY || !stdout.isTTY) {
    stderr.write("error: void-crons ui needs an interactive terminal (stdin/stdout TTY)\n");
    return 2;
  }

  let snapshot: Snapshot;
  try {
    snapshot = actions.load();
  } catch (error) {
    stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  let state: TuiState = createState({
    appPath: opts.appPath,
    origin: opts.origin,
    storeMode: opts.storeMode,
    ...(opts.tz ? { tz: opts.tz } : {}),
    color,
    snapshot,
    width: stdout.columns ?? 80,
    height: stdout.rows ?? 24,
  });

  const signals: TuiSignals =
    deps.signals ?? {
      on: (signal, handler) => {
        process.on(signal, handler);
      },
      off: (signal, handler) => {
        process.removeListener(signal, handler);
      },
    };

  return new Promise<number>((resolve) => {
    let settled = false;
    let busy = false;
    let aborter: AbortController | null = null;
    let timer: unknown;
    let fatalInstalled = false;
    const clearTimer = deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

    const draw = (): void => {
      stdout.write(`\u001b[H${render(state, now(), color).join("\n")}\u001b[J`);
    };

    const cleanup = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimer(timer);
      stdin.off("keypress", onKey);
      signals.off("SIGINT", onSigint);
      signals.off("SIGTERM", onSigterm);
      signals.off("SIGWINCH", onResize);
      if (fatalInstalled) {
        process.removeListener("uncaughtException", onFatal);
        process.removeListener("unhandledRejection", onFatal);
      }
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write(LEAVE);
      resolve(code);
    };

    const setStatus = (kind: StatusKind, message: string): void => {
      state = reduce(state, { type: "status", kind, message });
      busy = false;
      aborter = null;
      draw();
    };

    const refresh = (kind: StatusKind, message: string): void => {
      try {
        state = reduce(state, { type: "loaded", snapshot: actions.load([...state.disabled]) });
        setStatus(kind, message);
      } catch (error) {
        setStatus("error", error instanceof Error ? error.message : String(error));
      }
    };

    const actTrigger = async (): Promise<void> => {
      const job = state.jobs[state.selected];
      if (!job) {
        setStatus("error", "no job selected");
        return;
      }
      if (job.status === "disabled") {
        setStatus("error", `job "${job.name}" is disabled`);
        return;
      }
      if (job.status === "invalid") {
        setStatus("error", job.error ?? `job "${job.name}" is invalid`);
        return;
      }
      busy = true;
      aborter = new AbortController();
      state = reduce(state, { type: "busy", label: `trigger ${job.name}` });
      draw();
      try {
        const results = await actions.trigger(job, aborter.signal);
        if (settled) return;
        const fired = results.filter((result) => result.ok).length;
        const failed = results.filter((result) => !result.ok && !result.skipped);
        if (failed.length === 0) {
          refresh("success", `fired ${job.name} (${fired}/${results.length})`);
        } else {
          const reason = failed[0]?.entry?.error ?? failed[0]?.reason ?? "unknown";
          refresh("error", `fired ${job.name}: ${fired} ok, ${failed.length} failed (${reason})`);
        }
      } catch (error) {
        if (settled) return;
        setStatus("error", error instanceof Error ? error.message : String(error));
      }
    };

    const actEmit = (): void => {
      try {
        const disabled = [...state.disabled].sort();
        const { path } = actions.emit(disabled);
        state = reduce(state, { type: "loaded", snapshot: actions.load(disabled) });
        setStatus("success", `emitted ${path}`);
      } catch (error) {
        setStatus("error", error instanceof Error ? error.message : String(error));
      }
    };

    const actCatchUp = async (): Promise<void> => {
      busy = true;
      aborter = new AbortController();
      state = reduce(state, { type: "busy", label: "catch-up" });
      draw();
      try {
        const run = await actions.catchUp([...state.disabled], aborter.signal);
        if (settled) return;
        refresh("success", `caught up (${run.fired.length} fired, ${run.skipped.length} skipped)`);
      } catch (error) {
        if (settled) return;
        setStatus("error", error instanceof Error ? error.message : String(error));
      }
    };

    const onKey = (str: string | undefined, key: KeyPress | undefined): void => {
      const msg: Msg | null = keyToMsg(str, key);
      if (!msg) return;
      if (msg.type === "quit") {
        aborter?.abort();
        cleanup(0);
        return;
      }
      if (busy) return;
      state = reduce(state, msg);
      draw();
      if (msg.type === "trigger") void actTrigger();
      else if (msg.type === "emit") actEmit();
      else if (msg.type === "catchup") void actCatchUp();
      else if (msg.type === "refresh") refresh("info", "rescanned");
    };

    const onResize = (): void => {
      state = reduce(state, {
        type: "resize",
        width: stdout.columns ?? state.width,
        height: stdout.rows ?? state.height,
      });
      if (!settled) draw();
    };

    const onSigint = (): void => {
      aborter?.abort();
      cleanup(130);
    };

    const onSigterm = (): void => {
      aborter?.abort();
      cleanup(143);
    };

    const onFatal = (error: unknown): void => {
      aborter?.abort();
      stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      cleanup(1);
    };

    if (!deps.stdin) emitKeypressEvents(process.stdin);
    stdin.setEncoding("utf8");
    stdin.setRawMode?.(true);
    stdin.resume();
    stdout.write(ENTER);
    stdin.on("keypress", onKey);
    signals.on("SIGINT", onSigint);
    signals.on("SIGTERM", onSigterm);
    signals.on("SIGWINCH", onResize);
    process.once("uncaughtException", onFatal);
    process.once("unhandledRejection", onFatal);
    fatalInstalled = true;
    timer = (deps.setInterval ?? setInterval)(draw, TICK_MS);
    draw();
  });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full package test suite**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/run.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): add interactive TUI runner"
```

---

### Task 7: CLI command, exports, and docs

**Files:**
- Modify: `packages/crons/src/cli.ts`
- Modify: `packages/crons/package.json`
- Modify: `packages/crons/README.md`
- Modify: `packages/crons/test/tui.test.ts` (append tests)

**Interfaces:**
- Consumes: `startTui`, `TuiOptions` from `./tui/run.js`.
- Produces: `run(argv: string[], cwd: string, ui?: (opts: TuiOptions) => Promise<number>): Promise<number>`; `void-crons ui [app]`; `./tui` export.

- [ ] **Step 1: Write the failing CLI tests**

Append to `packages/crons/test/tui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — `ui` is not a recognized command or `run` ignores the injected runner.

- [ ] **Step 3: Wire `ui` into `src/cli.ts`**

Add the import at the top:

```ts
import { startTui, type TuiOptions } from "./tui/run.js";
```

Change the exported signature:

```ts
export async function run(
  argv: string[],
  cwd: string,
  ui: (opts: TuiOptions) => Promise<number> = startTui,
): Promise<number> {
```

Add the `ui` line to `USAGE` after `list`:

```ts
  "  ui [app-path] [--tz ZONE] [--store sqlite|jsonl] [--origin URL] [--token T] [--retries N] [--timeout MS]  interactive dashboard + actions",
```

Immediately after `const ci = flags.has("--ci");`, add:

```ts
  if (cmd === "ui" && (all || json)) {
    console.log("error: ui is single-app and interactive — --json/--all are not supported");
    return 2;
  }
```

Add a `case "ui"` before `case "list"`:

```ts
    case "ui": {
      const app = apps[0];
      if (!app) {
        console.log("error: ui needs one app path");
        return 2;
      }
      return ui({
        appPath: app,
        origin,
        ...(tz ? { tz } : {}),
        storeMode,
        ...(token ?? process.env["VOID_DEV_TRIGGER"]
          ? { devToken: token ?? process.env["VOID_DEV_TRIGGER"] }
          : {}),
        retries,
        timeoutMs,
      });
    }
```

- [ ] **Step 4: Add the package export**

In `packages/crons/package.json`, add to the top-level `exports`, before `"./package.json"`:

```json
    "./tui": "./src/tui/run.ts",
```

Add to `publishConfig.exports`, before `"./package.json"`:

```json
      "./tui": "./dist/tui/run.js",
```

- [ ] **Step 5: Update the README**

Add a row to the CLI reference table after `list`:

```markdown
| `ui [app] [--tz Z] [--store MODE] [--origin URL]` | Interactive TUI: jobs, countdowns, drift, activity; trigger/toggle/emit/catch-up | `2` if not a TTY or `--json`/`--all` used |
```

Add a section after the Quick start block:

````markdown
## TUI

```bash
void-crons ui apps/api
```

One app, live in the terminal. Countdowns tick every second; manifest state and
activity refresh after every action.

| Key | Action |
|---|---|
| `↑` / `↓`, `j` / `k` | Move selection |
| `enter` | Trigger the selected job (all its expressions) |
| `d` | Toggle enabled/disabled for this session |
| `e` | Emit `void.crons.json` — the only action that persists toggles |
| `c` | Catch up: fire each expression's most recent due time in the last 24h |
| `r` | Rescan jobs, manifest, drift, and activity |
| `q` / `Ctrl-C` | Quit and restore the terminal |

Toggles are session-only until `e`. `ui` is single-app and interactive:
`--json` and `--all` are rejected, and non-TTY stdin/stdout exits `2`.
````

- [ ] **Step 6: Run the full test suite**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/cli.ts packages/crons/package.json packages/crons/README.md packages/crons/test/tui.test.ts
git commit -m "feat(crons): add ui command, exports, and docs"
```


