import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { db, eq } from 'void/db';
import { menuItems } from '../db/schema.js';

// Void Scheduled Cron Job (daily 07:30) — morning low-stock digest. Scans
// active menu items and logs every item below the low-stock threshold so
// the crew knows what to pull from the roastery before opening.
export const cron = '30 7 * * *';

export const LOW_STOCK_THRESHOLD = 5;

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const start = Date.now();
  try {
    const menuRows = await db.select().from(menuItems).where(eq(menuItems.isActive, 1));
    const low = menuRows.filter((m) => m.stock < LOW_STOCK_THRESHOLD);
    if (low.length > 0) {
      console.log(
        `[coffee/stock-alert] ${low.length} low-stock item(s): ` +
          low.map((m) => `${m.name} (${m.stock} left)`).join(', '),
      );
    } else {
      console.log('[coffee/stock-alert] all stocked — shelves are full.');
    }
    return {
      jobName: 'coffee-stock-alert',
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      durationMs: Date.now() - start,
      status: 'success',
      itemsProcessed: low.length,
    };
  } catch (e) {
    console.log('[coffee/stock-alert] failed:', e instanceof Error ? e.message : String(e));
    throw e;
  }
});
