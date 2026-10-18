import { useState, type FormEvent } from 'react';
import { Header } from '@void-monorepo/ui';
import { initialMenu } from '../db/seed.js';
import type { Props } from './index.server.js';
import { HERO_IMAGE, coffeePhoto } from './photos.js';
import '@void-monorepo/ui/styles.css';
import './coffee.css';

export const head = () => ({
  title: 'Menu',
  meta: [{ name: 'description', content: 'Crew Coffee menu — single origins and house blends' }],
});

export default function StorefrontPage({ menu = initialMenu }: Props) {
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

  async function checkout(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!entries.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
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
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Crons', href: '/admin/crons' },
        ]}
        style={{ backgroundColor: '#fffdf8', borderBottom: '1px solid #e7dccb' }}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem 3rem' }}>
        <section className="coffee-hero" style={{ backgroundImage: `url(${HERO_IMAGE})` }}>
          <div className="coffee-hero-shade" />
          <div className="coffee-hero-copy">
            <span className="coffee-eyebrow">Roasted fresh · Brewed slow</span>
            <h1>Good mornings start at Crew Coffee.</h1>
            <p>
              Single origins and house blends, roasted weekly and brewed with
              care. Pick your bag below — checkout is a demo, the aroma is real.
            </p>
            <a className="coffee-hero-cta" href="#menu">
              Shop the menu ↓
            </a>
          </div>
        </section>

        {error ? (
          <div className="coffee-alert coffee-alert-error" style={{ marginTop: '1.5rem' }}>
            Checkout failed: {error}
          </div>
        ) : null}

        {order ? (
          <div className="coffee-confirm" style={{ marginTop: '1.5rem' }}>
            <h2>Order {order.id} is in! ☕</h2>
            <p>Thanks — your coffee is being bagged. Show this id at the counter.</p>
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
              Ten roasts · whole bean · {menu.filter((m) => m.stock > 0).length} in stock now
            </p>
            <section className="coffee-menu-grid">
              {menu.map((m) => {
                const { image, notes } = coffeePhoto(m.slug);
                const qty = cart[m.slug] ?? 0;
                return (
                  <article key={m.slug} className="coffee-card">
                    <div className="coffee-card-photo">
                      <img src={image} alt={m.name} loading="lazy" />
                      <span className="coffee-card-origin">
                        {m.origin === 'single' ? 'Single origin' : 'House blend'}
                      </span>
                    </div>
                    <div className="coffee-card-body">
                      <h3 className="coffee-card-name">{m.name}</h3>
                      <p className="coffee-card-notes">{notes}</p>
                      <div className="coffee-card-row">
                        <span className="coffee-price">${(m.priceCents / 100).toFixed(2)}</span>
                        {m.stock === 0 ? (
                          <span className="coffee-stock-out">Sold out</span>
                        ) : m.stock < 5 ? (
                          <span className="coffee-stock-low">Only {m.stock} left</span>
                        ) : (
                          <span className="coffee-stock-low" style={{ color: '#4d7c5f' }}>
                            In stock
                          </span>
                        )}
                      </div>
                      <div className="coffee-card-row">
                        {qty > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <button type="button" className="coffee-add-btn" onClick={() => remove(m.slug)}>
                              −
                            </button>
                            <strong>{qty} in cart</strong>
                            <button
                              type="button"
                              className="coffee-add-btn"
                              disabled={!m.stock}
                              onClick={() => add(m.slug)}
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
              {entries.map(([slug, qty]) => `${qty}× ${slug}`).join(', ')}
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
