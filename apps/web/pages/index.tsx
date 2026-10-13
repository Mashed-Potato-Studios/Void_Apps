import { Header, Card, Button } from '@void-monorepo/ui';
import '@void-monorepo/ui/styles.css';

export const head = () => ({
  title: 'Home',
  meta: [
    { name: 'description', content: 'Void Cloud full-stack web application powered by Vite' },
  ],
});

export default function HomePage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Void Portal"
        badgeText="Vite + Void"
        links={[
          { label: 'Overview', href: '/', active: true },
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'API Health', href: '/api/health' },
          { label: 'Docs', href: 'https://void.cloud/guide/' },
        ]}
      />

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '3.5rem 1.5rem' }}>
        <section style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.25rem 0.75rem',
              borderRadius: '999px',
              backgroundColor: '#151220',
              border: '1px solid #231f32',
              fontSize: '0.8rem',
              color: '#9490a5',
              marginBottom: '1.5rem',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00e5ff' }}></span>
            Deployed on Void Cloud Infrastructure
          </div>

          <h1
            style={{
              fontSize: '3.25rem',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              margin: '0 0 1.25rem',
            }}
          >
            Ship Full-Stack Vite Apps at Warp Speed
          </h1>

          <p
            style={{
              fontSize: '1.25rem',
              color: '#9490a5',
              maxWidth: '650px',
              margin: '0 auto 2.5rem',
              lineHeight: 1.6,
            }}
          >
            A scalable monorepo structure with shared database schemas, auth, UI components, typed API client, and edge-native server routing.
          </p>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Button asLink href="/dashboard" variant="primary">
              Explore Dashboard
            </Button>
            <Button asLink href="https://void.cloud/guide/" variant="secondary">
              Void Cloud Docs →
            </Button>
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          <Card
            title="Zero-Config Binding Inference"
            description="Void automatically detects imports like void/db, void/kv, void/ai, and provisions the resources for both local and edge runtime."
            tag="Inference"
          />
          <Card
            title="Edge Pages & Routing"
            description="Hybrid server-rendered pages and API endpoints with file-based routing, instant ISR revalidation, and view transitions."
            tag="SSR / ISR"
          />
          <Card
            title="Monorepo Workspaces"
            description="Orchestrated by Turborepo and pnpm for fast incremental builds, shared Drizzle schemas, and unified deployment pipelines."
            tag="Turborepo"
          />
        </section>
      </main>
    </div>
  );
}
