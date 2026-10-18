import { CronExpressionParser } from "cron-parser";
import type { CronJob } from "./types.js";
import { scanCronFiles } from "./scan.js";
import { appendActivityLog } from "./store.js";
import { triggerExpression } from "./trigger.js";
import type { CronActivityEntry } from "./types.js";

export interface CronDue {
  expr: string;
  dueMs: number;
}

const MAX_ITER = 2000;
/** `computeDue` upper bound for callers needing an open-ended horizon (8d list preview). */
export const FOREVER = 8 * 24 * 60 * 60 * 1000;

/** Due times for each distinct expression inside [fromMs, toMs], sorted by time. */
export function computeDue(expressions: string[], fromMs: number, toMs: number): CronDue[] {
  const out: CronDue[] = [];
  for (const expr of [...new Set(expressions)]) {
    let parsed;
    try {
      parsed = CronExpressionParser.parse(expr, { currentDate: new Date(fromMs) });
    } catch {
      continue;
    }
    let n = 0;
    for (;;) {
      if (n++ >= MAX_ITER) break;
      const step = parsed.next();
      const dueMs = step.getTime();
      if (dueMs > toMs) break;
      out.push({ expr, dueMs });
    }
  }
  return out.sort((a, b) => a.dueMs - b.dueMs);
}

/** Most recent due time per expression inside the window (catch-up semantics). */
export function latestDue(expressions: string[], fromMs: number, toMs: number): CronDue[] {
  const all = computeDue(expressions, fromMs, toMs);
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

export interface ScheduleOptions {
  origin: string;
  devToken?: string;
  cronSecret?: string;
  fetchImpl?: typeof fetch;
  disabled?: string[];
  nowMs?: number;
}

export interface ScheduleRun {
  fired: CronActivityEntry[];
  skipped: ScheduleSkip[];
}

/** Catch-up: most recent due time per distinct expression inside the trailing 24h, fired once each. */
export async function runScheduleOnce(appRoot: string, opts: ScheduleOptions): Promise<ScheduleRun> {
  const jobs = scanCronFiles(appRoot);
  const { active, skipped } = collectScheduleTargets(jobs, new Set(opts.disabled ?? []));
  const nowMs = opts.nowMs ?? Date.now();
  const latest = latestDue([...active.keys()], nowMs - ONCE_WINDOW_MS, nowMs);
  const fired: CronActivityEntry[] = [];
  for (const { expr, dueMs } of latest) {
    const res = await triggerExpression(expr, active.get(expr)!, {
      origin: opts.origin,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      scheduledTime: dueMs,
    });
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0) appendActivityLog(appRoot, fired);
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
    appendActivity?: { appRoot: string };
  },
): Promise<{ state: ScheduleState; fired: CronActivityEntry[]; skipped: ScheduleSkip[] }> {
  const due = computeDue([...targets.active.keys()], state.checkpointMs, opts.nowMs);
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
    });
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: targets.active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0 && opts.appendActivity) appendActivityLog(opts.appendActivity.appRoot, fired);
  return { state: { checkpointMs: opts.nowMs, firedMinutes: state.firedMinutes }, fired, skipped };
}

export type { CronJob };
