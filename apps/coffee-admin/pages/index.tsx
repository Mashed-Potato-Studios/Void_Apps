import type { Props } from './index.server.js';
import { AdminHeader } from '../src/AdminHeader.js';
import { formatDateTime, money } from '../src/format.js';
import { DASHBOARD_ACCENTS } from '@void-monorepo/coffee-theme';
import '@void-monorepo/ui/styles.css';
import '@void-monorepo/coffee-theme/styles.css';

export const head = () => ({ title: 'Overview' });

export default function OverviewPage({ overview = null, error = null, siteUrl = '/' }: Props) {
  return (
    <div className="coffee-light">
      <AdminHeader active="overview" siteUrl={siteUrl} />
      <main className="admin-main">
        <h2 className="coffee-section-title" style={{ marginTop: 0 }}>
          Café overview
        </h2>
        <p className="coffee-section-sub">
          Today&apos;s pulse across the café — sales, stock, and the crowd favorite.
        </p>

        {error ? <div className="coffee-alert coffee-alert-error">{error}</div> : null}

        {overview ? (
          <>
            <section className="coffee-dashboard-grid">
              <article className="coffee-stat-card">
                <div
                  className="coffee-stat-photo"
                  style={{ backgroundImage: `url(${DASHBOARD_ACCENTS.revenue})` }}
                />
                <div className="coffee-stat-body">
                  <div className="coffee-stat-label">Today · revenue</div>
                  <p className="coffee-stat-value">{money(overview.todayRevenueCents)}</p>
                  <p className="coffee-stat-sub">
                    {overview.todayOrderCount} order{overview.todayOrderCount === 1 ? '' : 's'} since
                    midnight UTC
                  </p>
                </div>
              </article>

              <article className="coffee-stat-card">
                <div
                  className="coffee-stat-photo"
                  style={{ backgroundImage: `url(${DASHBOARD_ACCENTS.favorite})` }}
                />
                <div className="coffee-stat-body">
                  <div className="coffee-stat-label">Today&apos;s favorite</div>
                  <p className="coffee-stat-value">{overview.topCoffee ?? '—'}</p>
                  <p className="coffee-stat-sub">
                    {overview.topCoffeeComputedAt
                      ? `Recomputed ${formatDateTime(overview.topCoffeeComputedAt)}`
                      : 'Run the hourly top-coffee job to compute it'}
                  </p>
                </div>
              </article>

              <article className="coffee-stat-card">
                <div
                  className="coffee-stat-photo"
                  style={{ backgroundImage: `url(${DASHBOARD_ACCENTS.stock})` }}
                />
                <div className="coffee-stat-body">
                  <div className="coffee-stat-label">Low stock</div>
                  <p className="coffee-stat-value">
                    {overview.lowStock.length
                      ? `${overview.lowStock.length} alert${overview.lowStock.length === 1 ? '' : 's'}`
                      : 'All stocked'}
                  </p>
                  <p className="coffee-stat-sub">
                    {overview.lowStock.length
                      ? overview.lowStock.map((item) => `${item.name} · ${item.stock} left`).join(' · ')
                      : 'Shelves are full. Nice.'}
                  </p>
                </div>
              </article>
            </section>

            <section className="admin-panel">
              <h3 className="admin-panel-title">All time</h3>
              <dl className="admin-metrics">
                <div>
                  <dt>Revenue</dt>
                  <dd>{money(overview.revenueCents)}</dd>
                </div>
                <div>
                  <dt>Orders</dt>
                  <dd>{overview.orderCount}</dd>
                </div>
                <div>
                  <dt>Drinks on the menu</dt>
                  <dd>{overview.activeMenuCount}</dd>
                </div>
              </dl>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
