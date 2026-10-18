import { Header, Card } from '@void-monorepo/ui';
import type { Props } from './dashboard.server.js';
import '@void-monorepo/ui/styles.css';

export const head = () => ({ title: 'Dashboard' });

export default function CoffeeDashboard({
  recentOrders = [],
  revenueCents = 0,
  lowStock = [],
  topCoffee = null,
}: Partial<Props>) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Crew Coffee"
        badgeText="Dashboard"
        links={[
          { label: 'Menu', href: '/' },
          { label: 'Dashboard', href: '/dashboard', active: true },
          { label: 'Crons', href: '/admin/crons' },
        ]}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <section
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}
        >
          <Card
            title="Today's Favorite"
            description={topCoffee ?? 'Not computed yet — recalculated hourly at :15 by the top-coffee cron'}
            tag="top-coffee cron"
          />
          <Card
            title="Revenue"
            description={`$${(revenueCents / 100).toFixed(2)} all-time`}
            tag={`${recentOrders.length} orders`}
          />
          <Card
            title="Low stock"
            description={lowStock.map((m) => `${m.name} · ${m.stock} left`).join(', ') || 'All stocked'}
            tag={lowStock.length ? `${lowStock.length} alerts` : 'clear'}
          />
        </section>
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Recent orders</h2>
          {recentOrders.map((o) => (
            <Card
              key={o.id}
              title={`Order ${o.id}`}
              description={new Date(o.createdAt).toLocaleString()}
              tag={`$${(o.totalCents / 100).toFixed(2)}`}
            />
          ))}
          {recentOrders.length === 0 ? (
            <p style={{ color: '#9490a5' }}>No orders yet — place one from the menu.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
