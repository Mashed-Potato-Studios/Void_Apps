import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { executeJob } from '../src/jobs/index.js';
import { stockAlertJob } from '../src/jobs/stock-alert.js';

export const cron = '30 7 * * *';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const run = await executeJob(stockAlertJob, controller.scheduledTime, 'schedule');
  if (run.status === 'failed') throw new Error(run.error ?? `${stockAlertJob.name} failed`);
  return {
    jobName: run.jobName,
    scheduledTime: run.startedAt,
    durationMs: run.durationMs,
    status: run.status,
    itemsProcessed: run.itemsProcessed,
  };
});
