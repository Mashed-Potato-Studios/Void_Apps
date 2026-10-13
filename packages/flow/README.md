# Void Flow (`@void-monorepo/flow`)

An edge-native, zero-external-dependency **Durable Workflow & Orchestration Engine** designed specifically for **Void Cloud** and **Cloudflare Workers**.

---

## ✨ Features

- **Deterministic Step Memoization (`step.run`)**: Automatically saves the results of async functions to D1/Postgres. On worker timeouts or retries, completed steps return cached results instantly.
- **Durable Sleep (`step.sleep`)**: Sleep for seconds, minutes, hours, or days (`'10m'`, `'24h'`, `'7d'`) without keeping serverless isolates active.
- **Event-Driven Resumption (`step.waitForEvent`)**: Pause execution until an external webhook or human approval arrives.
- **Queue Dispatching (`step.sendQueue`)**: Seamlessly trigger background Cloudflare Queues (`queues/*.ts`).
- **Embedded Visual Graph (`WorkflowGraph`)**: Interactive React UI component to visualize execution timelines and payloads.

---

## 🚀 Quick Example

```typescript
import { createWorkflow } from '@void-monorepo/flow';

export const userOnboardingWorkflow = createWorkflow('user-onboarding', async ({ step, input }) => {
  // Step 1: Create Stripe Customer
  const customer = await step.run('create-stripe-customer', async () => {
    return await stripe.customers.create({ email: input.email });
  });

  // Step 2: Durable Sleep for 24 hours
  await step.sleep('wait-trial-period', '24h');

  // Step 3: Run AI profile enrichment
  const summary = await step.run('generate-ai-digest', async () => {
    return await ai.run('@cf/meta/llama-3-8b-instruct', { prompt: `Summarize: ${input.name}` });
  });

  // Step 4: Wait for user email verification or manager approval
  const approval = await step.waitForEvent('email-verified', { timeout: '7d' });

  // Step 5: Send final welcome email via Queue
  await step.sendQueue('email-queue', {
    to: input.email,
    template: 'welcome',
    summary,
  });

  return { status: 'completed', customerId: customer.id };
});
```

---

## 🛠️ Usage with Void Flow Client

```typescript
import { createFlowClient } from '@void-monorepo/flow';
import { userOnboardingWorkflow } from './workflows/onboarding';

const flow = createFlowClient();

// 1. Start Workflow
const execution = await flow.start(userOnboardingWorkflow, {
  userId: 'user_123',
  email: 'alex@example.com',
  name: 'Alex Developer',
});

// 2. Send Event to Resume Waiting Workflow
await flow.sendEvent('email-verified', { verifiedAt: new Date().toISOString() });

// 3. Process Sleeping Workflows (called in crons/cleanup.ts)
await flow.processSleeping();
```
