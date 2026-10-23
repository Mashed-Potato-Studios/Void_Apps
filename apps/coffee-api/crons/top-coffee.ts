import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { executeJob } from '../src/jobs/index.js';
import { topCoffeeJob } from '../src/jobs/top-coffee.js';

export const cron = '15 * * * *';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const run = await executeJob(topCoffeeJob, controller.scheduledTime, 'schedule');
  if (run.status === 'failed') throw new Error(run.error ?? `${topCoffeeJob.name} failed`);
  return {
    jobName: run.jobName,
    scheduledTime: run.startedAt,
    durationMs: run.durationMs,
    status: run.status,
    itemsProcessed: run.itemsProcessed,
  };
});
