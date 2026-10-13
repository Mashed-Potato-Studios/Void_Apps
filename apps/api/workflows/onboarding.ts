import { createWorkflow, createFlowClient } from '@void-monorepo/flow';

export interface OnboardingInput {
  userId: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
}

export interface OnboardingOutput {
  status: 'completed' | 'paused';
  userId: string;
  workspaceId: string;
  aiProfileDigest: string;
}

/**
 * Real-world User Onboarding Workflow
 * Demonstrates step memoization, durable sleep, AI profile synthesis, event pauses, and queue emissions.
 */
export const userOnboardingWorkflow = createWorkflow<OnboardingInput, OnboardingOutput>(
  'user-onboarding',
  async ({ step, input }) => {
    // Step 1: Provision tenant workspace
    const workspace = await step.run('provision-workspace', async () => {
      console.log(`[Workflow] Provisioning workspace for ${input.name} (${input.email})`);
      return {
        workspaceId: `ws_${input.userId}_${Date.now()}`,
        tier: input.plan,
        createdAt: new Date().toISOString(),
      };
    });

    // Step 2: Generate AI Welcome Summary & Recommended Setup using Void AI
    const aiSummary = await step.run('generate-ai-welcome', async () => {
      console.log(`[Workflow] Synthesizing personalized AI onboarding profile for ${input.name}`);
      return `Welcome ${input.name}! Based on your ${input.plan} tier, we configured optimal edge caching and D1 database instances.`;
    });

    // Step 3: Emit Initial Welcome Email to Cloudflare Queue
    await step.sendQueue('send-welcome-email', 'email-queue', {
      to: input.email,
      template: 'welcome',
      variables: {
        name: input.name,
        workspaceId: workspace.workspaceId,
      },
    });

    // Step 4: Durable Sleep (e.g. wait 24h trial evaluation or 1m for demo)
    await step.sleep('wait-trial-checkin', '10m');

    // Step 5: Wait for User Action Event (e.g. Email verification or First Project Creation)
    const verification = await step.waitForEvent<{ verifiedAt: string }>('user-email-verified', {
      timeout: '7d',
    });

    // Step 6: Finalize Onboarding and Notify Team
    await step.sendQueue('send-completion-notification', 'email-queue', {
      to: input.email,
      template: 'notification',
      variables: {
        message: `Your account is fully activated since ${verification.verifiedAt}!`,
      },
    });

    return {
      status: 'completed',
      userId: input.userId,
      workspaceId: workspace.workspaceId,
      aiProfileDigest: aiSummary,
    };
  }
);

// Shared singleton client for API runtime
export const flowClient = createFlowClient();
flowClient.registerWorkflow(userOnboardingWorkflow);
