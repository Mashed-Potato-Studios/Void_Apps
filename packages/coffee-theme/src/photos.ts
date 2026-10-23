/**
 * Drink photography (Unsplash CDN) and real recipes.
 *
 * One stable photo per menu slug plus hero/dashboard accents. Each recipe is
 * the actual café spec: dose, yield, time, temperature, milk volume. Photos
 * use `w=900&q=70&auto=format&fit=crop` so cards stay sharp without shipping
 * local assets.
 */
const img = (id: string, w = 900): string =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;

export const HERO_IMAGE = img('1445116572660-236099ec97a0', 1400);

export const DASHBOARD_ACCENTS = {
  favorite: img('1498804103079-a6351b050096', 800),
  revenue: img('1495474472287-4d71bcdd2085', 800),
  stock: img('1447933601403-0c6688de566e', 800),
};

export const ORDER_THUMB = img('1522992319-0365e5f11656', 200);

const DRINK_CARDS: Record<string, { image: string; recipe: string }> = {
  espresso: {
    image: img('1510707577719-ae7c14805e3a'),
    recipe: '18g in · 36g out · 25–30s · 93°C · 9 bar',
  },
  macchiato: {
    image: img('1497935586351-b67a49e012bf'),
    recipe: '18g espresso · 1 tsp microfoam · served in a 90ml cup',
  },
  cappuccino: {
    image: img('1509042239860-f550ce710b93'),
    recipe: '1/3 espresso · 1/3 steamed milk · 1/3 foam · 120ml milk',
  },
  'flat-white': {
    image: img('1497636577773-f1231844b336'),
    recipe: '18g → 30g ristretto · 130ml microfoam · 60°C serve',
  },
  'cafe-latte': {
    image: img('1541167760496-1628856ab772'),
    recipe: '18g espresso · 220ml steamed milk · 5mm foam cap',
  },
  mocha: {
    image: img('1512568400610-62da28bc8a13'),
    recipe: '18g espresso · 15g dark chocolate · 200ml milk',
  },
  americano: {
    image: img('1521302080334-4bebac2763a6'),
    recipe: '18g espresso · 150ml hot water · 94°C · no milk',
  },
  'pour-over': {
    image: img('1442512595331-e89e73853f31'),
    recipe: '15g coffee : 250g water · 92°C · 2:30 total brew',
  },
  'cold-brew': {
    image: img('1578314675249-a6910f80cc4e'),
    recipe: '1:8 coarse grind · 16h steep at 4°C · serve over ice',
  },
  'iced-latte': {
    image: img('1558122104-355edad709f6'),
    recipe: '18g espresso · 150ml cold milk · 120g ice',
  },
};

export function coffeePhoto(slug: string): { image: string; recipe: string } {
  return (
    DRINK_CARDS[slug] ?? {
      image: img('1495474472287-4d71bcdd2085'),
      recipe: 'Brewed fresh all day by the Crew.',
    }
  );
}

export function withPhotos<T extends { slug: string }>(
  menu: T[],
): (T & { image: string; recipe: string })[] {
  return menu.map((m) => ({ ...m, ...coffeePhoto(m.slug) }));
}
