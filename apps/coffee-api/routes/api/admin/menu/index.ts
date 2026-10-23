import { defineHandler } from 'void';
import { asc, db, desc } from 'void/db';
import { adminOnly } from '../../../../src/admin.js';
import { menuItems } from '../../../../db/schema.js';

/** Full inventory, including hidden drinks. */
export const GET = defineHandler(adminOnly, async (c) => {
  try {
    const menu = await db
      .select()
      .from(menuItems)
      .orderBy(desc(menuItems.isActive), asc(menuItems.name));
    return { success: true, data: menu };
  } catch (cause) {
    console.log('[coffee/admin/menu] failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Menu database is not ready yet' } },
      503,
    );
  }
});
