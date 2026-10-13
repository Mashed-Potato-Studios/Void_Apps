import { Header, Card, Button } from '@void-monorepo/ui';
import { WorkflowGraph } from '@void-monorepo/flow/ui';
import type { WorkflowExecution, WorkflowStepRecord } from '@void-monorepo/flow';
import '@void-monorepo/ui/styles.css';

export const head = () => ({
  title: 'Durable Workflows',
});

// Demo workflow execution state loaded on edge server
export async function loader() {
  const sampleExecution: WorkflowExecution = {
    id: 'wf_onboarding_89234',
    workflowName: 'user-onboarding',
    status: 'sleeping',
    input: {
      userId: 'user_alex_99',
      email: 'alex@example.com',
      name: 'Alex Developer',
      plan: 'pro',
    },
    currentStepIndex: 3,
    wakeUpAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    waitingForEventName: 'user-email-verified',
    createdAt: new Date(Date.now() - 30000).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleSteps: WorkflowStepRecord[] = [
    {
      id: 'step_1',
      executionId: 'wf_onboarding_89234',
      stepId: 'provision-workspace',
      stepType: 'run',
      status: 'completed',
      output: { workspaceId: 'ws_user_alex_99', tier: 'pro' },
      durationMs: 42,
      attempts: 1,
      createdAt: new Date(Date.now() - 30000).toISOString(),
      completedAt: new Date(Date.now() - 29958).toISOString(),
    },
    {
      id: 'step_2',
      executionId: 'wf_onboarding_89234',
      stepId: 'generate-ai-welcome',
      stepType: 'run',
      status: 'completed',
      output: 'Welcome Alex Developer! Pro tier edge caching configured.',
      durationMs: 310,
      attempts: 1,
      createdAt: new Date(Date.now() - 29950).toISOString(),
      completedAt: new Date(Date.now() - 29640).toISOString(),
    },
    {
      id: 'step_3',
      executionId: 'wf_onboarding_89234',
      stepId: 'send-welcome-email',
      stepType: 'send_queue',
      status: 'completed',
      output: { sent: true, queueName: 'email-queue' },
      durationMs: 18,
      attempts: 1,
      createdAt: new Date(Date.now() - 29630).toISOString(),
      completedAt: new Date(Date.now() - 29612).toISOString(),
    },
    {
      id: 'step_4',
      executionId: 'wf_onboarding_89234',
      stepId: 'wait-trial-checkin',
      stepType: 'sleep',
      status: 'running',
      attempts: 1,
      createdAt: new Date(Date.now() - 29600).toISOString(),
    },
  ];

  return {
    execution: sampleExecution,
    steps: sampleSteps,
  };
}

export default function WorkflowsPage({
  execution,
  steps,
}: {
  execution: WorkflowExecution;
  steps: WorkflowStepRecord[];
}) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#08060d', color: '#fff' }}>
      <Header
        appName="Void Admin Ops"
        badgeText="Void Flow Engine"
        links={[
          { label: 'Overview', href: '/' },
          { label: 'Workflows', href: '/workflows', active: true },
          { label: 'Stats API', href: '/api/stats' },
        ]}
      />

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              Durable Workflow Orchestrator
            </h1>
            <p style={{ margin: 0, color: '#9490a5', fontSize: '0.875rem' }}>
              Zero-external-dependency state machines running natively on Void Cloud edge workers.
            </p>
          </div>
          <Button variant="primary">Trigger New Workflow</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
          <WorkflowGraph
            execution={execution}
            steps={steps}
            onSendEvent={(eventName) => {
              alert(`Dispatched "${eventName}" event via API to resume waiting steps!`);
            }}
          />

          <Card title="Engine Architecture Overview" tag="@void-monorepo/flow">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
              <div style={{ backgroundColor: '#151220', padding: '1rem', borderRadius: '6px', border: '1px solid #231f32' }}>
                <div style={{ color: '#00e5ff', fontWeight: 600, fontSize: '0.9rem' }}>Deterministic Replay</div>
                <div style={{ color: '#9490a5', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  Finished steps are cached in D1 SQLite and skipped during worker restarts.
                </div>
              </div>
              <div style={{ backgroundColor: '#151220', padding: '1rem', borderRadius: '6px', border: '1px solid #231f32' }}>
                <div style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.9rem' }}>Durable Sleep</div>
                <div style={{ color: '#9490a5', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  Paused isolates yield compute and awaken via Cloudflare Cron triggers.
                </div>
              </div>
              <div style={{ backgroundColor: '#151220', padding: '1rem', borderRadius: '6px', border: '1px solid #231f32' }}>
                <div style={{ color: '#f59e0b', fontWeight: 600, fontSize: '0.9rem' }}>Event-Driven Resumption</div>
                <div style={{ color: '#9490a5', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  Wait for user verification or webhook events without polling.
                </div>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
