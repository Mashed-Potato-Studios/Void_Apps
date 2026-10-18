import { useState, type FormEvent } from 'react';
import { Header, Card, Button } from '@void-monorepo/ui';
import { initialMenu } from '../db/seed.js';
import type { Props } from './index.server.js';
import '@void-monorepo/ui/styles.css';

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
  const inCart = Object.entries(cart).filter(([, q]) => q > 0);

  async function checkout(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!inCart.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: inCart.map(([slug, qty]) => ({ slug, qty })) }),
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
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Crew Coffee"
        badgeText="Void Quickstart"
        links={[
          { label: 'Menu', href: '/', active: true },
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Crons', href: '/admin/crons' },
        ]}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '3rem 1.5rem' }}>
        <section style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 0.5rem' }}>Crew Coffee</h1>
          <p style={{ color: '#9490a5', margin: 0 }}>
            Single origins and house blends — brewed on the Void Quickstart stack.
          </p>
        </section>
        {error ? <p style={{ color: '#ef4444' }}>error: {error}</p> : null}
        {order ? (
          <div style={{ padding: '1rem', background: '#101826', border: '1px solid #1c2b45' }}>
            <h2 style={{ marginTop: 0 }}>Order placed ({order.id})</h2>
            <p style={{ color: '#9490a5' }}>Thanks! Your coffee is on the way.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setOrder(null);
              }}
            >
              Back to menu
            </Button>
          </div>
        ) : (
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '1.25rem',
              marginBottom: '2.5rem',
            }}
          >
            {menu.map((m) => (
              <Card
                key={m.slug}
                title={m.name}
                description={m.origin === 'single' ? 'Single origin' : 'House blend'}
                tag={m.stock < 5 ? `Low stock · ${m.stock}` : `$${(m.priceCents / 100).toFixed(2)}`}
                footer={
                  <Button variant="primary" disabled={!m.stock} onClick={() => add(m.slug)}>
                    {m.stock ? 'Add to cart' : 'Sold out'}
                  </Button>
                }
              />
            ))}
          </section>
        )}
        <form
          onSubmit={checkout}
          style={{ position: 'sticky', bottom: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}
        >
          <span style={{ color: '#9490a5' }}>{inCart.length} item(s)</span>
          <Button variant="primary" disabled={!inCart.length || busy}>
            {busy ? 'Placing order…' : 'Checkout'}
          </Button>
        </form>
      </main>
    </div>
  );
}
