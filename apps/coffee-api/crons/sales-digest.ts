import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { executeJob } from '../src/jobs/index.js';
import { salesDigestJob } from '../src/jobs/sales-digest.js';

export const cron = '0 18 * * 5';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const run = await executeJob(salesDigestJob, controller.scheduledTime, 'schedule');
  if (run.status === 'failed') throw new Error(run.error ?? `${salesDigestJob.name} failed`);
  return {
    jobName: run.jobName,
    scheduledTime: run.startedAt,
    durationMs: run.durationMs,
    status: run.status,
    itemsProcessed: run.itemsProcessed,
  };
});
