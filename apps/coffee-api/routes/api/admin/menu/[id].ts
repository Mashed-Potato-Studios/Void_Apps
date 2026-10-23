import { defineHandler } from 'void';
import { db, eq } from 'void/db';
import { adminOnly } from '../../../../src/admin.js';
import { menuItems } from '../../../../db/schema.js';

type Body = Record<string, unknown>;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export const PATCH = defineHandler(adminOnly, async (c) => {
  const id = c.req.param('id') ?? '';
  const body = (await c.req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== 'object') {
    return c.json(
      { success: false, error: { code: 'BAD_UPDATE', message: 'Expected a JSON object' } },
      400,
    );
  }

  const patch: {
    priceCents?: number;
    stock?: number;
    defaultStock?: number;
    isActive?: 0 | 1;
  } = {};

  if ('priceCents' in body) {
    if (!isNonNegativeInteger(body.priceCents)) {
      return c.json(
        { success: false, error: { code: 'BAD_UPDATE', message: 'priceCents must be a non-negative integer' } },
        400,
      );
    }
    patch.priceCents = body.priceCents;
  }
  if ('stock' in body) {
    if (!isNonNegativeInteger(body.stock)) {
      return c.json(
        { success: false, error: { code: 'BAD_UPDATE', message: 'stock must be a non-negative integer' } },
        400,
      );
    }
    patch.stock = body.stock;
  }
  if ('defaultStock' in body) {
    if (!isNonNegativeInteger(body.defaultStock)) {
      return c.json(
        {
          success: false,
          error: { code: 'BAD_UPDATE', message: 'defaultStock must be a non-negative integer' },
        },
        400,
      );
    }
    patch.defaultStock = body.defaultStock;
  }
  if ('isActive' in body) {
    if (body.isActive !== 0 && body.isActive !== 1) {
      return c.json(
        { success: false, error: { code: 'BAD_UPDATE', message: 'isActive must be 0 or 1' } },
        400,
      );
    }
    patch.isActive = body.isActive;
  }

  if (Object.keys(patch).length === 0) {
    return c.json(
      { success: false, error: { code: 'BAD_UPDATE', message: 'No editable fields supplied' } },
      400,
    );
  }

  try {
    const [updated] = await db
      .update(menuItems)
      .set(patch)
      .where(eq(menuItems.id, id))
      .returning();
    if (!updated) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: `No menu item "${id}"` } },
        404,
      );
    }
    return { success: true, data: updated };
  } catch (cause) {
    console.log('[coffee/admin/menu] update failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Could not update the menu item' } },
      503,
    );
  }
});
