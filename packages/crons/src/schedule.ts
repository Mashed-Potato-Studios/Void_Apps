import { CronExpressionParser } from "cron-parser";
import { cronParserInput, extendedDueTimes } from "./cron-expr.js";
import type { CronJob, CronTriggerOptions } from "./types.js";
import { scanCronFiles } from "./scan.js";
import { readManifestDisabled } from "./manifest.js";
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

/** Due times for each distinct expression inside (fromMs, toMs], sorted by time.
 *
 *  Cloudflare evaluates schedules in UTC and numbers day-of-week 1=Sun…7=Sat,
 *  so expressions are normalized before parsing and `opts.tz` defaults to UTC.
 *  Pass an IANA zone only to preview a different wall clock deliberately.
 *  Extended expressions (`LW`, `15W`, `L-3`) use the fallback evaluator.
 *  Throws rather than returning a partial window above 2,000 occurrences per expression. */
export function computeDue(expressions: string[], fromMs: number, toMs: number, opts: CronScheduleZone = {}): CronDue[] {
  const tz = opts.tz ?? "UTC";
  const out: CronDue[] = [];
  for (const expr of [...new Set(expressions)]) {
    const input = cronParserInput(expr);
    if (input === null) {
      // Valid Cloudflare forms cron-parser cannot evaluate (LW, 15W, L-3).
      const times = extendedDueTimes(expr, fromMs, toMs, opts);
      if (times.length >= MAX_ITER && extendedDueTimes(expr, times[times.length - 1]!, toMs, opts).length > 0) {
        throw new Error(`schedule occurrence limit exceeded for "${expr}": more than ${MAX_ITER} occurrences in window`);
      }
      for (const dueMs of times) out.push({ expr, dueMs });
      continue;
    }
    let parsed;
    try {
      parsed = CronExpressionParser.parse(input, { currentDate: new Date(fromMs), tz });
    } catch {
      continue;
    }
    // Simplified: cron-parser throws `loop limit exceeded` at next() for parseable-but-impossible
    // expressions (e.g. '0 0 31 6,4 *'); treat the throw as window-exhausted.
    let n = 0;
    for (;;) {
      let dueMs: number;
      try {
        dueMs = parsed.next().getTime();
      } catch {
        break;
      }
      if (dueMs > toMs) break;
      if (n++ >= MAX_ITER) {
        throw new Error(`schedule occurrence limit exceeded for "${expr}": more than ${MAX_ITER} occurrences in window`);
      }
      out.push({ expr, dueMs });
    }
  }
  return out.sort((a, b) => a.dueMs - b.dueMs);
}

export function nextDue(expressions: string[], fromMs: number, toMs: number, opts: CronScheduleZone = {}): CronDue[] {
  if (toMs <= fromMs) return [];
  return [...new Set(expressions)].flatMap((expr): CronDue[] => {
    const input = cronParserInput(expr);
    if (input === null) {
      for (let windowFromMs = fromMs; windowFromMs < toMs; windowFromMs += ONCE_WINDOW_MS) {
        const dueMs = extendedDueTimes(expr, windowFromMs, Math.min(windowFromMs + ONCE_WINDOW_MS, toMs), opts)[0];
        if (dueMs !== undefined) return [{ expr, dueMs }];
      }
      return [];
    }
    try {
      const dueMs = CronExpressionParser.parse(input, { currentDate: new Date(fromMs), tz: opts.tz ?? "UTC" }).next().getTime();
      return dueMs <= toMs ? [{ expr, dueMs }] : [];
    } catch {
      return [];
    }
  }).sort((left, right) => left.dueMs - right.dueMs);
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

/** expr → dispatch label; a disabled member blocks the entire expression's handler fanout. */
export function collectScheduleTargets(
  jobs: CronJob[],
  disabledNames: Set<string>,
): { active: Map<string, string>; skipped: ScheduleSkip[] } {
  const active = new Map<string, string>();
  const skipped: ScheduleSkip[] = [];
  const groups = new Map<string, CronJob[]>();
  for (const job of jobs) {
    if (job.status === "invalid" || job.expressions.length === 0) continue;
    for (const expr of new Set(job.expressions)) {
      const members = groups.get(expr) ?? [];
      members.push(job);
      groups.set(expr, members);
    }
  }
  for (const [expr, members] of groups) {
    const disabled = members.filter((job) => job.status === "disabled" || disabledNames.has(job.name) || disabledNames.has(job.path));
    if (disabled.length > 0) {
      const reason = members.length === 1
        ? `job "${disabled[0]!.name}" is disabled`
        : `expression "${expr}" blocked: dispatch fans out to all matching handlers (${members.map((job) => job.name).sort().join(", ")}), including disabled jobs (${disabled.map((job) => job.name).sort().join(", ")})`;
      skipped.push({ cron: expr, jobName: members.length === 1 ? members[0]!.name : `expression:${expr}`, reason });
    } else {
      active.set(expr, members.length === 1 ? members[0]!.name : `expression:${expr}`);
    }
  }
  return { active, skipped };
}

const ONCE_WINDOW_MS = 24 * 60 * 60 * 1000;

type ScheduleTriggerOptions = Pick<CronTriggerOptions, "transport" | "allowRemote" | "productionEvidence" | "bindingMode" | "allowRemoteBindings" | "jobs" | "disabled">;

export interface ScheduleOptions extends CronScheduleZone, ScheduleTriggerOptions {
  origin: string;
  devToken?: string;
  cronSecret?: string;
  fetchImpl?: typeof fetch;
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
  const disabled = new Set([...readManifestDisabled(appRoot), ...(opts.disabled ?? [])]);
  const jobs = scanCronFiles(appRoot, { disabled });
  const { active, skipped } = collectScheduleTargets(jobs, disabled);
  const nowMs = opts.nowMs ?? Date.now();
  const latest = latestDue([...active.keys()], nowMs - ONCE_WINDOW_MS, nowMs, { tz: opts.tz });
  const fired: CronActivityEntry[] = [];
  for (const { expr, dueMs } of latest) {
    const res = await triggerExpression(expr, active.get(expr)!, {
      origin: opts.origin,
      transport: opts.transport,
      allowRemote: opts.allowRemote,
      productionEvidence: opts.productionEvidence,
      bindingMode: opts.bindingMode,
      allowRemoteBindings: opts.allowRemoteBindings,
      jobs,
      disabled: [...disabled],
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
  /** expr → last attempted dispatch minute, including failures; in-memory only, not delivery confirmation. */
  firedMinutes: Map<string, number>;
}

export function initScheduleState(nowMs: number): ScheduleState {
  return { checkpointMs: nowMs, firedMinutes: new Map() };
}

/** Bounded in-memory backfill. Attempted minutes, including failures, are not replayed automatically.
 *  Abort preserves the checkpoint and leaves unattempted minutes pending. No restart recovery or exactly-once guarantee. */
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
    signal?: AbortSignal;
  } & CronScheduleZone & ScheduleTriggerOptions,
): Promise<{ state: ScheduleState; fired: CronActivityEntry[]; skipped: ScheduleSkip[] }> {
  if (opts.signal?.aborted) return { state, fired: [], skipped: [...targets.skipped] };
  const due = computeDue([...targets.active.keys()], state.checkpointMs, opts.nowMs, { tz: opts.tz });
  const fired: CronActivityEntry[] = [];
  const skipped: ScheduleSkip[] = [...targets.skipped];
  const firedMinutes = new Map(state.firedMinutes);
  for (const { expr, dueMs } of due) {
    if (opts.signal?.aborted) break;
    const minute = Math.floor(dueMs / 60_000);
    if ((firedMinutes.get(expr) ?? -Infinity) >= minute) continue;
    const res = await triggerExpression(expr, targets.active.get(expr)!, {
      origin: opts.origin,
      transport: opts.transport,
      allowRemote: opts.allowRemote,
      productionEvidence: opts.productionEvidence,
      bindingMode: opts.bindingMode,
      allowRemoteBindings: opts.allowRemoteBindings,
      jobs: opts.jobs,
      disabled: opts.disabled,
      devToken: opts.devToken,
      cronSecret: opts.cronSecret,
      fetchImpl: opts.fetchImpl,
      scheduledTime: dueMs,
      timeoutMs: opts.timeoutMs,
      maxAttempts: opts.maxAttempts,
      signal: opts.signal,
    });
    if (res.entry || (res.attempts ?? 0) > 0) firedMinutes.set(expr, minute);
    if (res.entry) fired.push(res.entry);
    else if (res.reason) skipped.push({ cron: expr, jobName: targets.active.get(expr)!, reason: res.reason });
  }
  if (fired.length > 0 && opts.appendActivity) appendActivityLog(opts.appendActivity.appRoot, fired, opts.store);
  return {
    state: { checkpointMs: opts.signal?.aborted ? state.checkpointMs : Math.max(state.checkpointMs, opts.nowMs), firedMinutes },
    fired,
    skipped,
  };
}

const TICK_MS = 30_000;

/** Live loop: fixed 30s ticks, fires each distinct expression at most once per matched minute. */
export async function startScheduleLoop(
  appRoot: string,
  opts: ScheduleOptions & { intervalMs?: number; signal?: AbortSignal },
): Promise<{ firedTotal: number }> {
  if (opts.tz !== undefined) assertValidTimezone(opts.tz);
  if (opts.signal?.aborted) return { firedTotal: 0 };
  const intervalMs = opts.intervalMs ?? TICK_MS;
  const disabledNames = new Set([...readManifestDisabled(appRoot), ...(opts.disabled ?? [])]);
  const jobs = scanCronFiles(appRoot, { disabled: disabledNames });
  const targets = collectScheduleTargets(jobs, disabledNames);
  const { active } = targets;
  let state = initScheduleState(opts.nowMs ?? Date.now());
  const horizonMs = state.checkpointMs + 62 * 24 * 60 * 60 * 1000;
  const next = nextDue([...active.keys()], state.checkpointMs, horizonMs, { tz: opts.tz })[0];
  const zone = opts.tz ? ` · tz ${opts.tz}` : "";
  const relay = next ? ` · next ${next.expr} in ${fmtRel(next.dueMs - state.checkpointMs)}` : "";
  console.log(
    `scheduled ${active.size} ${active.size === 1 ? "expression" : "expressions"} · origin ${opts.origin}${zone}${relay}`,
  );
  let firedTotal = 0;
  let stopped = false;
  const controller = new AbortController();
  let wake: (() => void) | undefined;
  const stop = (): void => {
    stopped = true;
    controller.abort();
    wake?.();
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
  if (opts.signal?.aborted) stop();
  try {
    while (!stopped) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, intervalMs);
        wake = (): void => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
      if (stopped) break;
      const { state: next_, fired } = await tickSchedule(state, targets, {
        origin: opts.origin,
        transport: opts.transport,
        allowRemote: opts.allowRemote,
        productionEvidence: opts.productionEvidence,
        bindingMode: opts.bindingMode,
        allowRemoteBindings: opts.allowRemoteBindings,
        jobs,
        disabled: [...disabledNames],
        devToken: opts.devToken,
        cronSecret: opts.cronSecret,
        fetchImpl: opts.fetchImpl,
        nowMs: Date.now(),
        tz: opts.tz,
        timeoutMs: opts.timeoutMs,
        maxAttempts: opts.maxAttempts,
        store: opts.store,
        appendActivity: { appRoot },
        signal: controller.signal,
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
