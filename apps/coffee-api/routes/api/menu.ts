import { defineHandler } from 'void';
import { db, asc, eq } from 'void/db';
import { menuItems } from '../../db/schema.js';

/** Public café menu: active drinks only. */
export const GET = defineHandler(async (c) => {
  try {
    const menu = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.isActive, 1))
      .orderBy(asc(menuItems.name));
    return { success: true, data: menu };
  } catch (cause) {
    console.log('[coffee/menu] read failed:', cause instanceof Error ? cause.message : String(cause));
    return c.json(
      {
        success: false,
        error: { code: 'DB_UNAVAILABLE', message: 'Menu database is not ready yet' },
      },
      503,
    );
  }
});
