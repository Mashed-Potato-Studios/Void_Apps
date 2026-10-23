import { db } from 'void/db';
import { orders } from '../../db/schema.js';
import type { JobDefinition } from './types.js';

/**
 * Friday 18:00 — week-in-review. Counts orders and sums revenue so the crew
 * closes the week knowing the numbers.
 */
export const salesDigestJob: JobDefinition = {
  name: 'coffee-sales-digest',
  path: 'crons/sales-digest.ts',
  cron: '0 18 * * 5',
  description:
    'Friday 18:00 week-in-review: counts orders and sums revenue for the week, then logs the result.',
  async run() {
    const rows = await db.select({ totalCents: orders.totalCents }).from(orders);
    const revenueCents = rows.reduce((total, row) => total + row.totalCents, 0);
    console.log(
      `[coffee/sales-digest] week in review: ${rows.length} order(s), ` +
        `$${(revenueCents / 100).toFixed(2)} revenue.`,
    );
    return { itemsProcessed: rows.length };
  },
};
