import type { Props } from './orders.server.js';
import { AdminHeader } from '../src/AdminHeader.js';
import { formatDateTime, money } from '../src/format.js';
import '@void-monorepo/ui/styles.css';
import '@void-monorepo/coffee-theme/styles.css';
import '../src/admin.css';

export const head = () => ({ title: 'Orders' });

export default function OrdersPage({ orders = [], error = null, siteUrl = '/' }: Props) {
  const revenue = orders.reduce((total, order) => total + order.totalCents, 0);

  return (
    <div className="coffee-light">
      <AdminHeader active="orders" siteUrl={siteUrl} />
      <main className="admin-main">
        <h2 className="coffee-section-title" style={{ marginTop: 0 }}>
          Orders
        </h2>
        <p className="coffee-section-sub">
          Latest {orders.length} checkout{orders.length === 1 ? '' : 's'} · {money(revenue)} in the
          loaded window.
        </p>

        {error ? <div className="coffee-alert coffee-alert-error">{error}</div> : null}

        <section className="admin-panel">
          {orders.length === 0 ? (
            <p className="admin-empty">No orders yet. Place one from the café menu.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Drinks</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.id}</strong>
                    </td>
                    <td>{formatDateTime(order.createdAt)}</td>
                    <td className="admin-lines">
                      {order.items.length === 0
                        ? '—'
                        : order.items.map((line) => `${line.qty}× ${line.name}`).join(', ')}
                    </td>
                    <td>{order.status}</td>
                    <td className="admin-money" style={{ textAlign: 'right' }}>
                      {money(order.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
