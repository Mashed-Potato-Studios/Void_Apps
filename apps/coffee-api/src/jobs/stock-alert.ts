import { db, eq } from 'void/db';
import { menuItems } from '../../db/schema.js';
import type { JobDefinition } from './types.js';

export const LOW_STOCK_THRESHOLD = 5;

/**
 * Daily 07:30 — morning low-stock digest. Logs every active item under five
 * units so the crew pulls from the roastery before opening.
 */
export const stockAlertJob: JobDefinition = {
  name: 'coffee-stock-alert',
  path: 'crons/stock-alert.ts',
  cron: '30 7 * * *',
  description:
    'Morning low-stock digest: logs every active item under five units before the café opens.',
  async run() {
    const rows = await db.select().from(menuItems).where(eq(menuItems.isActive, 1));
    const low = rows.filter((item) => item.stock < LOW_STOCK_THRESHOLD);
    if (low.length > 0) {
      console.log(
        `[coffee/stock-alert] ${low.length} low-stock item(s): ` +
          low.map((item) => `${item.name} (${item.stock} left)`).join(', '),
      );
    } else {
      console.log('[coffee/stock-alert] all stocked — shelves are full.');
    }
    return { itemsProcessed: low.length };
  },
};
