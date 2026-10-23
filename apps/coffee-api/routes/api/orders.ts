import { defineHandler } from 'void';
import { and, db, eq, gte, inArray, sql } from 'void/db';
import { menuItems, orderItems, orders } from '../../db/schema.js';

type CheckoutBody = { items?: unknown };

interface ResolvedLine {
  menuItemId: string;
  slug: string;
  qty: number;
  priceCents: number;
}

function parseLines(raw: unknown): { lines: { slug: string; qty: number }[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'At least one item required' };
  const totals = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { error: 'Each item must be { slug, qty }' };
    const { slug, qty } = entry as { slug?: unknown; qty?: unknown };
    if (typeof slug !== 'string' || slug.length === 0) return { error: 'Each item needs a slug' };
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) {
      return { error: `qty for "${slug}" must be a positive integer` };
    }
    totals.set(slug, (totals.get(slug) ?? 0) + qty);
  }
  return { lines: [...totals].map(([slug, qty]) => ({ slug, qty })) };
}

export const POST = defineHandler(async (c) => {
  const body = (await c.req.json().catch(() => null)) as CheckoutBody | null;
  const parsed = parseLines(body?.items);
  if ('error' in parsed) {
    return c.json({ success: false, error: { code: 'EMPTY_CART', message: parsed.error } }, 400);
  }

  const slugs = parsed.lines.map((line) => line.slug);
  let resolved: ResolvedLine[];
  try {
    const rows = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.isActive, 1), inArray(menuItems.slug, slugs)));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    resolved = [];
    for (const line of parsed.lines) {
      const item = bySlug.get(line.slug);
      if (!item) {
        return c.json(
          {
            success: false,
            error: { code: 'UNKNOWN_ITEM', message: `slug "${line.slug}" is not on the menu` },
          },
          400,
        );
      }
      resolved.push({
        menuItemId: item.id,
        slug: item.slug,
        qty: line.qty,
        priceCents: item.priceCents,
      });
    }
  } catch (cause) {
    console.log('[coffee/orders] menu read failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Order database is not ready yet' } },
      503,
    );
  }

  const totalCents = resolved.reduce((total, line) => total + line.priceCents * line.qty, 0);
  const orderId = `co_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const decremented: ResolvedLine[] = [];

  try {
    // Conditional decrement: the update only lands when stock is sufficient,
    // so concurrent checkouts cannot drive inventory below zero.
    for (const line of resolved) {
      const updated = await db
        .update(menuItems)
        .set({ stock: sql`${menuItems.stock} - ${line.qty}` })
        .where(and(eq(menuItems.id, line.menuItemId), gte(menuItems.stock, line.qty)))
        .returning({ id: menuItems.id });
      if (updated.length === 0) {
        await restoreStock(decremented);
        return c.json(
          {
            success: false,
            error: {
              code: 'SOLD_OUT',
              message: `${line.slug} sold out while you were checking out`,
            },
          },
          409,
        );
      }
      decremented.push(line);
    }

    await db.insert(orders).values({ id: orderId, totalCents, status: 'paid', createdAt });
    await db.insert(orderItems).values(
      resolved.map((line, index) => ({
        id: `${orderId}_${index}`,
        orderId,
        menuItemId: line.menuItemId,
        qty: line.qty,
        priceCents: line.priceCents,
      })),
    );
  } catch (cause) {
    await restoreStock(decremented);
    console.log('[coffee/orders] checkout failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Could not record the order' } },
      503,
    );
  }

  return { success: true, data: { id: orderId, totalCents, createdAt } };
});

async function restoreStock(lines: ResolvedLine[]): Promise<void> {
  for (const line of lines) {
    try {
      await db
        .update(menuItems)
        .set({ stock: sql`${menuItems.stock} + ${line.qty}` })
        .where(eq(menuItems.id, line.menuItemId));
    } catch (cause) {
      console.log(
        `[coffee/orders] stock restore failed for ${line.slug}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
}
