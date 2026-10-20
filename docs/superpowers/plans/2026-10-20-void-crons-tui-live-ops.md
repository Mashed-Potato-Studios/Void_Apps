# void-crons TUI Live Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live scheduling, filtering/sorting, job detail, and filesystem auto-refresh to `void-crons ui`.

**Architecture:** Extend the existing pure TUI state machine with loop/filter/sort/detail state, then have the runner drive `tickSchedule` from its 1 Hz tick. A new `watch.ts` wraps two `fs.watch` handles behind a debounce and an injectable factory. No new runtime dependencies.

**Tech Stack:** TypeScript (NodeNext), Node >= 22.6, `node:test`, `node:fs.watch`, existing `schedule.ts`/`trigger.ts`.

**Spec:** `docs/superpowers/specs/crons-tui-live-ops.md`

## Global Constraints

- Zero new runtime dependencies.
- One app per TUI; loop starts stopped; no backfill on start.
- Loop ticks never overlap each other. Manual actions suppress new loop ticks.
- Toggles stay session-only; only `emit` writes `void.crons.json`.
- Terminal restored on quit, SIGINT, SIGTERM, fatal errors, and setup throws.
- Tests never require a pty.
- Package README stays generic (`path/to/your-app`, no monorepo paths).
- Minor version bump to `0.3.0` on release.

## Review Focus

- **Loop/manual overlap:** a manual trigger, catch-up, or emit while a loop tick is in flight must not double-apply results, double-write activity, or clear `busy` incorrectly. Task 6 tests with a deferred tick.
- **Quit/stop mid-tick:** stopping or quitting while a tick awaits HTTP must abort it, write no synthetic activity, and leave no pending interval. Tasks 4 and 6 test aborts.
- **Watcher feedback storm:** activity DB/JSONL writes must not trigger rescans. Task 5 tests ignored filenames; Task 6 tests debounced refresh.
- **Selection after filter/refresh:** a rescan while filtered must keep the same job selected by path, and trigger/toggle must hit the visible selection, not the old index. Task 1 tests this directly.
- **Narrow terminals with the new detail line:** at 88×17 and 39×13 no line exceeds width, the footer survives, and the detail line truncates. Task 3 tests both.

---

### Task 1: Loop, filter, sort, detail state

**Files:**
- Modify: `packages/crons/src/tui/model.ts`
- Modify: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Consumes: existing `CronJob`, `CronActivityEntry`, `JobView`, `Snapshot`, `TuiState`, `Msg`.
- Produces:
  - `SortMode = "next" | "name" | "status"`
  - `LoopState { running; checkpointMs; firedMinutes; firedTotal }`
  - `TuiState` fields: `loop`, `filter`, `filterInput`, `sort`, `detail`
  - `visibleJobs(state): JobView[]`
  - `selectedJob(state): JobView | undefined`
  - `nextActiveFireMs(state): number | null`
  - New `Msg` variants: `loop-toggle`, `loop-start`, `loop-stop`, `loop-result`, `loop-error`, `filter-open`, `filter-char`, `filter-backspace`, `filter-apply`, `filter-clear`, `sort-cycle`, `detail-toggle`, `escape`.

- [ ] **Step 1: Append failing model tests**

Append to `packages/crons/test/tui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify they fail**

From `packages/crons`:

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — `visibleJobs`/`selectedJob` not exported and new message types rejected.

- [ ] **Step 3: Rewrite `src/tui/model.ts` with the new state machine**

```ts
import type { CronActivityEntry, CronJob } from "../types.js";

export interface JobView extends CronJob {
  nextFireMs: number | null;
  last?: CronActivityEntry;
}

export type ManifestState = "missing" | "clean" | "drift";
export type SortMode = "next" | "name" | "status";

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

export interface LoopState {
  running: boolean;
  checkpointMs: number;
  firedMinutes: Map<string, number>;
  firedTotal: number;
}

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
  loop: LoopState;
  filter: string;
  filterInput: boolean;
  sort: SortMode;
  detail: boolean;
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
  | { type: "quit" }
  | { type: "loop-toggle" }
  | { type: "loop-start"; nowMs: number }
  | { type: "loop-stop" }
  | {
      type: "loop-result";
      checkpointMs: number;
      firedMinutes: Map<string, number>;
      fired: number;
    }
  | { type: "loop-error"; message: string }
  | { type: "filter-open" }
  | { type: "filter-char"; char: string }
  | { type: "filter-backspace" }
  | { type: "filter-apply" }
  | { type: "filter-clear" }
  | { type: "sort-cycle" }
  | { type: "detail-toggle" }
  | { type: "escape" };

export function activityRowsForHeight(height: number): number {
  if (height < 14) return 0;
  return Math.min(5, Math.max(1, height - 9));
}

export function jobRowsForHeight(height: number): number {
  const activity = activityRowsForHeight(height);
  if (activity === 0) return Math.max(1, height - 7);
  return Math.max(1, height - 9 - activity);
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
    loop: {
      running: false,
      checkpointMs: 0,
      firedMinutes: new Map(),
      firedTotal: 0,
    },
    filter: "",
    filterInput: false,
    sort: "next",
    detail: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function matchesFilter(job: JobView, filter: string): boolean {
  if (filter.length === 0) return true;
  const query = filter.toLowerCase();
  return (
    job.name.toLowerCase().includes(query) ||
    job.path.toLowerCase().includes(query) ||
    job.expressions.some((expr) => expr.toLowerCase().includes(query))
  );
}

const STATUS_ORDER: Record<CronJob["status"], number> = {
  active: 0,
  disabled: 1,
  invalid: 2,
};

function compareJobs(a: JobView, b: JobView, sort: SortMode): number {
  if (sort === "name") return a.name.localeCompare(b.name);
  if (sort === "status") {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return byStatus !== 0 ? byStatus : a.name.localeCompare(b.name);
  }
  const av = a.status === "active" ? a.nextFireMs : null;
  const bv = b.status === "active" ? b.nextFireMs : null;
  if (av === null && bv === null) return a.name.localeCompare(b.name);
  if (av === null) return 1;
  if (bv === null) return -1;
  return av !== bv ? av - bv : a.name.localeCompare(b.name);
}

export function visibleJobs(state: TuiState): JobView[] {
  return state.jobs
    .filter((job) => matchesFilter(job, state.filter))
    .sort((a, b) => compareJobs(a, b, state.sort));
}

export function selectedJob(state: TuiState): JobView | undefined {
  return visibleJobs(state)[state.selected];
}

export function nextActiveFireMs(state: TuiState): number | null {
  let next: number | null = null;
  for (const job of state.jobs) {
    if (job.status !== "active" || job.nextFireMs === null) continue;
    if (next === null || job.nextFireMs < next) next = job.nextFireMs;
  }
  return next;
}

function keepVisible(state: TuiState, selected: number, scroll: number): number {
  const rows = jobRowsForHeight(state.height);
  const count = visibleJobs(state).length;
  let next = scroll;
  if (selected < next) next = selected;
  else if (selected >= next + rows) next = selected - rows + 1;
  return clamp(next, 0, Math.max(0, count - rows));
}

function resetSelection(state: TuiState): TuiState {
  return { ...state, selected: 0, scroll: 0 };
}

export function reduce(state: TuiState, msg: Msg): TuiState {
  switch (msg.type) {
    case "loaded": {
      const previous = selectedJob(state);
      const next: TuiState = {
        ...state,
        jobs: msg.snapshot.jobs,
        manifest: msg.snapshot.manifest,
        drift: msg.snapshot.drift,
        activity: msg.snapshot.activity,
        disabled: new Set(msg.snapshot.disabled),
        scannedAt: msg.snapshot.scannedAt,
        busy: null,
        status: null,
      };
      const visible = visibleJobs(next);
      const found = previous ? visible.findIndex((job) => job.path === previous.path) : -1;
      const selected =
        found >= 0 ? found : clamp(state.selected, 0, Math.max(0, visible.length - 1));
      return { ...next, selected, scroll: keepVisible(next, selected, state.scroll) };
    }
    case "move": {
      const count = visibleJobs(state).length;
      if (count === 0) return { ...state, status: null };
      const selected = clamp(state.selected + msg.delta, 0, count - 1);
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
      const job = selectedJob(state);
      if (!job) {
        return { ...state, status: { kind: "error", message: "no job selected" } };
      }
      if (job.status === "invalid") {
        return { ...state, status: { kind: "error", message: "cannot toggle an invalid job" } };
      }
      const disabled = new Set(state.disabled);
      const nowDisabled = !disabled.has(job.name);
      if (nowDisabled) disabled.add(job.name);
      else disabled.delete(job.name);
      const jobs = state.jobs.map((j): JobView =>
        j.name === job.name ? { ...j, status: nowDisabled ? "disabled" : "active" } : j,
      );
      const next: TuiState = {
        ...state,
        disabled,
        jobs,
        status: {
          kind: "info",
          message: `${job.name} ${nowDisabled ? "disabled" : "enabled"} (session only — e to persist)`,
        },
      };
      const visible = visibleJobs(next);
      const selected = Math.max(0, visible.findIndex((j) => j.path === job.path));
      return { ...next, selected, scroll: keepVisible(next, selected, state.scroll) };
    }
    case "trigger":
    case "emit":
    case "catchup":
    case "refresh":
      return { ...state, status: null };
    case "filter-open":
      return resetSelection({ ...state, filterInput: true, status: null });
    case "filter-char":
      return resetSelection({ ...state, filter: state.filter + msg.char, status: null });
    case "filter-backspace":
      return resetSelection({
        ...state,
        filter: state.filter.slice(0, -1),
        status: null,
      });
    case "filter-apply":
      return { ...state, filterInput: false, status: null };
    case "filter-clear":
      return resetSelection({ ...state, filter: "", filterInput: false, status: null });
    case "sort-cycle": {
      const order: SortMode[] = ["next", "name", "status"];
      const index = order.indexOf(state.sort);
      return resetSelection({
        ...state,
        sort: order[(index + 1) % order.length]!,
        status: null,
      });
    }
    case "detail-toggle":
      return { ...state, detail: !state.detail, status: null };
    case "escape":
      return { ...state, detail: false, status: null };
    case "loop-toggle":
      return state;
    case "loop-start":
      return {
        ...state,
        loop: {
          running: true,
          checkpointMs: msg.nowMs,
          firedMinutes: new Map(),
          firedTotal: 0,
        },
        status: null,
      };
    case "loop-stop":
      return {
        ...state,
        loop: {
          running: false,
          checkpointMs: 0,
          firedMinutes: new Map(),
          firedTotal: 0,
        },
        status: null,
      };
    case "loop-result":
      return {
        ...state,
        loop: {
          ...state.loop,
          checkpointMs: msg.checkpointMs,
          firedMinutes: new Map(msg.firedMinutes),
          firedTotal: state.loop.firedTotal + msg.fired,
        },
      };
    case "loop-error":
      return {
        ...state,
        loop: { ...state.loop, running: false },
        status: { kind: "error", message: msg.message },
      };
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

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: PASS. Existing model tests also pass.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/model.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): add live-ops TUI state and selectors"
```

---

### Task 2: Context-aware key mapping

**Files:**
- Modify: `packages/crons/src/tui/keys.ts`
- Modify: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Consumes: `Msg` from `./model.js`.
- Produces: `keyToMsg(str: string | undefined, key: KeyPress | undefined, filterInput?: boolean): Msg | null`.

- [ ] **Step 1: Append failing key tests**

```ts
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
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — new messages/mode not mapped.

- [ ] **Step 3: Rewrite `src/tui/keys.ts`**

```ts
import type { Msg } from "./model.js";

export interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export function keyToMsg(
  str: string | undefined,
  key: KeyPress | undefined,
  filterInput = false,
): Msg | null {
  if (key?.ctrl && key.name === "c") return { type: "quit" };

  if (filterInput) {
    if (key?.name === "escape") return { type: "filter-clear" };
    if (key?.name === "return" || key?.name === "enter") return { type: "filter-apply" };
    if (key?.name === "backspace" || key?.name === "delete") return { type: "filter-backspace" };
    if (str !== undefined && /^[ -~]$/.test(str) && !key?.ctrl && !key?.meta) {
      return { type: "filter-char", char: str };
    }
    return null;
  }

  if (key?.name === "escape") return { type: "escape" };

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
    case "s":
      return { type: "loop-toggle" };
    case "/":
      return { type: "filter-open" };
    case "o":
      return { type: "sort-cycle" };
    case "v":
      return { type: "detail-toggle" };
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

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/keys.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): map live-ops TUI keys"
```

---

### Task 3: Render loop, filter, sort, and detail

**Files:**
- Modify: `packages/crons/src/tui/render.ts`
- Modify: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Consumes: `visibleJobs`, `selectedJob`, `nextActiveFireMs`, `TuiState`, `JobView` from `./model.js`.
- Produces: `render(state, nowMs, color?): string[]` with live badge, sort label, detail line, detail pane, filter footer.

- [ ] **Step 1: Append failing render tests**

```ts
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
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — live/filter/detail output missing.

- [ ] **Step 3: Rewrite `src/tui/render.ts`**

```ts
import type { CronActivityEntry } from "../types.js";
import {
  activityRowsForHeight,
  jobRowsForHeight,
  nextActiveFireMs,
  selectedJob,
  visibleJobs,
  type JobView,
  type TuiState,
} from "./model.js";

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
  if (gap <= 0) return truncate(`${l} ${r}`, width);
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

function fmtIn(dueMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((dueMs - nowMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 5400) return `${Math.max(1, Math.round(seconds / 60))}m`;
  return `${Math.round(seconds / 3600)}h`;
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

function detailLine(job: JobView | undefined, nowMs: number, width: number): string {
  if (!job) return pad(" no job selected", width);
  if (job.status === "invalid") {
    return pad(` ${job.path} · invalid · ${job.error ?? "invalid job"}`, width);
  }
  const parts = [job.path, job.status];
  if (job.expressions.length > 0) parts.push(job.expressions.join(", "));
  parts.push(job.usesDefineScheduled ? "defineScheduled" : "bare");
  parts.push(fmtLast(job, nowMs));
  return pad(` ${parts.join(" · ")}`, width);
}

function detailBody(job: JobView | undefined, nowMs: number, width: number): string[] {
  if (!job) return [pad(" no job selected", width)];
  const last = job.last;
  const lastLine = last
    ? `${last.status} · ${last.durationMs}ms · ${hhmm(last.finishedAt)} · ${last.source}${
        last.itemsProcessed !== undefined ? ` · items ${last.itemsProcessed}` : ""
      }`
    : "—";
  const error = job.error ?? last?.error;
  return [
    ` path: ${job.path}`,
    ` expressions: ${job.expressions.length > 0 ? job.expressions.join(", ") : "—"}`,
    ` status: ${job.status} · wrapper: ${job.usesDefineScheduled ? "defineScheduled" : "bare"} · shared: ${
      job.sharedExpression ? "yes" : "no"
    }`,
    ` next: ${fmtNext(job, nowMs)} · last: ${lastLine}`,
    ` error: ${error ?? "—"}`,
  ].map((line) => pad(line, width));
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

function keysLine(state: TuiState, width: number): string {
  if (state.filterInput) {
    return truncate(` filter: ${state.filter}  · enter apply · esc clear`, width);
  }
  const full = " ↑↓/jk move · enter trigger · d toggle · e emit · c catch-up · s live · / filter · o sort · v detail · r refresh · q quit";
  const mid = " ↑↓ move · ↵ trigger · d toggle · e emit · c catch-up · s live · / filter · v detail · q quit";
  const small = " ↑↓ · ↵ · d · e · c · s · / · o · v · r · q";
  return truncate(width >= 100 ? full : width >= 64 ? mid : small, width);
}

function statusLine(state: TuiState, width: number, nowMs: number): string {
  if (state.busy) return pad(` status: ${state.busy}…`, width);
  if (state.status) {
    const label =
      state.status.kind === "error" ? "error: " : state.status.kind === "success" ? "ok: " : "";
    const text = pad(` status: ${label}${state.status.message}`, width);
    if (state.status.kind === "error") return style(text, RED, state.color);
    if (state.status.kind === "success") return style(text, GREEN, state.color);
    return text;
  }
  if (state.loop.running) {
    const next = nextActiveFireMs(state);
    const when = next === null ? "next —" : `next in ${fmtIn(next, nowMs)}`;
    return pad(` status: live · ${state.loop.firedTotal} fired · ${when}`, width);
  }
  return pad(" status: ready", width);
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
  const loopLabel = state.loop.running ? `loop LIVE · ${state.loop.firedTotal} fired` : "loop off";

  lines.push(
    twoCol(
      ` void-crons · ${state.appName}`,
      `${loopLabel} · ${state.tz ? `tz ${state.tz}` : "tz local"} · ${state.storeMode} · ${originLabel(state.origin)}`,
      width,
    ),
  );
  lines.push(
    twoCol(
      ` ${state.jobs.length} jobs · ${expressions} expr · ${schedules} sched · sort ${state.sort}`,
      `${manifestNote} · scan ${clock(state.scannedAt)}`,
      width,
    ),
  );
  lines.push(rule(width));

  const rows = jobRowsForHeight(height);
  const visible = visibleJobs(state);
  const viewport = visible.slice(state.scroll, state.scroll + rows);
  const selectedIndex = state.selected - state.scroll;
  for (let i = 0; i < rows; i++) {
    const job = viewport[i];
    if (!job) {
      if (visible.length === 0 && i === 0) {
        const message = state.filter.length > 0 ? ` no jobs match "${state.filter}"` : " no jobs in crons/";
        lines.push(pad(message, width));
      } else {
        lines.push(" ".repeat(width));
      }
      continue;
    }
    lines.push(jobRow(job, i === selectedIndex, width, nowMs, color));
  }
  lines.push(detailLine(selectedJob(state), nowMs, width));
  lines.push(rule(width));

  const activityRows = activityRowsForHeight(height);
  if (activityRows > 0) {
    if (state.detail) {
      lines.push(pad(" Detail · v close", width));
      const body = detailBody(selectedJob(state), nowMs, width);
      for (let i = 0; i < activityRows; i++) lines.push(body[i] ?? " ".repeat(width));
      lines.push(rule(width));
    } else {
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
  }

  lines.push(pad(keysLine(state, width), width));
  lines.push(statusLine(state, width, nowMs));
  return lines.slice(0, height);
}
```

- [ ] **Step 4: Run render tests**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/crons/src/tui/render.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): render live loop, filter, sort, and detail"
```

---

### Task 4: Abort signal for schedule ticks

**Files:**
- Modify: `packages/crons/src/schedule.ts`
- Modify: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Produces: `tickSchedule` opts gain `signal?: AbortSignal`, forwarded to `triggerExpression`.

- [ ] **Step 1: Append failing test**

```ts
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
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — `signal` not accepted/forwarded; `fetches` is 1.

- [ ] **Step 3: Add and forward the signal**

In `tickSchedule`'s options object, add `signal?: AbortSignal;` beside the other optional fields.

In the `triggerExpression(...)` call inside `tickSchedule`, add:

```ts
      signal: opts.signal,
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
pnpm test
pnpm typecheck
git add packages/crons/src/schedule.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): allow aborting schedule ticks"
```

---

### Task 5: Filesystem watcher

**Files:**
- Create: `packages/crons/src/tui/watch.ts`
- Modify: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Produces:
  - `WatcherHandle { close(): void; failed: boolean }`
  - `WatchHandle { close(): void; on(event: "error", listener: () => void): unknown }`
  - `WatchImpl = (path, options, listener) => WatchHandle`
  - `startWatcher(appPath: string, onChange: () => void, opts?: { debounceMs?: number; watchImpl?: WatchImpl }): WatcherHandle`

- [ ] **Step 1: Append failing watcher tests**

```ts
import { startWatcher, type WatchHandle, type WatchImpl } from "../src/tui/watch.ts";

class FakeWatch implements WatchHandle {
  closed = false;
  private errors: Array<() => void> = [];
  constructor(private readonly listener: (event: string, filename: string | null) => void) {}
  on(_event: "error", listener: () => void): this {
    this.errors.push(listener);
    return this;
  }
  close(): void {
    this.closed = true;
  }
  emit(filename: string | null): void {
    this.listener("change", filename);
  }
  emitError(): void {
    for (const listener of this.errors) listener();
  }
}

function fakeWatch(): { impl: WatchImpl; created: FakeWatch[] } {
  const created: FakeWatch[] = [];
  const impl: WatchImpl = (_path, _options, listener) => {
    const watch = new FakeWatch(listener);
    created.push(watch);
    return watch;
  };
  return { impl, created };
}

describe("tui watcher", () => {
  it("debounces cron changes into one callback", async () => {
    const { impl, created } = fakeWatch();
    let calls = 0;
    const handle = startWatcher("/app", () => calls++, { debounceMs: 10, watchImpl: impl });
    created[0]?.emit("cleanup.ts");
    created[0]?.emit("heartbeat.ts");
    created[0]?.emit("reports.ts");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 1);
    handle.close();
  });

  it("ignores activity writes but reacts to the manifest", async () => {
    const { impl, created } = fakeWatch();
    let calls = 0;
    const handle = startWatcher("/app", () => calls++, { debounceMs: 5, watchImpl: impl });
    created[1]?.emit("void.crons.activity.sqlite");
    created[1]?.emit("void.crons.activity.jsonl");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 0);

    created[1]?.emit("void.crons.json");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    handle.close();
  });

  it("closes both watchers and survives watch errors", () => {
    const { impl, created } = fakeWatch();
    const handle = startWatcher("/app", () => {}, { watchImpl: impl });
    created[0]?.emitError();
    assert.equal(handle.failed, true);
    handle.close();
    assert.equal(created[0]?.closed, true);
    assert.equal(created[1]?.closed, true);

    const failed = startWatcher("/app", () => {}, {
      watchImpl: () => {
        throw new Error("watch failed");
      },
    });
    assert.equal(failed.failed, true);
    failed.close();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — `../src/tui/watch.ts` missing.

- [ ] **Step 3: Implement `src/tui/watch.ts`**

```ts
import { watch as fsWatch } from "node:fs";
import { join } from "node:path";

export interface WatchHandle {
  close(): void;
  on(event: "error", listener: () => void): unknown;
}

export type WatchImpl = (
  path: string,
  options: { recursive?: boolean },
  listener: (eventType: string, filename: string | null) => void,
) => WatchHandle;

export interface WatcherHandle {
  close(): void;
  failed: boolean;
}

export interface WatcherOptions {
  debounceMs?: number;
  watchImpl?: WatchImpl;
}

const DEFAULT_DEBOUNCE_MS = 200;

export function startWatcher(
  appPath: string,
  onChange: () => void,
  opts: WatcherOptions = {},
): WatcherHandle {
  const watchImpl: WatchImpl =
    opts.watchImpl ?? ((path, options, listener) => fsWatch(path, options, listener));
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const handles: WatchHandle[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let failed = false;

  const schedule = (): void => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, debounceMs);
  };

  const onCrons = (_event: string, filename: string | null): void => {
    if (filename === null || !filename.includes("void.crons.activity")) schedule();
  };

  const onRoot = (_event: string, filename: string | null): void => {
    if (filename !== null && filename !== "void.crons.json") return;
    schedule();
  };

  try {
    handles.push(watchImpl(join(appPath, "crons"), { recursive: true }, onCrons));
    handles.push(watchImpl(appPath, {}, onRoot));
  } catch {
    failed = true;
  }

  for (const handle of handles) {
    try {
      handle.on("error", () => {
        failed = true;
      });
    } catch {
      failed = true;
    }
  }

  return {
    get failed(): boolean {
      return failed;
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const handle of handles) {
        try {
          handle.close();
        } catch {
          // Best effort.
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
pnpm typecheck
git add packages/crons/src/tui/watch.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): add debounced TUI file watcher"
```

---

### Task 6: Runner loop and watcher integration

**Files:**
- Modify: `packages/crons/src/tui/run.ts`
- Modify: `packages/crons/test/tui.test.ts`

**Interfaces:**
- Consumes: `tickSchedule` (`../schedule.js`), `startWatcher` (`./watch.js`), `selectedJob`/`nextActiveFireMs` (`./model.js`).
- Produces: `TuiDeps` gains `tickSchedule?: typeof tickSchedule` and `watch?: (appPath, onChange) => WatcherHandle`.

- [ ] **Step 1: Update existing runner tests and append new failing tests**

In every existing `startTui(..., { ... })` options object under `describe("tui runner")`, add:

```ts
        watch: () => ({ close() {}, failed: false }),
```

Append:

```ts
import { tickSchedule } from "../src/schedule.ts";
import type { WatcherHandle } from "../src/tui/watch.ts";

describe("tui live-ops runner", () => {
  it("starts and stops the loop on s", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let tickFn: (() => void) | undefined;
    let ticks = 0;
    const tickImpl: typeof tickSchedule = async (_state, _targets, opts) => {
      ticks++;
      return {
        state: { checkpointMs: opts.nowMs, firedMinutes: new Map() },
        fired: [],
        skipped: [],
      };
    };
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: (fn) => {
          tickFn = fn;
          return 1;
        },
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions(),
        tickSchedule: tickImpl,
        watch: () => ({ close() {}, failed: false }),
      },
    );

    input.press("s", { name: "s" });
    tickFn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ticks, 1);

    input.press("s", { name: "s" });
    tickFn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ticks, 1);

    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
  });

  it("suppresses loop ticks while a manual action is busy", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let tickFn: (() => void) | undefined;
    let ticks = 0;
    let finish: (() => void) | undefined;
    const tickImpl: typeof tickSchedule = async (_state, _targets, opts) => {
      ticks++;
      return {
        state: { checkpointMs: opts.nowMs, firedMinutes: new Map() },
        fired: [],
        skipped: [],
      };
    };
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: (fn) => {
          tickFn = fn;
          return 1;
        },
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions({
          trigger: async () => {
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            return [];
          },
        }),
        tickSchedule: tickImpl,
        watch: () => ({ close() {}, failed: false }),
      },
    );

    input.press("s", { name: "s" });
    input.press("\r", { name: "return" });
    tickFn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ticks, 0);

    finish?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    tickFn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ticks, 1);

    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
  });

  it("aborts an in-flight loop tick on quit", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let tickFn: (() => void) | undefined;
    let seenSignal: AbortSignal | undefined;
    const tickImpl: typeof tickSchedule = (_state, _targets, opts) =>
      new Promise((resolve) => {
        seenSignal = opts.signal;
        void resolve;
      });
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: (fn) => {
          tickFn = fn;
          return 1;
        },
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions(),
        tickSchedule: tickImpl,
        watch: () => ({ close() {}, failed: false }),
      },
    );

    input.press("s", { name: "s" });
    tickFn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(seenSignal?.aborted, false);

    input.press("q", { name: "q" });
    assert.equal(seenSignal?.aborted, true);
    assert.equal(await promise, 0);
  });

  it("refreshes when the watcher reports a change", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let tickFn: (() => void) | undefined;
    let fire: (() => void) | undefined;
    let loads = 0;
    const promise = startTui(
      { appPath: process.cwd(), origin: "http://localhost:5173", storeMode: "jsonl", retries: 0, timeoutMs: 1000 },
      {
        stdin: input as never,
        stdout: output as never,
        signals: new FakeSignals() as never,
        setInterval: (fn) => {
          tickFn = fn;
          return 1;
        },
        clearInterval: () => {},
        now: () => 60_000,
        actions: fakeActions({
          load: () => {
            loads++;
            return snapshot();
          },
        }),
        watch: (_appPath, onChange): WatcherHandle => {
          fire = onChange;
          return { close() {}, failed: false };
        },
      },
    );

    assert.equal(loads, 1);
    fire?.();
    tickFn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loads, 2);

    input.press("q", { name: "q" });
    assert.equal(await promise, 0);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: FAIL — loop keys do nothing and watch/tick deps are ignored.

- [ ] **Step 3: Rewrite `src/tui/run.ts`**

```ts
import { statSync } from "node:fs";
import { emitKeypressEvents } from "node:readline";
import { emitCronManifest } from "../manifest.js";
import { runScheduleOnce, tickSchedule, type ScheduleRun } from "../schedule.js";
import { appendActivityLog, type ActivityStoreMode } from "../store.js";
import { triggerJob } from "../trigger.js";
import type { CronTriggerResult } from "../types.js";
import { loadSnapshot } from "./data.js";
import { keyToMsg, type KeyPress } from "./keys.js";
import {
  createState,
  reduce,
  selectedJob,
  type JobView,
  type Msg,
  type Snapshot,
  type StatusKind,
  type TuiState,
} from "./model.js";
import { render } from "./render.js";
import { startWatcher, type WatcherHandle } from "./watch.js";

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
  tickSchedule?: typeof tickSchedule;
  watch?: (appPath: string, onChange: () => void) => WatcherHandle;
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

function activeTargets(state: TuiState): Map<string, string> {
  const active = new Map<string, string>();
  for (const job of state.jobs) {
    if (job.status !== "active") continue;
    for (const expression of job.expressions) {
      if (!active.has(expression)) active.set(expression, job.name);
    }
  }
  return active;
}

export async function startTui(opts: TuiOptions, deps: TuiDeps = {}): Promise<number> {
  const stdin = deps.stdin ?? process.stdin;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const now = deps.now ?? Date.now;
  const actions = deps.actions ?? createActions(opts);
  const color = opts.color ?? !process.env["NO_COLOR"];
  const tickImpl = deps.tickSchedule ?? tickSchedule;
  const watchImpl =
    deps.watch ?? ((appPath: string, onChange: () => void) => startWatcher(appPath, onChange));

  if (!stdin.isTTY || !stdout.isTTY) {
    stderr.write("error: void-crons ui needs an interactive terminal (stdin/stdout TTY)\n");
    return 2;
  }

  try {
    if (!statSync(opts.appPath).isDirectory()) throw new Error("not a directory");
  } catch {
    stderr.write(`error: app path is not a directory: ${opts.appPath}\n`);
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
    let loopAborter: AbortController | null = null;
    let loopTickInFlight = false;
    let watcher: WatcherHandle | null = null;
    let watchDirty = false;
    let timer: unknown;
    let fatalInstalled = false;
    const clearTimer =
      deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

    const draw = (): void => {
      stdout.write(`\u001b[H${render(state, now(), color).join("\n")}\u001b[J`);
    };

    const cleanup = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimer(timer);
      watcher?.close();
      loopAborter?.abort();
      aborter?.abort();
      stdin.off("keypress", onKey);
      signals.off("SIGINT", onSigint);
      signals.off("SIGTERM", onSigterm);
      signals.off("SIGWINCH", onResize);
      if (fatalInstalled) {
        process.removeListener("uncaughtException", onFatal);
        process.removeListener("unhandledRejection", onFatal);
      }
      try {
        stdin.setRawMode?.(false);
      } catch {
        // Best effort: the terminal may already be gone.
      }
      try {
        stdin.pause();
      } catch {
        // Best effort.
      }
      try {
        stdout.write(LEAVE);
      } catch {
        // Best effort: still resolve so the process can exit.
      }
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

    const runLoopTick = async (): Promise<void> => {
      if (!state.loop.running || busy || loopTickInFlight || settled) return;
      const active = activeTargets(state);
      if (active.size === 0) return;

      loopTickInFlight = true;
      const controller = new AbortController();
      loopAborter = controller;
      try {
        const result = await tickImpl(
          {
            checkpointMs: state.loop.checkpointMs,
            firedMinutes: new Map(state.loop.firedMinutes),
          },
          { active, skipped: [] },
          {
            origin: opts.origin,
            ...(opts.devToken ? { devToken: opts.devToken } : {}),
            nowMs: now(),
            tz: opts.tz,
            timeoutMs: opts.timeoutMs,
            maxAttempts: opts.retries + 1,
            store: opts.storeMode,
            appendActivity: { appRoot: opts.appPath },
            signal: controller.signal,
          },
        );
        if (settled || !state.loop.running) return;
        state = reduce(state, {
          type: "loop-result",
          checkpointMs: result.state.checkpointMs,
          firedMinutes: result.state.firedMinutes,
          fired: result.fired.length,
        });
        if (result.fired.length > 0) {
          state = reduce(state, {
            type: "loaded",
            snapshot: actions.load([...state.disabled]),
          });
        }
        draw();
      } catch (error) {
        if (settled || controller.signal.aborted) return;
        state = reduce(state, {
          type: "loop-error",
          message: error instanceof Error ? error.message : String(error),
        });
        draw();
      } finally {
        loopTickInFlight = false;
        if (loopAborter === controller) loopAborter = null;
      }
    };

    const tick = (): void => {
      if (settled) return;
      draw();
      if (watchDirty && !busy) {
        watchDirty = false;
        refresh("info", "rescanned");
      }
      void runLoopTick();
    };

    const actTrigger = async (): Promise<void> => {
      const job = selectedJob(state);
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
      const msg: Msg | null = keyToMsg(str, key, state.filterInput);
      if (!msg) return;
      if (msg.type === "quit") {
        aborter?.abort();
        loopAborter?.abort();
        cleanup(0);
        return;
      }
      if (busy) return;
      if (msg.type === "loop-toggle") {
        if (state.loop.running) {
          loopAborter?.abort();
          state = reduce(state, { type: "loop-stop" });
        } else {
          state = reduce(state, { type: "loop-start", nowMs: now() });
        }
        draw();
        return;
      }
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
      loopAborter?.abort();
      cleanup(130);
    };

    const onSigterm = (): void => {
      aborter?.abort();
      loopAborter?.abort();
      cleanup(143);
    };

    const onFatal = (error: unknown): void => {
      aborter?.abort();
      loopAborter?.abort();
      stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      cleanup(1);
    };

    try {
      if (!deps.stdin) emitKeypressEvents(process.stdin);
      stdin.setEncoding("utf8");
      stdin.setRawMode?.(true);
      stdin.resume();
      stdout.write(ENTER);
      stdin.on("keypress", onKey);
      signals.on("SIGINT", onSigint);
      signals.on("SIGTERM", onSigterm);
      signals.on("SIGWINCH", onResize);

      try {
        watcher = watchImpl(opts.appPath, () => {
          watchDirty = true;
        });
        if (watcher.failed) {
          state = reduce(state, {
            type: "status",
            kind: "info",
            message: "watch unavailable — r to refresh",
          });
        }
      } catch {
        watcher = null;
        state = reduce(state, {
          type: "status",
          kind: "info",
          message: "watch unavailable — r to refresh",
        });
      }

      process.once("uncaughtException", onFatal);
      process.once("unhandledRejection", onFatal);
      fatalInstalled = true;
      timer = (deps.setInterval ?? setInterval)(tick, TICK_MS);
      draw();
    } catch (error) {
      stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      cleanup(1);
    }
  });
}
```

- [ ] **Step 4: Run focused tests, verify pass**

```bash
pnpm exec node --test --test-concurrency=1 --import ./test/hooks/register.mjs test/tui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

```bash
pnpm test
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/crons/src/tui/run.ts packages/crons/test/tui.test.ts
git commit -m "feat(crons): run live schedules and watch files in the TUI"
```

---

### Task 7: Docs, screenshot, version, TODO

**Files:**
- Modify: `packages/crons/README.md`
- Modify: `packages/crons/package.json`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: final CLI behavior from Tasks 1–6.
- Produces: README keymap/live/filter/detail docs, regenerated screenshot, `0.3.0`, checked-off TODO.

- [ ] **Step 1: Bump the package version**

In `packages/crons/package.json`, change:

```json
  "version": "0.2.0",
```

to:

```json
  "version": "0.3.0",
```

- [ ] **Step 2: Update README badges and intro**

Change the version badge to `0.3.0`. After the full suite runs in Step 5, set the
tests badge to the actual printed pass count.

Add live ops to the intro sentence, e.g.:

```markdown
Local lifecycle for Void `crons/` — scan, validate, preview, manifest, drift-check,
catch-up, live scheduling, retries, activity history, and an interactive terminal
UI with a live loop, filtering, and job detail.
```

- [ ] **Step 3: Update the TUI section**

Replace the key table with:

```markdown
| Key | Action |
|---|---|
| `↑` / `↓`, `j` / `k` | Move selection |
| `enter` | Trigger the selected job (all its expressions) |
| `d` | Toggle enabled/disabled for this session |
| `e` | Emit `void.crons.json` — the only action that persists toggles |
| `c` | Catch up: fire each expression's most recent due time in the last 24h |
| `s` | Start/stop the live loop from now (no backfill) |
| `/` | Filter by name, path, or expression; `enter` applies, `esc` clears |
| `o` | Cycle sort: next fire → name → status |
| `v` | Toggle the job detail pane |
| `r` | Rescan jobs, manifest, drift, and activity |
| `q` / `Ctrl-C` | Quit and restore the terminal |
```

Add after the table:

```markdown
The live loop fires due expressions in-process and writes the same activity
entries as `void-crons schedule`; it starts stopped and never backfills. Toggles
take effect on the next tick. The TUI also watches `crons/` and
`void.crons.json` and rescans automatically; `r` remains the manual fallback.

`v` opens a detail pane with the job path, expressions, wrapper, last run, and
error. `/` filters the visible list without affecting what the live loop fires.
```

- [ ] **Step 4: Regenerate the screenshot**

Run the TUI in an 88×17 PTY against a sample app with three jobs (`cleanup`,
`heartbeat`, `reports`) and two activity entries. Replace the existing
`text` block with the captured frame. It must show:

- `loop off` and `sort next` in the header.
- The selected-job detail line under the job list.
- `Activity` with entries.
- The new keymap including `s live`, `/ filter`, `o sort`, `v detail`.

Do not include ANSI escapes or terminal warnings.

- [ ] **Step 5: Run the full package suite**

```bash
pnpm test
pnpm typecheck
```

Expected: all pass. Use the printed pass count for the README tests badge.

- [ ] **Step 6: Check off TODO**

Move every TUI live-ops checkbox under `## Doing` to `## Done` with the commit
hash, and add the final review fix entry when it exists. Leave no empty
`## Doing` heading.

- [ ] **Step 7: Commit**

```bash
git add packages/crons/README.md packages/crons/package.json TODO.md
git commit -m "docs(crons): document TUI live ops and bump to 0.3.0"
```





