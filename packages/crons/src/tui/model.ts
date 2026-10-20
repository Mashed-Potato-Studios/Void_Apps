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
