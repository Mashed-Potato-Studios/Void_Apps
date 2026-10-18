import { Header } from '@void-monorepo/ui';
import { CronPanel } from 'void-crons/ui';
import { coffeeJobs, COFFEE_MANIFEST, type CronsLoader } from './crons.server.js';
import '@void-monorepo/ui/styles.css';

export const head = () => ({ title: 'Cron Jobs' });

export default function CoffeeCronsPage({
  jobs = coffeeJobs,
  activity = [],
  expressionCount = COFFEE_MANIFEST.expressionCount,
  scheduleCount = COFFEE_MANIFEST.scheduleCount,
}: Partial<CronsLoader>) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Crew Coffee"
        badgeText="Cron Inspector"
        links={[
          { label: 'Menu', href: '/' },
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Crons', href: '/admin/crons', active: true },
        ]}
      />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <CronPanel
          jobs={jobs}
          activity={activity}
          expressionCount={expressionCount}
          scheduleCount={scheduleCount}
        />
      </main>
    </div>
  );
}
