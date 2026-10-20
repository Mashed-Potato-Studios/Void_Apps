import { sqliteTable, text, integer } from 'void/schema-d1';

export const menuItems = sqliteTable('menu_items', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  origin: text('origin', { enum: ['single', 'blend'] }).notNull(),
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

export type MenuItem = typeof menuItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type CoffeeStats = typeof coffeeStats.$inferSelect;
