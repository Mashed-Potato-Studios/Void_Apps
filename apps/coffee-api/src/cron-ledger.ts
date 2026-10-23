import { env } from 'void/env';
import { createD1CronStore, type D1CronStore, type D1DatabaseLike } from 'void-crons/d1';
import type { CronRunStore } from 'void-crons/runtime';

/** Kept separate from the legacy Drizzle `cron_runs` table. */
export const COFFEE_CRON_LEDGER_TABLE = 'cron_ledger';
export const COFFEE_CRON_LEDGER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let ledgerPromise: Promise<D1CronStore> | undefined;

export async function createCoffeeCronLedger(db: D1DatabaseLike): Promise<D1CronStore> {
  const store = createD1CronStore({
    db,
    table: COFFEE_CRON_LEDGER_TABLE,
    retentionMs: COFFEE_CRON_LEDGER_RETENTION_MS,
  });
  await store.ensureSchema();
  return store;
}

export function getCoffeeCronLedger(): Promise<D1CronStore> {
  if (!ledgerPromise) {
    ledgerPromise = createCoffeeCronLedger(env.DB as D1DatabaseLike).catch((error) => {
      ledgerPromise = undefined;
      throw error;
    });
  }
  return ledgerPromise;
}

export const coffeeCronRunStore: CronRunStore = {
  async record(run) {
    await (await getCoffeeCronLedger()).record(run);
  },
};
