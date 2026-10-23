import { defineSeed } from 'void/seed';

export const initialMenu = [
  { id: 'ci_espresso_01', slug: 'espresso', name: 'Espresso', origin: 'hot' as const, priceCents: 300, stock: 0, defaultStock: 12, isActive: 1 },
  { id: 'ci_macchiato_02', slug: 'macchiato', name: 'Macchiato', origin: 'hot' as const, priceCents: 325, stock: 4, defaultStock: 10, isActive: 1 },
  { id: 'ci_cappuccino_03', slug: 'cappuccino', name: 'Cappuccino', origin: 'hot' as const, priceCents: 400, stock: 18, defaultStock: 18, isActive: 1 },
  { id: 'ci_flat_white_04', slug: 'flat-white', name: 'Flat White', origin: 'hot' as const, priceCents: 425, stock: 14, defaultStock: 14, isActive: 1 },
  { id: 'ci_latte_05', slug: 'cafe-latte', name: 'Café Latte', origin: 'hot' as const, priceCents: 450, stock: 16, defaultStock: 16, isActive: 1 },
  { id: 'ci_mocha_06', slug: 'mocha', name: 'Mocha', origin: 'hot' as const, priceCents: 475, stock: 11, defaultStock: 11, isActive: 1 },
  { id: 'ci_americano_07', slug: 'americano', name: 'Americano', origin: 'hot' as const, priceCents: 350, stock: 20, defaultStock: 20, isActive: 1 },
  { id: 'ci_pour_over_08', slug: 'pour-over', name: 'Pour Over V60', origin: 'hot' as const, priceCents: 450, stock: 2, defaultStock: 8, isActive: 1 },
  { id: 'ci_cold_brew_09', slug: 'cold-brew', name: 'Cold Brew', origin: 'iced' as const, priceCents: 475, stock: 9, defaultStock: 9, isActive: 1 },
  { id: 'ci_iced_latte_10', slug: 'iced-latte', name: 'Iced Latte', origin: 'iced' as const, priceCents: 425, stock: 13, defaultStock: 13, isActive: 1 },
];

// Intentional low-stock cases (Macchiato=4, Pour Over=2, Espresso=0) make the
// admin low-stock card useful on a freshly seeded database.
export default defineSeed<typeof import('./schema.js')>(async ({ db, schema }) => {
  await db.insert(schema.menuItems).values(initialMenu);
});
