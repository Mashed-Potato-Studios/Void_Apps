import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFlowClient } from "../src/client.ts";
import { createWorkflow } from "../src/core/workflow.ts";
import { MemoryStorageAdapter } from "../src/storage/adapter.ts";

describe("Void Flow engine", () => {
  it("memoizes steps, sleeps durably, and resumes on event", async () => {
    const storage = new MemoryStorageAdapter();
    const flow = createFlowClient({ storage });

    let sideEffectRunCount = 0;

    const testFlow = createWorkflow<{ email: string }, { finalStatus: string }>(
      "test-flow",
      async ({ step, input }) => {
        // Step 1: Memoized side effect
        const step1Result = await step.run("step-1-fetch", async () => {
          sideEffectRunCount++;
          return { data: `hello_${input.email}`, count: sideEffectRunCount };
        });

        // Step 2: Durable sleep (500ms duration, 1500ms wait = 3x margin)
        await step.sleep("step-2-sleep", 500);

        // Step 3: Wait for event
        const eventData = await step.waitForEvent<{ approved: boolean }>(
          "step-3-approval",
          { eventName: "approval-received", timeout: "1m" }
        );

        return { finalStatus: `done_${step1Result.data}_${eventData.approved}` };
      }
    );

    flow.registerWorkflow(testFlow);

    // Phase 1: Start workflow -> executes Step 1, pauses at Step 2 (sleep)
    const exec1 = await flow.start(testFlow, { email: "test@void.app" });
    assert.equal(exec1.status, "sleeping");
    assert.equal(sideEffectRunCount, 1);

    // Phase 2: Replay before sleep elapses -> Step 1 must NOT re-run
    const exec2 = await flow.start(
      testFlow,
      { email: "test@void.app" },
      { executionId: exec1.id }
    );
    assert.equal(exec2.status, "sleeping");
    assert.equal(sideEffectRunCount, 1);

    // Phase 3: Elapse sleep, process sleeping workflows
    await new Promise((r) => setTimeout(r, 1500));
    const { resumedCount } = await flow.processSleeping();
    assert.equal(resumedCount, 1);

    const exec3 = await flow.getExecution(exec1.id);
    assert.equal(exec3.execution?.status, "waiting_event");

    // Phase 4: Dispatch event -> completes workflow
    await flow.sendEvent("approval-received", { approved: true }, exec1.id);

    const exec4 = await flow.getExecution(exec1.id);
    assert.equal(exec4.execution?.status, "completed");
    assert.deepEqual(exec4.execution?.output, {
      finalStatus: "done_hello_test@void.app_true",
    });
  });

  it("reuses stored input on resume and ignores new input", async () => {
    const flow = createFlowClient({ storage: new MemoryStorageAdapter() });

    const echo = createWorkflow<{ v: string }, { v: string }>(
      "echo-flow",
      async ({ step, input }) => {
        const evt = await step.waitForEvent<{ go: boolean }>("wait", {
          eventName: "go",
        });
        assert.equal(evt.go, true);
        return { v: input.v };
      }
    );
    flow.registerWorkflow(echo);

    const started = await flow.start(echo, { v: "a" });
    assert.equal(started.status, "waiting_event");

    // Resume with different input: stored input "a" must win.
    const resumed = await flow.start(echo, { v: "b" }, { executionId: started.id });
    assert.equal(resumed.status, "waiting_event");

    await flow.sendEvent("go", { go: true }, started.id);
    const done = await flow.getExecution(started.id);
    assert.equal(done.execution?.status, "completed");
    assert.deepEqual(done.execution?.output, { v: "a" });
  });

  it("throws when resuming an execution under a different workflow name", async () => {
    const flow = createFlowClient({ storage: new MemoryStorageAdapter() });

    const first = createWorkflow("first-flow", async () => "first");
    const other = createWorkflow("other-flow", async () => "other");
    flow.registerWorkflow(first);
    flow.registerWorkflow(other);

    const started = await flow.start(first, {});
    await assert.rejects(
      flow.start(other, {}, { executionId: started.id }),
      /belongs to workflow/
    );
  });
});
