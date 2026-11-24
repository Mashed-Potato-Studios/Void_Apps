import { createPlatform, type CronPlatform } from "./platform.js";
import {
  cronRunToLedgerEvent,
  sanitizeCronErrorSummary,
  type CronLedgerEvent,
  type CronLedgerStore,
  type CronRunRecord,
  type CronRunStore,
} from "./runtime.js";

/**
 * Runtime-neutral in-memory ledger. No filesystem, SQLite, KV binding, or
 * global clock requirement — usable from Workers, Node, Deno, Bun, browsers,
 * and tests. State is process/instance-local and is not durable.
 */

export interface MemoryLedgerOptions {
  platform?: CronPlatform;
  /** Newest events kept after insertion. Default 200. Set 0 for unbounded. */
  maxEvents?: number;
}

export interface MemoryLedgerStore extends CronLedgerStore, CronRunStore {
  list(limit?: number): CronLedgerEvent[];
  get(id: string): CronLedgerEvent | null;
  clear(): void;
  size(): number;
}

export function createMemoryLedgerStore(options: MemoryLedgerOptions = {}): MemoryLedgerStore {
  const platform = options.platform ?? createPlatform();
  const maxEvents = options.maxEvents === undefined ? 200 : Math.max(0, Math.floor(options.maxEvents));
  const events = new Map<string, CronLedgerEvent>();

  const normalize = (event: CronLedgerEvent): CronLedgerEvent => {
    const copy: CronLedgerEvent = { ...event };
    if (!Number.isFinite(copy.occurredAt)) copy.occurredAt = platform.now();
    if (copy.error) {
      const sanitized = sanitizeCronErrorSummary(copy.error);
      if (sanitized) copy.error = sanitized;
      else delete copy.error;
    }
    return copy;
  };

  const trim = (): void => {
    if (maxEvents === 0 || events.size <= maxEvents) return;
    const ordered = [...events.values()].sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id));
    for (const stale of ordered.slice(maxEvents)) events.delete(stale.id);
  };

  const recordEvent = async (event: CronLedgerEvent): Promise<void> => {
    if (events.has(event.id)) return;
    events.set(event.id, normalize(event));
    trim();
  };

  return {
    recordEvent,
    record: async (run: CronRunRecord): Promise<void> => {
      await recordEvent(cronRunToLedgerEvent(run));
    },
    has: async (id: string): Promise<boolean> => events.has(id),
    get: (id: string): CronLedgerEvent | null => events.get(id) ?? null,
    list: (limit = 50): CronLedgerEvent[] =>
      [...events.values()]
        .sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
        .slice(0, Math.max(0, Math.floor(limit))),
    clear: (): void => {
      events.clear();
    },
    size: (): number => events.size,
  };
}
