import { createFlowClient } from './client';
import { createWorkflow } from './core/workflow';
import { MemoryStorageAdapter } from './storage/adapter';

async function runVerification() {
  console.log('--- [TEST] Starting Void Flow Engine Verification ---');

  const storage = new MemoryStorageAdapter();
  const flow = createFlowClient({ storage });

  let sideEffectRunCount = 0;

  // Test Workflow
  const testFlow = createWorkflow<{ email: string }, { finalStatus: string }>(
    'test-flow',
    async ({ step, input }) => {
      // Step 1: Memoized Side Effect
      const step1Result = await step.run('step-1-fetch', async () => {
        sideEffectRunCount++;
        return { data: `hello_${input.email}`, count: sideEffectRunCount };
      });

      // Step 2: Sleep for 1 second
      await step.sleep('step-2-sleep', '1s');

      // Step 3: Wait for event
      const eventData = await step.waitForEvent<{ approved: boolean }>('step-3-approval', {
        timeout: '1m',
      });

      return { finalStatus: `done_${step1Result.data}_${eventData.approved}` };
    }
  );

  flow.registerWorkflow(testFlow);

  // Phase 1: Start workflow -> should execute Step 1, then pause at Step 2 (sleep)
  console.log('1. Starting Workflow execution...');
  const exec1 = await flow.start(testFlow, { email: 'test@void.app' });
  console.log(`   Execution status: "${exec1.status}" (Expected: "sleeping")`);
  if (exec1.status !== 'sleeping') throw new Error(`Expected sleeping, got ${exec1.status}`);
  if (sideEffectRunCount !== 1) throw new Error(`Expected sideEffectRunCount = 1, got ${sideEffectRunCount}`);

  // Phase 2: Verify deterministic memoization - re-executing should NOT re-run Step 1
  console.log('2. Replaying before sleep elapsed (testing step memoization)...');
  const exec2 = await flow.start(testFlow, { email: 'test@void.app' }, { executionId: exec1.id });
  console.log(`   Execution status: "${exec2.status}", Side effect count: ${sideEffectRunCount} (Expected: 1)`);
  if (sideEffectRunCount !== 1) throw new Error(`Memoization failed: step re-executed!`);

  // Phase 3: Wait 1.1 seconds and process sleeping workflows
  console.log('3. Waiting for sleep duration to elapse...');
  await new Promise((r) => setTimeout(r, 1100));
  const { resumedCount } = await flow.processSleeping();
  console.log(`   Resumed ${resumedCount} sleeping workflow(s).`);

  const exec3 = await flow.getExecution(exec1.id);
  console.log(`   Execution status: "${exec3.execution?.status}" (Expected: "waiting_event")`);
  if (exec3.execution?.status !== 'waiting_event') {
    throw new Error(`Expected waiting_event, got ${exec3.execution?.status}`);
  }

  // Phase 4: Dispatch event to resume workflow
  console.log('4. Dispatching "step-3-approval" event...');
  await flow.sendEvent('step-3-approval', { approved: true }, exec1.id);

  const exec4 = await flow.getExecution(exec1.id);
  console.log(`   Execution status: "${exec4.execution?.status}" (Expected: "completed")`);
  console.log(`   Final Output:`, exec4.execution?.output);

  if (exec4.execution?.status !== 'completed') {
    throw new Error(`Expected completed, got ${exec4.execution?.status}`);
  }

  console.log('--- [TEST PASSED] Void Flow Engine verified successfully! ---');
}

runVerification().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
