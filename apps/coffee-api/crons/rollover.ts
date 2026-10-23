import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { executeJob } from '../src/jobs/index.js';
import { rolloverJob } from '../src/jobs/rollover.js';

export const cron = '0 3 * * *';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const run = await executeJob(rolloverJob, controller.scheduledTime, 'schedule');
  if (run.status === 'failed') throw new Error(run.error ?? `${rolloverJob.name} failed`);
  return {
    jobName: run.jobName,
    scheduledTime: run.startedAt,
    durationMs: run.durationMs,
    status: run.status,
    itemsProcessed: run.itemsProcessed,
  };
});
