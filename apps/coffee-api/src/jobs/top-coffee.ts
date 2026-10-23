import { db, eq, gte, sql } from 'void/db';
import { coffeeStats, orderItems, orders } from '../../db/schema.js';
import type { JobDefinition } from './types.js';

/**
 * Hourly at :15 — recompute Today's Favorite from order items sold since
 * midnight UTC and upsert the single `coffee_stats.current` row. Days with no
 * orders clear the favorite instead of keeping yesterday's winner.
 */
export const topCoffeeJob: JobDefinition = {
  name: 'coffee-top-coffee',
  path: 'crons/top-coffee.ts',
  cron: '15 * * * *',
  description:
    'Group-by over today’s order_items, then rewrites the one-row coffee_stats.current behind the admin “Today’s Favorite” card.',
  async run() {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const stats = await db
      .select({ menuItemId: orderItems.menuItemId, count: sql<number>`count(*)` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(gte(orders.createdAt, todayStart.toISOString()))
      .groupBy(orderItems.menuItemId)
      .orderBy(sql`count(*) desc`)
      .limit(1);
    const top = stats[0];
    const now = new Date().toISOString();

    await db
      .insert(coffeeStats)
      .values({ id: 'current', topMenuItemId: top?.menuItemId ?? null, computedAt: now })
      .onConflictDoUpdate({
        target: coffeeStats.id,
        set: { topMenuItemId: top?.menuItemId ?? null, computedAt: now },
      });

    return { itemsProcessed: top ? 1 : 0 };
  },
};
