import { defineHandler } from 'void';
import type { InferProps } from 'void';
import { db, desc } from 'void/db';
import { initialMenu } from '../db/seed.js';
import { orders } from '../db/schema.js';

export type DashboardLoader = {
  recentOrders: { id: string; totalCents: number; createdAt: string }[];
  revenueCents: number;
  lowStock: { slug: string; name: string; stock: number }[];
  topCoffee: string | null;
};
export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (): Promise<DashboardLoader> => {
  const lowStock = initialMenu
    .filter((m) => m.stock < 5)
    .map((m) => ({ slug: m.slug, name: m.name, stock: m.stock }));
  try {
    const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(10);
    const revenueCents = rows.reduce((n, r) => n + r.totalCents, 0);
    // topCoffee enrichment (join over coffee_stats) lands with the real
    // top-coffee cron data; until the cron has produced a row this stays null.
    return {
      recentOrders: rows.map((r) => ({ id: r.id, totalCents: r.totalCents, createdAt: r.createdAt })),
      revenueCents,
      lowStock,
      topCoffee: null,
    };
  } catch {
    return { recentOrders: [], revenueCents: 0, lowStock, topCoffee: null };
  }
});
