import type { CronExecutionResult } from '@void-monorepo/types';
import {
  instrumentScheduled,
  type CronRunStore,
  type CronScheduledController,
} from 'void-crons/runtime';
import { coffeeCronRunStore } from '../cron-ledger.js';

export const STAGING_HEARTBEAT_JOB = 'coffee-staging-heartbeat';
export const STAGING_HEARTBEAT_CRON = '0 4 * * *';

async function heartbeat(
  controller: CronScheduledController,
  _env: unknown,
  _ctx: unknown,
): Promise<CronExecutionResult> {
  const startedAt = Date.now();
  console.log(`[coffee/staging-heartbeat] tick ${new Date(controller.scheduledTime).toISOString()}`);
  return {
    jobName: STAGING_HEARTBEAT_JOB,
    scheduledTime: new Date(controller.scheduledTime).toISOString(),
    durationMs: Date.now() - startedAt,
    status: 'success',
    itemsProcessed: 0,
  };
}

/** Safe job used to exercise the D1 ledger without touching inventory or orders. */
export function createStagingHeartbeat(store: CronRunStore = coffeeCronRunStore) {
  return instrumentScheduled(STAGING_HEARTBEAT_JOB, heartbeat, {
    store,
    idempotencyKey: (controller) =>
      `${STAGING_HEARTBEAT_JOB}:${controller.cron}:${controller.scheduledTime}`,
  });
}

export const stagingHeartbeat = createStagingHeartbeat();
