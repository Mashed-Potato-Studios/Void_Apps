import { Header } from '@void-monorepo/ui';
import type { Props } from './dashboard.server.js';
import { DASHBOARD_ACCENTS, ORDER_THUMB } from './photos.js';
import '@void-monorepo/ui/styles.css';
import './coffee.css';

export const head = () => ({ title: 'Dashboard' });

export default function CoffeeDashboard({
  recentOrders = [],
  revenueCents = 0,
  lowStock = [],
  topCoffee = null,
}: Partial<Props>) {
  return (
    <div className="coffee-light">
      <Header
        appName="Crew Coffee"
        badgeText="Dashboard"
        links={[
          { label: 'Menu', href: '/' },
          { label: 'Dashboard', href: '/dashboard', active: true },
          { label: 'Crons', href: '/admin/crons' },
        ]}
        style={{ backgroundColor: '#fffdf8', borderBottom: '1px solid #e7dccb' }}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem 3rem' }}>
        <h2 className="coffee-section-title" style={{ marginTop: 0 }}>
          Café dashboard
        </h2>
        <p className="coffee-section-sub">Today&apos;s pulse — sales, stock, and the crowd favorite.</p>
        <section className="coffee-dashboard-grid">
          <div className="coffee-stat-card">
            <div className="coffee-stat-photo" style={{ backgroundImage: `url(${DASHBOARD_ACCENTS.favorite})` }} />
            <div className="coffee-stat-body">
              <div className="coffee-stat-label">Today&apos;s favorite</div>
              <p className="coffee-stat-value">{topCoffee ?? '—'}</p>
              <p className="coffee-stat-sub">
                {topCoffee
                  ? 'Most-ordered bag, recomputed hourly at :15'
                  : 'Not computed yet — the top-coffee cron runs hourly at :15'}
              </p>
            </div>
          </div>
          <div className="coffee-stat-card">
            <div className="coffee-stat-photo" style={{ backgroundImage: `url(${DASHBOARD_ACCENTS.revenue})` }} />
            <div className="coffee-stat-body">
              <div className="coffee-stat-label">Revenue · all-time</div>
              <p className="coffee-stat-value">${(revenueCents / 100).toFixed(2)}</p>
              <p className="coffee-stat-sub">
                {recentOrders.length} order{recentOrders.length === 1 ? '' : 's'} placed
              </p>
            </div>
          </div>
          <div className="coffee-stat-card">
            <div className="coffee-stat-photo" style={{ backgroundImage: `url(${DASHBOARD_ACCENTS.stock})` }} />
            <div className="coffee-stat-body">
              <div className="coffee-stat-label">Low stock</div>
              <p className="coffee-stat-value">
                {lowStock.length ? `${lowStock.length} alert${lowStock.length === 1 ? '' : 's'}` : 'All stocked'}
              </p>
              <p className="coffee-stat-sub">
                {lowStock.length
                  ? lowStock.map((m) => `${m.name} · ${m.stock} left`).join(' · ')
                  : 'Shelves are full. Nice.'}
              </p>
            </div>
          </div>
        </section>
        <section style={{ marginTop: '2.5rem' }}>
          <h2 className="coffee-section-title">Recent orders</h2>
          <p className="coffee-section-sub">Latest checkouts, freshest first.</p>
          {recentOrders.map((o) => (
            <div key={o.id} className="coffee-order-row">
              <img className="coffee-order-thumb" src={ORDER_THUMB} alt="" loading="lazy" />
              <div className="coffee-order-meta">
                <p className="coffee-order-id">Order {o.id}</p>
                <p className="coffee-order-date">{new Date(o.createdAt).toLocaleString()}</p>
              </div>
              <span className="coffee-order-total">${(o.totalCents / 100).toFixed(2)}</span>
            </div>
          ))}
          {recentOrders.length === 0 ? (
            <p style={{ color: '#7a6a58' }}>No orders yet — place one from the menu.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
