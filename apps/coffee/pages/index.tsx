import { useState, type FormEvent } from 'react';
import { Header } from '@void-monorepo/ui';
import type { Props } from './index.server.js';
import { HERO_IMAGE, coffeePhoto } from '@void-monorepo/coffee-theme';
import '@void-monorepo/ui/styles.css';
import '@void-monorepo/coffee-theme/styles.css';

export const head = () => ({
  title: 'Menu',
  meta: [
    {
      name: 'description',
      content: 'Crew Coffee — cozy corner café. Espresso, cappuccino, pour over and more, brewed to real recipes.',
    },
  ],
});

function Sparkle({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 1.8l2.4 7.6 7.8 2.6-7.8 2.6L12 22.2l-2.4-7.6L1.8 12l7.8-2.6z"
        fill="currentColor"
        stroke="#23433d"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SteamDoodle() {
  return (
    <svg className="coffee-doodle coffee-doodle--steam" viewBox="0 0 40 60" aria-hidden="true" focusable="false">
      <path d="M14 56c-6-8 6-10 2-18s6-10 2-18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M28 56c-5-7 5-9 1-16s5-9 1-16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function LeafDoodle() {
  return (
    <svg className="coffee-doodle coffee-doodle--leaf" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M6 34C6 18 18 6 34 6c0 16-12 28-28 28Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M10 30C16 22 22 16 30 10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function StorefrontPage({ menu = [], menuError = null, adminUrl = '/' }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{ id: string } | null>(null);

  const add = (slug: string): void => setCart((c) => ({ ...c, [slug]: (c[slug] ?? 0) + 1 }));
  const remove = (slug: string): void =>
    setCart((c) => {
      const next = { ...c };
      const qty = (next[slug] ?? 0) - 1;
      if (qty <= 0) delete next[slug];
      else next[slug] = qty;
      return next;
    });
  const entries = Object.entries(cart).filter(([, q]) => q > 0);
  const itemCount = entries.reduce((n, [, q]) => n + q, 0);
  const nameFor = (slug: string): string => menu.find((m) => m.slug === slug)?.name ?? slug;

  async function checkout(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!entries.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: entries.map(([slug, qty]) => ({ slug, qty })) }),
      });
      const json = (await res.json()) as { success: boolean; data?: { id: string }; error?: { message: string } };
      if (!json.success || !json.data) throw new Error(json.error?.message ?? 'Checkout failed');
      setOrder(json.data);
      setCart({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coffee-light">
      <Header
        appName="Crew Coffee"
        badgeText="Void Quickstart"
        links={[
          { label: 'Menu', href: '/', active: true },
          { label: 'Staff', href: adminUrl },
        ]}
        style={{ backgroundColor: '#fffbf0', borderBottom: '3px solid #23433d' }}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        <section className="coffee-hero">
          <div className="coffee-hero-copy">
            <span className="coffee-eyebrow">Small batch · slow mornings</span>
            <h1>
              Good mornings start at <span className="coffee-underline">Crew Coffee</span>.
            </h1>
            <p>
              Real espresso, hand-poured brews, and ten recipes we actually follow behind the
              counter. Pick a drink below — stock is live, and the barista sees your order.
            </p>
            <div className="coffee-hero-actions">
              <a className="coffee-hero-cta" href="#menu">
                Browse the menu ↓
              </a>
              <span className="coffee-hero-note">{menu.length} drinks · real recipes</span>
            </div>
            <div className="coffee-speech">Freshly ground, always.</div>
          </div>
          <figure className="coffee-hero-frame">
            <img src={HERO_IMAGE} alt="Sunlit café table with a french press beside a garden window" />
            <SteamDoodle />
            <Sparkle className="coffee-doodle coffee-doodle--sparkle-a" />
            <Sparkle className="coffee-doodle coffee-doodle--sparkle-b" />
            <LeafDoodle />
          </figure>
        </section>

        {menuError ? (
          <div className="coffee-alert coffee-alert-error" style={{ marginTop: '1.5rem' }}>
            {menuError}
          </div>
        ) : null}

        {error ? (
          <div className="coffee-alert coffee-alert-error" style={{ marginTop: '1.5rem' }}>
            Checkout failed: {error}
          </div>
        ) : null}

        {order ? (
          <div className="coffee-confirm" style={{ marginTop: '1.5rem' }}>
            <div className="coffee-confirm-sparkles" aria-hidden="true">
              <Sparkle className="" />
              <Sparkle className="" />
              <Sparkle className="" />
              <Sparkle className="" />
            </div>
            <h2>Order {order.id} is in!</h2>
            <p>Thanks — the barista is already grinding. Show this id at the counter.</p>
            <button
              className="coffee-add-btn"
              onClick={() => {
                setOrder(null);
              }}
            >
              Back to menu
            </button>
          </div>
        ) : (
          <>
            <h2 id="menu" className="coffee-section-title">
              The menu
            </h2>
            <p className="coffee-section-sub">
              {menu.length} drinks · hot and iced · {menu.filter((m) => m.stock > 0).length} ready right now
            </p>
            <section className="coffee-menu-grid">
              {menu.map((m) => {
                const { image, recipe } = coffeePhoto(m.slug);
                const qty = cart[m.slug] ?? 0;
                return (
                  <article key={m.slug} className="coffee-card">
                    <div className="coffee-card-photo">
                      <img src={image} alt={m.name} loading="lazy" />
                      <span className="coffee-card-origin">{m.origin === 'hot' ? 'Hot' : 'Iced'}</span>
                    </div>
                    <div className="coffee-card-body">
                      <h3 className="coffee-card-name">{m.name}</h3>
                      <p className="coffee-card-recipe">{recipe}</p>
                      <div className="coffee-card-row">
                        <span className="coffee-price">${(m.priceCents / 100).toFixed(2)}</span>
                        {m.stock === 0 ? (
                          <span className="coffee-stock-out">Sold out</span>
                        ) : m.stock < 5 ? (
                          <span className="coffee-stock-low">Only {m.stock} left</span>
                        ) : (
                          <span className="coffee-stock-low coffee-stock-low--ok">In stock</span>
                        )}
                      </div>
                      <div className="coffee-card-row">
                        {qty > 0 ? (
                          <div className="coffee-cart-controls">
                            <button
                              type="button"
                              className="coffee-add-btn coffee-add-btn--ghost"
                              onClick={() => remove(m.slug)}
                              aria-label={`Remove one ${m.name}`}
                            >
                              −
                            </button>
                            <strong>{qty} in cart</strong>
                            <button
                              type="button"
                              className="coffee-add-btn"
                              disabled={!m.stock}
                              onClick={() => add(m.slug)}
                              aria-label={`Add one ${m.name}`}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="coffee-add-btn"
                            disabled={!m.stock}
                            onClick={() => add(m.slug)}
                          >
                            {m.stock ? 'Add to cart' : 'Sold out'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}

        {!order && entries.length > 0 ? (
          <form className="coffee-cartbar" onSubmit={checkout}>
            <span className="coffee-cartbar-count">
              <strong>{itemCount}</strong> item{itemCount === 1 ? '' : 's'} ·{' '}
              {entries.map(([slug, qty]) => `${qty}× ${nameFor(slug)}`).join(', ')}
            </span>
            <button type="submit" className="coffee-checkout-btn" disabled={busy}>
              {busy ? 'Placing order…' : 'Checkout →'}
            </button>
          </form>
        ) : null}
      </main>
    </div>
  );
}
