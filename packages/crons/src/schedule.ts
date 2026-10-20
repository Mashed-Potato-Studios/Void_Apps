import { CronExpressionParser } from "cron-parser";
import type { CronJob } from "./types.js";
import { scanCronFiles } from "./scan.js";
import { appendActivityLog, type ActivityStoreMode } from "./store.js";
import { triggerExpression } from "./trigger.js";
import type { CronActivityEntry } from "./types.js";

export interface CronDue {
  expr: string;
  dueMs: number;
}

export interface CronScheduleZone {
  /** IANA timezone, e.g. `America/New_York`. Defaults to server-local. */
  tz?: string;
}

const MAX_ITER = 2000;
/** `computeDue` upper bound for callers needing an open-ended horizon (8d list preview). */
export const FOREVER = 8 * 24 * 60 * 60 * 1000;

/** Due times for each distinct expression inside [fromMs, toMs], sorted by time. */
export function computeDue(expressions: string[], fromMs: number, toMs: number, opts: CronScheduleZone = {}): CronDue[] {
  const out: CronDue[] = [];
  for (const expr of [...new Set(expressions)]) {
    let parsed;
    try {
      parsed = CronExpressionParser.parse(expr, { currentDate: new Date(fromMs), ...(opts.tz ? { tz: opts.tz } : {}) });
    } catch {
      continue;
    }
    // Simplified: cron-parser throws `loop limit exceeded` at next() for parseable-but-impossible
    // expressions (e.g. '0 0 31 6,4 *'); treat the throw as window-exhausted.
    let n = 0;
    for (;;) {
      if (n++ >= MAX_ITER) break;
      let dueMs: number;
      try {
        dueMs = parsed.next().getTime();
      } catch {
        break;
      }
      if (dueMs > toMs) break;
      out.push({ expr, dueMs });
    }
  }
  return out.sort((a, b) => a.dueMs - b.dueMs);
}

/** Most recent due time per expression inside the window (catch-up semantics). */
export function latestDue(expressions: string[], fromMs: number, toMs: number, opts: CronScheduleZone = {}): CronDue[] {
  const all = computeDue(expressions, fromMs, toMs, opts);
  const last = new Map<string, number>();
  for (const d of all) last.set(d.expr, d.dueMs);
  return [...last.entries()].map(([expr, dueMs]) => ({ expr, dueMs })).sort((a, b) => a.dueMs - b.dueMs);
}

export interface ScheduleSkip {
  cron: string;
  jobName: string;
  reason: string;
}

/** expr → jobName for active jobs; disabled jobs become skips, invalid jobs drop. */
export function collectScheduleTargets(
  jobs: CronJob[],
  disabledNames: Set<string>,
): { active: Map<string, string>; skipped: ScheduleSkip[] } {
  const active = new Map<string, string>();
  const skipped: ScheduleSkip[] = [];
  for (const job of jobs) {
    if (job.status === "invalid" || job.expressions.length === 0) continue;
    for (const expr of job.expressions) {
      if (disabledNames.has(job.name)) {
        if (!active.has(expr) && !skipped.some((s) => s.jobName === job.name)) {
          skipped.push({ cron: expr, jobName: job.name, reason: `job "${job.name}" is disabled` });
        }
        continue;
      }
      if (!active.has(expr)) active.set(expr, job.name);
    }
  }
  return { active, skipped };
}

const ONCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ScheduleOptions extends CronScheduleZone {
  origin: string;
  devToken?: string;
  cronSecret?: string;
  fetchImpl?: typeof fetch;
  disabled?: string[];
  nowMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  store?: ActivityStoreMode;
  signal?: AbortSignal;
}

/** Throw on unknown IANA zone; cron-parser surfaces bad zones as opaque date errors. */
export function assertValidTimezone(tz: string): void {
  if (!isValidTimezone(tz)) throw new Error(`unknown timezone: "${tz}" (expected IANA name like America/New_York)`);
}

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export interface ScheduleRun {
  fired: CronActivityEntry[];
  skipped: ScheduleSkip[];
}

/** Catch-up: most recent due time per distinct expression inside the trailing 24h, fired once each. */
export async function runScheduleOnce(appRoot: string, opts: ScheduleOptions): Promise<ScheduleRun> {
  if (opts.tz !== undefined) assertValidTimezone(opts.tz);
  const jobs = scanCronFiles(appRoot);
  const { active, skipped } = collectScheduleTargets(jobs, new Set(opts.disabled ?? []));
  const nowMs = opts.nowMs ?? Date.now();
  const latest = latestDue([...active.keys()], nowMs - ONCE_WINDOW_MS, nowMs, { tz: opts.tz });
  const fired: CronActivityEntry[] = [];
  for (const { expr, dueMs } of latest) {
    const res = await triggerExpression(expr, active.get(expr)!, {
      origin: opts.origin,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      scheduledTime: dueMs,
      timeoutMs: opts.timeoutMs,
      maxAttempts: opts.maxAttempts,
      signal: opts.signal,
    });
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0) appendActivityLog(appRoot, fired, opts.store);
  return { fired, skipped };
}

export interface ScheduleState {
  checkpointMs: number;
  /** expr → last fired minute bucket (Math.floor(dueMs / 60_000)). */
  firedMinutes: Map<string, number>;
}

export function initScheduleState(nowMs: number): ScheduleState {
  return { checkpointMs: nowMs, firedMinutes: new Map() };
}

/** One scheduling window: due since checkpoint → per-expr once-per-minute fire → checkpoint advances. */
export async function tickSchedule(
  state: ScheduleState,
  targets: { active: Map<string, string>; skipped: ScheduleSkip[] },
  opts: {
    origin: string;
    devToken?: string;
    cronSecret?: string;
    fetchImpl?: typeof fetch;
    nowMs: number;
    timeoutMs?: number;
    maxAttempts?: number;
    store?: ActivityStoreMode;
    appendActivity?: { appRoot: string };
  } & CronScheduleZone,
): Promise<{ state: ScheduleState; fired: CronActivityEntry[]; skipped: ScheduleSkip[] }> {
  const due = computeDue([...targets.active.keys()], state.checkpointMs, opts.nowMs, { tz: opts.tz });
  const fired: CronActivityEntry[] = [];
  const skipped: ScheduleSkip[] = [];
  for (const { expr, dueMs } of due) {
    const minute = Math.floor(dueMs / 60_000);
    if (state.firedMinutes.get(expr) === minute) continue;
    state.firedMinutes.set(expr, minute);
    const res = await triggerExpression(expr, targets.active.get(expr)!, {
      origin: opts.origin,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      scheduledTime: dueMs,
      timeoutMs: opts.timeoutMs,
      maxAttempts: opts.maxAttempts,
    });
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: targets.active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0 && opts.appendActivity) appendActivityLog(opts.appendActivity.appRoot, fired, opts.store);
  return { state: { checkpointMs: opts.nowMs, firedMinutes: state.firedMinutes }, fired, skipped };
}

const TICK_MS = 30_000;

/** Live loop: fixed 30s ticks, fires each distinct expression at most once per matched minute. */
export async function startScheduleLoop(
  appRoot: string,
  opts: ScheduleOptions & { intervalMs?: number; signal?: AbortSignal },
): Promise<{ firedTotal: number }> {
  if (opts.tz !== undefined) assertValidTimezone(opts.tz);
  const intervalMs = opts.intervalMs ?? TICK_MS;
  const disabledNames = new Set(opts.disabled ?? []);
  const { active } = collectScheduleTargets(scanCronFiles(appRoot), disabledNames);
  let state = initScheduleState(opts.nowMs ?? Date.now());
  const SOON = 8 * 24 * 60 * 60 * 1000;
  const next = latestDue([...active.keys()], state.checkpointMs, state.checkpointMs + SOON, { tz: opts.tz })
    .sort((a, b) => a.dueMs - b.dueMs)[0];
  const zone = opts.tz ? ` · tz ${opts.tz}` : "";
  const relay = next ? ` · next ${next.expr} in ${fmtRel(next.dueMs - state.checkpointMs)}` : "";
  console.log(
    `scheduled ${active.size} ${active.size === 1 ? "expression" : "expressions"} · origin ${opts.origin}${zone}${relay}`,
  );
  let firedTotal = 0;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
  };
  // Only register process-global signals for CLI-style ownership; callers that pass their
  // own signal must control process signals themselves. All listeners are removed on exit.
  const ownsProcessHandlers = !opts.signal && typeof process !== "undefined" && typeof process.on === "function";
  let sigint: (() => void) | undefined;
  let sigterm: (() => void) | undefined;
  if (ownsProcessHandlers && process.once) {
    sigint = (): void => stop();
    sigterm = (): void => stop();
    process.once("SIGINT", sigint);
    process.once("SIGTERM", sigterm);
  }
  const relayListener = (): void => stop();
  opts.signal?.addEventListener("abort", relayListener);
  try {
    while (!stopped) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
      if (stopped) break;
      const { state: next_, fired } = await tickSchedule(state, { active, skipped: [] }, {
        origin: opts.origin,
        devToken: opts.devToken,
        cronSecret: opts.cronSecret,
        fetchImpl: opts.fetchImpl,
        nowMs: Date.now(),
        tz: opts.tz,
        timeoutMs: opts.timeoutMs,
        maxAttempts: opts.maxAttempts,
        store: opts.store,
        appendActivity: { appRoot },
      });
      state = next_;
      firedTotal += fired.length;
      for (const e of fired) console.log(`fired ${e.jobName} ${e.cron} (${e.durationMs}ms)`);
    }
  } finally {
    opts.signal?.removeEventListener("abort", relayListener);
    if (sigint) process.removeListener("SIGINT", sigint);
    if (sigterm) process.removeListener("SIGTERM", sigterm);
  }
  return { firedTotal };
}

function fmtRel(msDelta: number): string {
  const s = Math.max(60, Math.round(msDelta / 1000));
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export type { CronJob };
