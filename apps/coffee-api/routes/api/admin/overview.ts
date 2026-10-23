import { defineHandler } from 'void';
import { db, eq, gte, sql } from 'void/db';
import { adminOnly } from '../../../src/admin.js';
import { coffeeStats, menuItems, orders } from '../../../db/schema.js';

export const GET = defineHandler(adminOnly, async (c) => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [allTime] = await db
      .select({
        orderCount: sql<number>`count(*)`,
        revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
      })
      .from(orders);

    const [today] = await db
      .select({
        orderCount: sql<number>`count(*)`,
        revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, todayIso));

    const [active] = await db
      .select({ count: sql<number>`count(*)` })
      .from(menuItems)
      .where(eq(menuItems.isActive, 1));

    const lowStock = await db
      .select({ slug: menuItems.slug, name: menuItems.name, stock: menuItems.stock })
      .from(menuItems)
      .where(sql`${menuItems.isActive} = 1 and ${menuItems.stock} < 5`)
      .orderBy(menuItems.stock);

    const [favorite] = await db
      .select({ name: menuItems.name, computedAt: coffeeStats.computedAt })
      .from(coffeeStats)
      .innerJoin(menuItems, eq(coffeeStats.topMenuItemId, menuItems.id))
      .where(eq(coffeeStats.id, 'current'))
      .limit(1);

    return {
      success: true,
      data: {
        revenueCents: Number(allTime?.revenueCents ?? 0),
        orderCount: Number(allTime?.orderCount ?? 0),
        todayRevenueCents: Number(today?.revenueCents ?? 0),
        todayOrderCount: Number(today?.orderCount ?? 0),
        activeMenuCount: Number(active?.count ?? 0),
        lowStock,
        topCoffee: favorite?.name ?? null,
        topCoffeeComputedAt: favorite?.computedAt ?? null,
      },
    };
  } catch (cause) {
    console.log('[coffee/admin/overview] failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Overview database is not ready yet' } },
      503,
    );
  }
});
