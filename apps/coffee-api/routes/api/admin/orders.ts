import { defineHandler } from 'void';
import { db, desc, eq, inArray } from 'void/db';
import type { Order } from '@void-monorepo/coffee-contract';
import { adminOnly } from '../../../src/admin.js';
import { menuItems, orderItems, orders } from '../../../db/schema.js';

export const GET = defineHandler(adminOnly, async (c) => {
  const requested = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;

  try {
    const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
    const ids = rows.map((row) => row.id);
    const lines = ids.length
      ? await db
          .select({
            orderId: orderItems.orderId,
            menuItemId: orderItems.menuItemId,
            qty: orderItems.qty,
            priceCents: orderItems.priceCents,
            slug: menuItems.slug,
            name: menuItems.name,
          })
          .from(orderItems)
          .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
          .where(inArray(orderItems.orderId, ids))
      : [];

    const data: Order[] = rows.map((row) => ({
      id: row.id,
      totalCents: row.totalCents,
      status: row.status,
      createdAt: row.createdAt,
      items: lines
        .filter((line) => line.orderId === row.id)
        .map((line) => ({
          menuItemId: line.menuItemId,
          slug: line.slug,
          name: line.name,
          qty: line.qty,
          priceCents: line.priceCents,
        })),
    }));

    return { success: true, data };
  } catch (cause) {
    console.log('[coffee/admin/orders] failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Orders database is not ready yet' } },
      503,
    );
  }
});
