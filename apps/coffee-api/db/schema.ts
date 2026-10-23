import { sqliteTable, text, integer } from 'void/schema-d1';

export const menuItems = sqliteTable('menu_items', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  origin: text('origin', { enum: ['hot', 'iced'] }).notNull(),
  priceCents: integer('price_cents').notNull(),
  stock: integer('stock').notNull().default(0),
  defaultStock: integer('default_stock').notNull().default(10),
  isActive: integer('is_active').notNull().default(1),
});

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  totalCents: integer('total_cents').notNull(),
  status: text('status', { enum: ['paid', 'pending'] })
    .notNull()
    .default('pending'),
  createdAt: text('created_at').notNull(),
});

export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  menuItemId: text('menu_item_id')
    .notNull()
    .references(() => menuItems.id),
  qty: integer('qty').notNull().default(1),
  priceCents: integer('price_cents').notNull(),
});

export const coffeeStats = sqliteTable('coffee_stats', {
  id: text('id').primaryKey(),
  topMenuItemId: text('top_menu_item_id').references(() => menuItems.id),
  computedAt: text('computed_at').notNull(),
});

/**
 * Durable scheduler history. Cloudflare's cron store is filesystem-only and
 * unavailable at runtime, so every job (scheduled or manually triggered from
 * the admin console) writes one row here.
 */
export const cronRuns = sqliteTable('cron_runs', {
  id: text('id').primaryKey(),
  jobName: text('job_name').notNull(),
  cron: text('cron').notNull(),
  trigger: text('trigger', { enum: ['schedule', 'manual'] }).notNull(),
  status: text('status', { enum: ['success', 'failed', 'skipped'] }).notNull(),
  startedAt: text('started_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  itemsProcessed: integer('items_processed').notNull().default(0),
  error: text('error'),
});

export type MenuItemRow = typeof menuItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type CoffeeStatsRow = typeof coffeeStats.$inferSelect;
export type CronRunRow = typeof cronRuns.$inferSelect;
