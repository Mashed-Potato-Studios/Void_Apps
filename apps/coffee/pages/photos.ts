import type { MenuItem } from '../db/schema.js';

/**
 * Coffee photography (Unsplash CDN). One stable photo per menu item, plus a
 * hero banner and dashboard accents. `w=900&q=70&auto=format&fit=crop`
 * keeps cards sharp without shipping local assets.
 */
const img = (id: string, w = 900): string =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;

export const HERO_IMAGE = img('1495474472287-4d71bcdd2085', 1800);

export const DASHBOARD_ACCENTS = {
  favorite: img('1509042239860-f550ce710b93', 800),
  revenue: img('1442512595331-e89e73853f31', 800),
  stock: img('1461023058943-07fcbe16d735', 800),
};

export const ORDER_THUMB = img('1522992319-0365e5f11656', 200);

const COFFEE_PHOTOS: Record<string, { image: string; notes: string }> = {
  yirgacheffe: {
    image: img('1447933601403-0c6688de566e'),
    notes: 'Jasmine, bergamot, honey — washed heirloom from Gedeo Zone.',
  },
  sidamo: {
    image: img('1498804103079-a6351b050096'),
    notes: 'Blueberry, cocoa nib, silky body — a natural-processed star.',
  },
  'colombia-huila': {
    image: img('1511920170033-f8396924c348'),
    notes: 'Caramel, red apple, balanced — Huila microlot, fully washed.',
  },
  'guatemala-antigua': {
    image: img('1497935586351-b67a49e012bf'),
    notes: 'Toffee, orange zest, smoke — volcanic-soil bourbon.',
  },
  'aurora-blend': {
    image: img('1504630083234-14187a9df0f5'),
    notes: 'Milk chocolate, hazelnut — our easy-drinking morning cup.',
  },
  'midnight-blend': {
    image: img('1445116572660-236099ec97a0'),
    notes: 'Dark cocoa, molasses, long finish — built for espresso.',
  },
  'swiss-decaf': {
    image: img('1512568400610-62da28bc8a13'),
    notes: 'Graham, dried fruit, clean — Swiss Water decaf, no compromise.',
  },
  'espresso-noir': {
    image: img('1522992319-0365e5f11656'),
    notes: 'Black cherry, brown sugar, crema for days — house espresso.',
  },
};

export function coffeePhoto(slug: string): { image: string; notes: string } {
  return (
    COFFEE_PHOTOS[slug] ?? {
      image: img('1495474472287-4d71bcdd2085'),
      notes: 'Roasted fresh weekly by the Crew crew.',
    }
  );
}

export type MenuItemWithPhoto = MenuItem & { image: string; notes: string };

export function withPhotos(menu: MenuItem[]): MenuItemWithPhoto[] {
  return menu.map((m) => ({ ...m, ...coffeePhoto(m.slug) }));
}
