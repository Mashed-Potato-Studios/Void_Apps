import { defineScheduled } from 'void';
import type { CronExecutionResult } from '@void-monorepo/types';
import { db, eq } from 'void/db';
import { menuItems } from '../db/schema.js';

// Void Scheduled Cron Job (nightly 03:00) — restocks every active menu item
// up to its default_stock level for the next business day. Never exceeds
// default_stock; orders untouched.
export const cron = '0 3 * * *';

export default defineScheduled(async (controller): Promise<CronExecutionResult> => {
  const start = Date.now();
  try {
    const menuRows = await db.select().from(menuItems).where(eq(menuItems.isActive, 1));
    let touched = 0;
    for (const m of menuRows) {
      if (m.stock < m.defaultStock) {
        await db.update(menuItems).set({ stock: m.defaultStock }).where(eq(menuItems.id, m.id));
        touched++;
      }
    }
    return {
      jobName: 'coffee-nightly-restock',
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      durationMs: Date.now() - start,
      status: 'success',
      itemsProcessed: touched,
    };
  } catch (e) {
    console.log('[coffee/rollover] failed:', e instanceof Error ? e.message : String(e));
    throw e;
  }
});
