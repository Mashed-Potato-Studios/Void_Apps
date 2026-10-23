import { useState } from 'react';
import type { ApiEnvelope, CronJob, CronRun } from '@void-monorepo/coffee-contract';
import type { Props } from './crons.server.js';
import { AdminHeader } from '../src/AdminHeader.js';
import { formatDateTime, formatDuration } from '../src/format.js';
import '@void-monorepo/ui/styles.css';
import '@void-monorepo/coffee-theme/styles.css';
import '../src/admin.css';

export const head = () => ({ title: 'Cron Console' });

export default function CronsPage({ status = null, error = null, siteUrl = '/' }: Props) {
  const [runs, setRuns] = useState<CronRun[]>(status?.runs ?? []);
  const [running, setRunning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const jobs: CronJob[] = status?.jobs ?? [];
  const lastRunFor = (name: string): CronRun | undefined =>
    runs.find((run) => run.jobName === name);

  async function runNow(name: string): Promise<void> {
    setRunning(name);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/crons/${encodeURIComponent(name)}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const body = (await response.json()) as ApiEnvelope<CronRun>;
      if (!response.ok || !body.success) {
        throw new Error(body.success ? 'Trigger failed' : body.error.message);
      }
      setRuns((current) => [body.data, ...current].slice(0, 50));
      if (body.data.status === 'failed') {
        setActionError(`${name} failed: ${body.data.error ?? 'unknown error'}`);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="coffee-light">
      <AdminHeader active="crons" siteUrl={siteUrl} />
      <main className="admin-main">
        <h2 className="coffee-section-title" style={{ marginTop: 0 }}>
          Roastery schedule
        </h2>
        <p className="coffee-section-sub">
          {jobs.length} job{jobs.length === 1 ? '' : 's'} · {status?.expressionCount ?? 0} cron
          expression{(status?.expressionCount ?? 0) === 1 ? '' : 's'} · {status?.scheduleCount ?? 0}{' '}
          schedule{(status?.scheduleCount ?? 0) === 1 ? '' : 's'}. Runs are recorded in D1, so the
          history survives deploys.
        </p>

        {error ? <div className="coffee-alert coffee-alert-error">{error}</div> : null}
        {actionError ? <div className="coffee-alert coffee-alert-error">{actionError}</div> : null}

        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
          {jobs.map((job) => {
            const last = lastRunFor(job.name);
            return (
              <article key={job.name} className="coffee-stat-card">
                <div className="coffee-stat-body">
                  <div className="admin-job-head">
                    <span
                      className={`admin-dot${last?.status === 'failed' ? ' admin-dot--failed' : ''}`}
                      aria-hidden="true"
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="admin-actions" style={{ marginBottom: '0.35rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>{job.name}</h3>
                        {job.expressions.map((expression) => (
                          <code key={expression} className="admin-code">
                            {expression}
                          </code>
                        ))}
                      </div>
                      <p style={{ margin: '0.3rem 0 0', fontSize: '0.9rem', lineHeight: 1.55 }}>
                        {job.description}
                      </p>
                      <p className="admin-lines" style={{ margin: '0.5rem 0 0' }}>
                        {job.path} ·{' '}
                        {last
                          ? `last ${last.trigger} run ${formatDateTime(last.startedAt)} · ${last.status} · ${formatDuration(last.durationMs)}`
                          : 'no runs recorded yet'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="admin-button"
                      disabled={running !== null}
                      onClick={() => void runNow(job.name)}
                    >
                      {running === job.name ? 'Running…' : 'Run now'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <section className="admin-panel">
          <h3 className="admin-panel-title">Recent runs</h3>
          {runs.length === 0 ? (
            <p className="admin-empty">
              No runs recorded. Use “Run now”, or trigger the scheduler locally with{' '}
              <code className="admin-code">pnpm crons:trigger</code>.
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th style={{ textAlign: 'right' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <strong>{run.jobName}</strong>
                      {run.error ? <div className="admin-notice admin-notice--error">{run.error}</div> : null}
                    </td>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>{run.trigger}</td>
                    <td>{run.status}</td>
                    <td>{run.itemsProcessed}</td>
                    <td className="admin-money" style={{ textAlign: 'right' }}>
                      {formatDuration(run.durationMs)}
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
