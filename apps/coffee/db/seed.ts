import { defineSeed } from 'void/seed';

export const initialMenu = [
  { id: 'ci_yirgacheffe_01', slug: 'yirgacheffe', name: 'Yirgacheffe', origin: 'single' as const, priceCents: 1850, stock: 12, defaultStock: 12, isActive: 1 },
  { id: 'ci_sidamo_02', slug: 'sidamo', name: 'Sidamo', origin: 'single' as const, priceCents: 1750, stock: 8, defaultStock: 10, isActive: 1 },
  { id: 'ci_huila_03', slug: 'colombia-huila', name: 'Colombia Huila', origin: 'single' as const, priceCents: 1650, stock: 4, defaultStock: 10, isActive: 1 },
  { id: 'ci_antigua_04', slug: 'guatemala-antigua', name: 'Guatemala Antigua', origin: 'single' as const, priceCents: 1900, stock: 6, defaultStock: 10, isActive: 1 },
  { id: 'ci_blend_aurora_05', slug: 'aurora-blend', name: 'Aurora Blend', origin: 'blend' as const, priceCents: 1400, stock: 20, defaultStock: 20, isActive: 1 },
  { id: 'ci_blend_midnight_06', slug: 'midnight-blend', name: 'Midnight Blend', origin: 'blend' as const, priceCents: 1550, stock: 15, defaultStock: 20, isActive: 1 },
  { id: 'ci_decaf_07', slug: 'swiss-decaf', name: 'Swiss Water Decaf', origin: 'single' as const, priceCents: 1600, stock: 2, defaultStock: 8, isActive: 1 },
  { id: 'ci_espresso_08', slug: 'espresso-noir', name: 'Espresso Noir', origin: 'blend' as const, priceCents: 1300, stock: 0, defaultStock: 6, isActive: 1 },
  { id: 'ci_blend_siesta_09', slug: 'siesta-blend', name: 'Siesta Blend', origin: 'blend' as const, priceCents: 1450, stock: 14, defaultStock: 14, isActive: 1 },
  { id: 'ci_ethiopia_guji_10', slug: 'ethiopia-guji', name: 'Ethiopia Guji', origin: 'single' as const, priceCents: 1950, stock: 9, defaultStock: 9, isActive: 1 },
];

// Intentional low-stock cases (Huila=4, Decaf=2, Espresso Noir=0) drive the
// dashboard low-stock alert card.
export default defineSeed<typeof import('./schema.js')>(async ({ db, schema }) => {
  await db.insert(schema.menuItems).values(initialMenu);
});
