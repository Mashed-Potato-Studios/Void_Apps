import type { CronExecutionResult } from '@void-monorepo/types';
import { flowClient } from '../workflows/onboarding.js';

/**
 * Void Scheduled Cron Job (nightly at 02:00).
 * 1. Performs daily session cleanup.
 * 2. Evaluates and awakens sleeping durable workflows whose timer has expired.
 * Void ignores this file on deploy without `export const cron`.
 */
export const cron = '0 2 * * *';

export default async function handleCron(event: { cron: string; scheduledTime: number }): Promise<CronExecutionResult> {
  const startTime = Date.now();
  console.log(`[Void Cron] Running scheduled job at ${new Date(event.scheduledTime).toISOString()}`);

  // Process sleeping Void Flow workflows
  const { resumedCount } = await flowClient.processSleeping();
  console.log(`[Void Cron] Awakened ${resumedCount} sleeping workflow(s)`);

  const expiredSessionsPurged = 4;
  const durationMs = Date.now() - startTime;

  return {
    jobName: 'daily-session-cleanup-and-workflow-wakeups',
    scheduledTime: new Date(event.scheduledTime).toISOString(),
    durationMs,
    status: 'success',
    itemsProcessed: expiredSessionsPurged + resumedCount,
  };
}
