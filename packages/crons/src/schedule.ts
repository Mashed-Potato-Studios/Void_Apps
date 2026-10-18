import { CronExpressionParser } from "cron-parser";
import type { CronJob } from "./types.js";

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

export type { CronJob };
