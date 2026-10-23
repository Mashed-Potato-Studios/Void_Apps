import { useState } from 'react';
import type { ApiEnvelope, MenuItem } from '@void-monorepo/coffee-contract';
import type { Props } from './menu.server.js';
import { AdminHeader } from '../src/AdminHeader.js';
import { money } from '../src/format.js';
import '@void-monorepo/ui/styles.css';
import '@void-monorepo/coffee-theme/styles.css';
import '../src/admin.css';

export const head = () => ({ title: 'Menu' });

interface Draft {
  price: string;
  stock: string;
  defaultStock: string;
  isActive: boolean;
}

interface Notice {
  id: string;
  kind: 'ok' | 'error';
  message: string;
}

function toDraft(item: MenuItem): Draft {
  return {
    price: (item.priceCents / 100).toFixed(2),
    stock: String(item.stock),
    defaultStock: String(item.defaultStock),
    isActive: item.isActive === 1,
  };
}

export default function MenuPage({ items = [], error = null, siteUrl = '/' }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(items.map((item) => [item.id, toDraft(item)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});

  function update(id: string, patch: Partial<Draft>): void {
    setDrafts((current) => {
      const draft = current[id];
      if (!draft) return current;
      return { ...current, [id]: { ...draft, ...patch } };
    });
  }

  async function save(item: MenuItem): Promise<void> {
    const draft = drafts[item.id];
    if (!draft) return;

    const priceCents = Math.round(Number(draft.price) * 100);
    const stock = Number(draft.stock);
    const defaultStock = Number(draft.defaultStock);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setNotices((current) => ({
        ...current,
        [item.id]: { id: item.id, kind: 'error', message: 'Price must be $0.00 or more' },
      }));
      return;
    }
    if (!Number.isInteger(stock) || stock < 0 || !Number.isInteger(defaultStock) || defaultStock < 0) {
      setNotices((current) => ({
        ...current,
        [item.id]: { id: item.id, kind: 'error', message: 'Stock values must be whole numbers' },
      }));
      return;
    }

    setSavingId(item.id);
    try {
      const response = await fetch(`/api/admin/menu/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ priceCents, stock, defaultStock, isActive: draft.isActive ? 1 : 0 }),
      });
      const body = (await response.json()) as ApiEnvelope<MenuItem>;
      if (!response.ok || !body.success) {
        throw new Error(body.success ? 'Save failed' : body.error.message);
      }
      const saved = body.data;
      setDrafts((current) => ({ ...current, [item.id]: toDraft(saved) }));
      setNotices((current) => ({
        ...current,
        [item.id]: { id: item.id, kind: 'ok', message: `Saved · ${money(saved.priceCents)}` },
      }));
    } catch (cause) {
      setNotices((current) => ({
        ...current,
        [item.id]: {
          id: item.id,
          kind: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="coffee-light">
      <AdminHeader active="menu" siteUrl={siteUrl} />
      <main className="admin-main">
        <h2 className="coffee-section-title" style={{ marginTop: 0 }}>
          Menu &amp; inventory
        </h2>
        <p className="coffee-section-sub">
          Prices, stock, and visibility. Changes hit the café menu immediately.
        </p>

        {error ? <div className="coffee-alert coffee-alert-error">{error}</div> : null}

        <section className="admin-panel">
          {items.length === 0 ? (
            <p className="admin-empty">No menu items found. Seed the coffee API database first.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Drink</th>
                  <th>Kind</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Restock to</th>
                  <th>Visible</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const draft = drafts[item.id] ?? toDraft(item);
                  const notice = notices[item.id];
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <div className="admin-lines">{item.slug}</div>
                        {notice ? (
                          <p className={`admin-notice admin-notice--${notice.kind}`}>
                            {notice.message}
                          </p>
                        ) : null}
                      </td>
                      <td>{item.origin}</td>
                      <td>
                        <input
                          className="admin-input"
                          type="number"
                          min="0"
                          step="0.25"
                          value={draft.price}
                          aria-label={`Price for ${item.name}`}
                          onChange={(event) => update(item.id, { price: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="admin-input"
                          type="number"
                          min="0"
                          step="1"
                          value={draft.stock}
                          aria-label={`Stock for ${item.name}`}
                          onChange={(event) => update(item.id, { stock: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="admin-input"
                          type="number"
                          min="0"
                          step="1"
                          value={draft.defaultStock}
                          aria-label={`Restock level for ${item.name}`}
                          onChange={(event) => update(item.id, { defaultStock: event.target.value })}
                        />
                      </td>
                      <td>
                        <label className="admin-toggle">
                          <input
                            type="checkbox"
                            checked={draft.isActive}
                            onChange={(event) => update(item.id, { isActive: event.target.checked })}
                          />
                          On menu
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-button"
                          disabled={savingId === item.id}
                          onClick={() => void save(item)}
                        >
                          {savingId === item.id ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
