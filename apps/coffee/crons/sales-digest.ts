import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { db } from 'void/db';
import { orders } from '../db/schema.js';

// Void Scheduled Cron Job (Friday 18:00) — weekly sales digest. Counts all
// orders and sums revenue so the crew closes the week knowing the numbers.
export const cron = '0 18 * * 5';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const start = Date.now();
  try {
    const rows = await db.select().from(orders);
    const revenueCents = rows.reduce((n, r) => n + r.totalCents, 0);
    console.log(
      `[coffee/sales-digest] week in review: ${rows.length} order(s), ` +
        `$${(revenueCents / 100).toFixed(2)} revenue.`,
    );
    return {
      jobName: 'coffee-sales-digest',
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      durationMs: Date.now() - start,
      status: 'success',
      itemsProcessed: rows.length,
    };
  } catch (e) {
    console.log('[coffee/sales-digest] failed:', e instanceof Error ? e.message : String(e));
    throw e;
  }
});
