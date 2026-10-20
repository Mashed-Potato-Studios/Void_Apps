import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { db, sql } from 'void/db';
import { coffeeStats, orderItems } from '../db/schema.js';

// Void Scheduled Cron Job (hourly at :15) — recompute Today's Favorite from order_items.
export const cron = '15 * * * *';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const start = Date.now();
  try {
    const stats = await db
      .select({ menuItemId: orderItems.menuItemId, count: sql<number>`count(*)` })
      .from(orderItems)
      .groupBy(orderItems.menuItemId)
      .orderBy(sql`count(*) desc`)
      .limit(1);
    const top = stats[0];
    const now = new Date().toISOString();
    if (top) {
      await db
        .insert(coffeeStats)
        .values({ id: 'current', topMenuItemId: top.menuItemId, computedAt: now })
        .onConflictDoUpdate({
          target: coffeeStats.id,
          set: { topMenuItemId: top.menuItemId, computedAt: now },
        });
    }
    return {
      jobName: 'coffee-top-coffee',
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      durationMs: Date.now() - start,
      status: 'success',
      itemsProcessed: top ? 1 : 0,
    };
  } catch (e) {
    console.log('[coffee/top-coffee] failed:', e instanceof Error ? e.message : String(e));
    throw e;
  }
});
