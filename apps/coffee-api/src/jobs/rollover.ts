import { db, eq } from 'void/db';
import { menuItems } from '../../db/schema.js';
import type { JobDefinition } from './types.js';

/**
 * Nightly 03:00 — restock every active menu item up to `default_stock`.
 * Never exceeds the default; orders are untouched.
 */
export const rolloverJob: JobDefinition = {
  name: 'coffee-nightly-restock',
  path: 'crons/rollover.ts',
  cron: '0 3 * * *',
  description:
    'Restocks every active menu item up to its default level. Never exceeds the default, never touches orders.',
  async run() {
    const rows = await db.select().from(menuItems).where(eq(menuItems.isActive, 1));
    let touched = 0;
    for (const item of rows) {
      if (item.stock < item.defaultStock) {
        await db.update(menuItems).set({ stock: item.defaultStock }).where(eq(menuItems.id, item.id));
        touched += 1;
      }
    }
    return { itemsProcessed: touched };
  },
};
