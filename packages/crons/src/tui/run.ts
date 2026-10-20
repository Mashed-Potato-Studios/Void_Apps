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
    let loopGeneration = 0;
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
      if (active.size === 0) {
        state = reduce(state, {
          type: "loop-result",
          checkpointMs: now(),
          firedMinutes: new Map(state.loop.firedMinutes),
          fired: 0,
        });
        draw();
        return;
      }

      const generation = loopGeneration;
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
        if (settled || !state.loop.running || generation !== loopGeneration) return;
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
        if (settled || controller.signal.aborted || generation !== loopGeneration) return;
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
        loopGeneration++;
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
