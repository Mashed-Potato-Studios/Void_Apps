import { Header, Card, Button } from '@void-monorepo/ui';
import { initialUsers, initialPosts } from '@void-monorepo/db/seed';
import '@void-monorepo/ui/styles.css';

export const head = () => ({
  title: 'Admin Operations',
});

export async function loader() {
  return {
    userCount: initialUsers.length,
    postCount: initialPosts.length,
    activeWorkflows: 3,
    edgeRegion: 'iad',
    status: 'Operational',
  };
}

export default function AdminDashboard({
  userCount = initialUsers.length,
  postCount = initialPosts.length,
  activeWorkflows = 3,
  edgeRegion = 'iad',
  status = 'Operational',
}: {
  userCount: number;
  postCount: number;
  activeWorkflows: number;
  edgeRegion: string;
  status: string;
}) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Void Admin Ops"
        badgeText="Admin Console"
        links={[
          { label: 'Overview', href: '/', active: true },
          { label: 'Workflows', href: '/workflows' },
          { label: 'Crons', href: '/crons' },
          { label: 'Stats API', href: '/api/stats' },
          { label: 'Public Web', href: 'http://localhost:5173' },
        ]}
      />

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              System & Operations Console
            </h1>
            <p style={{ margin: 0, color: '#9490a5', fontSize: '0.875rem' }}>
              Infrastructure status: <span style={{ color: '#10b981', fontWeight: 600 }}>{status}</span> | Edge Region: {edgeRegion}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button asLink href="/workflows" variant="primary">
              View Workflows Engine →
            </Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          <Card title="Total Users" tag="D1 Database">
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#fff', margin: '0.5rem 0' }}>
              {userCount}
            </div>
            <span style={{ fontSize: '0.75rem', color: '#9490a5' }}>Managed via Better-Auth & Drizzle</span>
          </Card>

          <Card title="Durable Workflows" tag="Void Flow">
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#818cf8', margin: '0.5rem 0' }}>
              {activeWorkflows} Active
            </div>
            <span style={{ fontSize: '0.75rem', color: '#9490a5' }}>Edge-native state machines</span>
          </Card>

          <Card title="Total Posts" tag="Content">
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#00e5ff', margin: '0.5rem 0' }}>
              {postCount}
            </div>
            <span style={{ fontSize: '0.75rem', color: '#9490a5' }}>Cached via Edge ISR</span>
          </Card>

          <Card title="Cron Triggers" tag="Cloudflare Workers">
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#10b981', margin: '0.5rem 0' }}>
              Active
            </div>
            <span style={{ fontSize: '0.75rem', color: '#9490a5' }}>Cleanup & Workflow sleep wakeups</span>
          </Card>
        </div>

        <Card title="Recent System Activities">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem', color: '#9490a5' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #231f32' }}>
              <span>Void Flow engine initialized with user-onboarding workflow</span>
              <span style={{ color: '#635f75' }}>Just now</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #231f32' }}>
              <span>D1 Schema migrations applied</span>
              <span style={{ color: '#635f75' }}>10 mins ago</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
              <span>Turborepo pipeline initialized</span>
              <span style={{ color: '#635f75' }}>1 hour ago</span>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
