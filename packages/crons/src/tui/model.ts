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
      const jobs = state.jobs.map((j): JobView =>
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
