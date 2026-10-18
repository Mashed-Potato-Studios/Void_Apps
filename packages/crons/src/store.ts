import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CronActivityEntry } from "./types.js";

export const CRON_ACTIVITY_FILE = "void.crons.activity.json";
const MAX_ENTRIES = 100;

export interface CronStore {
  record(input: Omit<CronActivityEntry, "id" | "finishedAt">): CronActivityEntry;
  list(limit?: number): CronActivityEntry[];
  clear(): void;
  setDisabled(jobName: string, disabled: boolean): void;
  isDisabled(jobName: string): boolean;
  getDisabled(): string[];
}

/** In-memory activity + toggle state. Swap for KV/Drizzle in prod; the panel only needs this shape. */
export function createCronStore(initial: { activity?: CronActivityEntry[]; disabled?: string[] } = {}): CronStore {
  const entries: CronActivityEntry[] = [...(initial.activity ?? [])];
  const disabled = new Set<string>(initial.disabled ?? []);
  return {
    record(input) {
      const entry: CronActivityEntry = {
        ...input,
        id: input.scheduledTime + "-" + Math.random().toString(36).slice(2, 10),
        finishedAt: new Date().toISOString(),
      };
      entries.unshift(entry);
      entries.splice(MAX_ENTRIES);
      return entry;
    },
    list(limit = 20) {
      return entries.slice(0, Math.max(0, limit));
    },
    clear() {
      entries.length = 0;
    },
    setDisabled(jobName, isDisabled) {
      if (isDisabled) disabled.add(jobName);
      else disabled.delete(jobName);
    },
    isDisabled(jobName) {
      return disabled.has(jobName);
    },
    getDisabled() {
      return [...disabled].sort();
    },
  };
}

/** Append entries to `<appRoot>/void.crons.activity.json` (capped at 100) so the CLI and panel share history. */
export function appendActivityLog(appRoot: string, entries: CronActivityEntry[]): CronActivityEntry[] {
  const previous = readActivityLog(appRoot, MAX_ENTRIES);
  const next = [...entries, ...previous].slice(0, MAX_ENTRIES);
  writeFileSync(join(appRoot, CRON_ACTIVITY_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function readActivityLog(appRoot: string, limit = 20): CronActivityEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(join(appRoot, CRON_ACTIVITY_FILE), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as CronActivityEntry[]).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}
