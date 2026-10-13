import { Header, Card, Button } from '@void-monorepo/ui';
import { initialPosts } from '@void-monorepo/db/seed';
import '@void-monorepo/ui/styles.css';

export const head = () => ({
  title: 'Dashboard',
});

// Void SSR Loader (Runs on edge server before rendering)
export async function loader() {
  return {
    posts: initialPosts,
    serverTime: new Date().toISOString(),
    region: 'iad (Edge Worker)',
  };
}

export default function DashboardPage({ posts, serverTime, region }: { posts: typeof initialPosts; serverTime: string; region: string }) {
  const postList = posts || initialPosts;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Void Portal"
        badgeText="SSR Dashboard"
        links={[
          { label: 'Overview', href: '/' },
          { label: 'Dashboard', href: '/dashboard', active: true },
          { label: 'API Health', href: '/api/health' },
        ]}
      />

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              App Dashboard
            </h1>
            <p style={{ margin: 0, color: '#9490a5', fontSize: '0.875rem' }}>
              Edge Server Time: <code style={{ color: '#00e5ff' }}>{serverTime || new Date().toISOString()}</code> | Region: {region || 'Cloudflare Edge'}
            </p>
          </div>
          <Button variant="primary">Create New Post</Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {postList.map((post) => (
            <Card
              key={post.id}
              title={post.title}
              description={post.content}
              tag={post.published ? 'Published' : 'Draft'}
              footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9490a5' }}>
                  <span>Slug: /{post.slug}</span>
                  <span>Views: {post.viewCount}</span>
                </div>
              }
            />
          ))}
        </div>
      </main>
    </div>
  );
}
