import type { CronRun, CronTrigger } from '@void-monorepo/coffee-contract';
import { db, lt } from 'void/db';
import { cronRuns } from '../../db/schema.js';
import { rolloverJob } from './rollover.js';
import { salesDigestJob } from './sales-digest.js';
import { stockAlertJob } from './stock-alert.js';
import { topCoffeeJob } from './top-coffee.js';
import type { JobDefinition } from './types.js';

export type { JobDefinition, JobOutcome } from './types.js';

export const jobs: JobDefinition[] = [
  rolloverJob,
  topCoffeeJob,
  stockAlertJob,
  salesDigestJob,
];

export function findJob(name: string): JobDefinition | undefined {
  return jobs.find((job) => job.name === name);
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Executes a job and persists the outcome. Never throws: callers decide how a
 * failed run surfaces (scheduled wrappers rethrow so Void reports it, the admin
 * trigger returns the recorded failure).
 */
export async function executeJob(
  job: JobDefinition,
  scheduledTime: number,
  trigger: CronTrigger,
): Promise<CronRun> {
  const startedAt = new Date(scheduledTime).toISOString();
  const start = Date.now();
  let status: CronRun['status'] = 'success';
  let itemsProcessed = 0;
  let error: string | null = null;

  try {
    const outcome = await job.run();
    itemsProcessed = outcome.itemsProcessed;
  } catch (cause) {
    status = 'failed';
    error = cause instanceof Error ? cause.message : String(cause);
    console.log(`[coffee/${job.name}] failed:`, error);
  }

  const run: CronRun = {
    id: crypto.randomUUID(),
    jobName: job.name,
    cron: job.cron,
    trigger,
    status,
    startedAt,
    durationMs: Date.now() - start,
    itemsProcessed,
    error,
  };

  try {
    await db.insert(cronRuns).values(run);
    await db.delete(cronRuns).where(lt(cronRuns.startedAt, new Date(Date.now() - RETENTION_MS).toISOString()));
  } catch (persistError) {
    console.log(
      '[coffee/cron-runs] could not persist run:',
      persistError instanceof Error ? persistError.message : String(persistError),
    );
  }

  return run;
}
