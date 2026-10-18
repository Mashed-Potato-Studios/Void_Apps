import { useState } from 'react';
import { Header, Button } from '@void-monorepo/ui';
import { CronPanel } from '@void-monorepo/crons/ui';
import type { CronActivityEntry, CronJob } from '@void-monorepo/crons';
import '@void-monorepo/ui/styles.css';

export const head = () => ({
  title: 'Cron Jobs',
});

// Demo state mirroring apps/api/crons/cleanup.ts. In prod the loader reads
// void.crons.json + the KV/Drizzle activity store server-side; toggles persist
// to the manifest's `disabled` list. Kept client-safe: no node:fs imports here.
const initialJobs: CronJob[] = [
  {
    path: 'crons/cleanup.ts',
    name: 'daily-session-cleanup-and-workflow-wakeups',
    expressions: ['0 2 * * *'],
    status: 'active',
    usesDefineScheduled: false,
    sharedExpression: false,
  },
];

const initialActivity: CronActivityEntry[] = [
  {
    id: 'demo-1',
    jobName: 'daily-session-cleanup-and-workflow-wakeups',
    cron: '0 2 * * *',
    scheduledTime: new Date(Date.now() - 3600_000).toISOString(),
    finishedAt: new Date(Date.now() - 3599_000).toISOString(),
    durationMs: 1240,
    status: 'success',
    itemsProcessed: 14,
    source: 'local',
  },
];

export async function loader() {
  return {
    jobs: initialJobs,
    activity: initialActivity,
    expressionCount: 1,
    scheduleCount: 1,
  };
}

export default function CronsPage({
  jobs: serverJobs = initialJobs,
  activity: serverActivity = initialActivity,
  expressionCount = 1,
  scheduleCount = 1,
}: {
  jobs?: CronJob[];
  activity?: CronActivityEntry[];
  expressionCount?: number;
  scheduleCount?: number;
}) {
  const [jobs, setJobs] = useState<CronJob[]>(serverJobs);
  const [activity] = useState<CronActivityEntry[]>(serverActivity);
  const [triggering, setTriggering] = useState<string | null>(null);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Void Admin Ops"
        badgeText="Cron Inspector"
        links={[
          { label: 'Overview', href: '/' },
          { label: 'Workflows', href: '/workflows' },
          { label: 'Crons', href: '/crons', active: true },
          { label: 'Stats API', href: '/api/stats' },
        ]}
      />

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              Scheduled Jobs
            </h1>
            <p style={{ margin: 0, color: '#9490a5', fontSize: '0.875rem' }}>
              Scanned from <code>crons/</code> · Run now fires <code>POST /__void/scheduled</code> on the dev server.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              alert('Run: void-crons trigger <job> --origin http://localhost:5173 --token <dev-token>');
            }}
          >
            Trigger via CLI
          </Button>
        </div>

        <CronPanel
          jobs={jobs}
          activity={activity}
          expressionCount={expressionCount}
          scheduleCount={scheduleCount}
          triggering={triggering}
          onToggle={(jobName, disabled) => {
            // Off = skip local triggers + hide from deploy manifest (not a prod kill-switch).
            setJobs((prev) =>
              prev.map((j) => (j.name === jobName ? { ...j, status: disabled ? 'disabled' : 'active' } : j)),
            );
          }}
          onTrigger={(job) => {
            setTriggering(job.name);
            setTimeout(() => setTriggering(null), 800);
          }}
        />
      </main>
    </div>
  );
}
