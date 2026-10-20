import { Header } from '@void-monorepo/ui';
import { coffeeJobs, COFFEE_MANIFEST, type CronsLoader } from './crons.server.js';
import '@void-monorepo/ui/styles.css';
import '../coffee.css';

export const head = () => ({ title: 'Cron Jobs' });

const JOB_BLURBS: Record<string, string> = {
  'coffee-nightly-restock': 'Restocks every active menu item up to its default level. Never exceeds default, never touches orders.',
  'coffee-top-coffee': 'Group-by over order_items — rewrites the 1-row coffee_stats.current behind “Today’s Favorite”.',
  'coffee-stock-alert': 'Morning low-stock digest — logs every active item under 5 units so the crew pulls from the roastery before opening.',
  'coffee-sales-digest': 'Friday 18:00 week-in-review — counts orders and sums revenue for the week.',
};

function nextFire(cron: string): string {
  // Friendly static hint; precise countdowns come from `void-crons list`.
  if (cron.startsWith('0 3')) return 'Tonight at 03:00';
  if (cron.startsWith('30 7')) return 'Tomorrow at 07:30';
  if (cron.includes('18') && cron.endsWith('5')) return 'Friday at 18:00';
  return 'Every hour at :15';
}

export default function CoffeeCronsPage({
  jobs = coffeeJobs,
  activity = [],
  expressionCount = COFFEE_MANIFEST.expressionCount,
  scheduleCount = COFFEE_MANIFEST.scheduleCount,
}: Partial<CronsLoader>) {
  return (
    <div className="coffee-light">
      <Header
        appName="Crew Coffee"
        badgeText="Cron Inspector"
        links={[
          { label: 'Menu', href: '/' },
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Crons', href: '/admin/crons', active: true },
        ]}
        style={{ backgroundColor: '#fffdf8', borderBottom: '1px solid #e7dccb' }}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem 3rem' }}>
        <h2 className="coffee-section-title" style={{ marginTop: 0 }}>
          Roastery schedule
        </h2>
        <p className="coffee-section-sub">
          {jobs.length} jobs · {expressionCount}/100 expressions · {scheduleCount}/1000 schedules —
          the background jobs that keep the shelves full, the favorite fresh, and the crew informed.
        </p>
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {jobs.map((job) => {
            const name = job.name || job.path.replace(/^crons\//, '').replace(/\.\w+$/, '');
            const blurb = JOB_BLURBS[name] ?? 'Scheduled maintenance job.';
            return (
              <article key={job.path} className="coffee-stat-card">
                <div className="coffee-stat-body" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <span
                    aria-label={job.status}
                    title={job.status}
                    style={{
                      marginTop: '0.35rem',
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: job.status === 'active' ? '#4d7c5f' : '#c07f2e',
                      boxShadow: job.status === 'active' ? '0 0 0 4px rgba(77,124,95,0.18)' : 'none',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.6rem',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                      }}
                    >
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>{name}</h3>
                      {job.expressions.map((expr) => (
                        <code
                          key={expr}
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: '0.78rem',
                            background: '#f3ede3',
                            border: '1px solid #e7dccb',
                            borderRadius: 999,
                            padding: '0.15rem 0.6rem',
                            color: '#6f4e37',
                          }}
                        >
                          {expr}
                        </code>
                      ))}
                    </div>
                    <p style={{ margin: '0.45rem 0 0', fontSize: '0.88rem', color: '#7a6a58', lineHeight: 1.55 }}>
                      {blurb}
                    </p>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#a89880' }}>
                      {job.path} · next: {nextFire(job.expressions[0] ?? '')} ·{' '}
                      {job.usesDefineScheduled ? 'defineScheduled' : 'plain handler'}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
        <section style={{ marginTop: '2.5rem' }}>
          <h2 className="coffee-section-title">Recent runs</h2>
          <p className="coffee-section-sub">
            Latest scheduler activity — fire manually with POST /__void/scheduled.
          </p>
          {activity.length === 0 ? (
            <p style={{ color: '#7a6a58' }}>
              No runs recorded yet. Boot dev and trigger a cron to see activity here.
            </p>
          ) : (
            activity.slice(0, 20).map((entry) => (
              <div key={entry.id} className="coffee-order-row">
                <span
                  aria-label={entry.status}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    flexShrink: 0,
                    background:
                      entry.status === 'success'
                        ? '#4d7c5f'
                        : entry.status === 'failed'
                          ? '#b3402e'
                          : '#c07f2e',
                  }}
                />
                <div className="coffee-order-meta">
                  <p className="coffee-order-id">{entry.jobName}</p>
                  <p className="coffee-order-date">
                    {entry.cron} · {(entry.durationMs / 1000).toFixed(1)}s
                    {entry.itemsProcessed !== undefined ? ` · ${entry.itemsProcessed} items` : ''}
                    {entry.error ? ` · ${entry.error}` : ''}
                  </p>
                </div>
                <span className="coffee-order-total">{entry.status}</span>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
