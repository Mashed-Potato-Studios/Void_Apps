import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCronQueueCorrelation } from "../src/queue.ts";
import type { CronLedgerEvent, CronLedgerStore } from "../src/runtime.ts";

class MemoryLedger implements CronLedgerStore {
  readonly events = new Map<string, CronLedgerEvent>();

  async recordEvent(event: CronLedgerEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async has(id: string): Promise<boolean> {
    return this.events.has(id);
  }
}

function fixture() {
  const ledger = new MemoryLedger();
  const sent: unknown[] = [];
  const correlation = createCronQueueCorrelation({
    store: ledger,
    sender: { async send(message) { sent.push(message); } },
    now: (() => { let tick = 1_000; return () => (tick += 10); })(),
  });
  return { ledger, sent, correlation };
}

const input = {
  runId: "run-1",
  dispatchId: "dispatch-1",
  jobName: "top-coffee",
  cron: "15 * * * *",
  scheduledTime: 5_000,
  body: { batch: 1 },
};

describe("cron queue correlation", () => {
  it("publishes a typed correlated message and records the enqueue separately", async () => {
    const setup = fixture();
    const result = await setup.correlation.publish(input);
    assert.equal(result.sent, true);
    assert.equal(result.recorded, true);
    assert.deepEqual(setup.sent, [result.message]);
    assert.equal(result.message.idempotencyKey, "run-1:top-coffee:5000");
    assert.deepEqual(result.event, {
      id: "run-1:top-coffee:5000:enqueue",
      runId: "run-1",
      dispatchId: "dispatch-1",
      phase: "enqueue",
      jobName: "top-coffee",
      cron: "15 * * * *",
      scheduledTime: 5_000,
      occurredAt: 1_010,
      attempt: 1,
      status: "success",
    });
  });

  it("does not send the same idempotency key twice", async () => {
    const setup = fixture();
    await setup.correlation.publish(input);
    const duplicate = await setup.correlation.publish(input);
    assert.equal(duplicate.sent, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(setup.sent.length, 1);
  });

  it("keeps an enqueue failure separate from a successful enqueue", async () => {
    const ledger = new MemoryLedger();
    const correlation = createCronQueueCorrelation({
      store: ledger,
      sender: { async send() { throw new Error("queue unavailable"); } },
      now: () => 2_000,
    });
    const failed = await correlation.publish(input);
    assert.equal(failed.sent, false);
    assert.equal(failed.recorded, true);
    assert.equal(failed.event?.phase, "enqueue");
    assert.equal(failed.event?.status, "failed");
    assert.equal(failed.event?.id, "run-1:top-coffee:5000:enqueue-failure:1");
    assert.equal(await ledger.has("run-1:top-coffee:5000:enqueue"), false);
    const retry = await correlation.publish(input);
    assert.equal(retry.sent, false);
    assert.equal(retry.duplicate, false);
  });

  it("consumes once, records start and completion, and returns the handler result", async () => {
    const setup = fixture();
    const published = await setup.correlation.publish(input);
    let calls = 0;
    const consumed = await setup.correlation.consume(published.message, async (body, message) => {
      calls += 1;
      assert.deepEqual(body, { batch: 1 });
      assert.equal(message.runId, "run-1");
      return "done";
    });
    assert.equal(calls, 1);
    assert.equal(consumed.status, "success");
    assert.equal(consumed.result, "done");
    assert.equal(consumed.shouldRetry, false);
    assert.deepEqual([...setup.ledger.events.keys()], [
      "run-1:top-coffee:5000:enqueue",
      "run-1:top-coffee:5000:start:1",
      "run-1:top-coffee:5000:done",
    ]);
  });

  it("skips a duplicate delivery without running the handler again", async () => {
    const setup = fixture();
    const published = await setup.correlation.publish(input);
    let calls = 0;
    await setup.correlation.consume(published.message, async () => ++calls);
    const duplicate = await setup.correlation.consume(published.message, async () => ++calls);
    assert.equal(calls, 1);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.shouldRetry, false);
  });

  it("records retry and exhaustion separately from cron dispatch", async () => {
    const setup = fixture();
    const published = await setup.correlation.publish(input);
    const failed = await setup.correlation.consume(published.message, async () => {
      throw new Error("consumer failed token=hidden");
    }, { maxAttempts: 2 });
    assert.equal(failed.status, "failed");
    assert.equal(failed.shouldRetry, true);
    assert.equal(failed.event?.phase, "retry");
    assert.doesNotMatch(JSON.stringify(failed.event), /hidden/);

    const exhausted = await setup.correlation.consume(published.message, async () => {
      throw new Error("still failing");
    }, { maxAttempts: 1 });
    assert.equal(exhausted.status, "exhausted");
    assert.equal(exhausted.shouldRetry, false);
    assert.equal(exhausted.event?.phase, "exhausted");
  });

  it("does not acknowledge exhaustion when terminal evidence cannot be persisted", async () => {
    const ledger = new MemoryLedger();
    const record = ledger.recordEvent.bind(ledger);
    ledger.recordEvent = async (event) => {
      if (event.phase === "exhausted") throw new Error("ledger unavailable");
      await record(event);
    };
    const correlation = createCronQueueCorrelation({
      store: ledger,
      sender: { async send() {} },
    });
    const published = await correlation.publish(input);
    const result = await correlation.consume(published.message, async () => {
      throw new Error("consumer failed");
    }, { maxAttempts: 1 });
    assert.equal(result.status, "failed");
    assert.equal(result.shouldRetry, true);
    assert.equal(result.recorded, false);
  });

  it("fails closed without running work when the ledger cannot record the start", async () => {
    const correlation = createCronQueueCorrelation({
      store: {
        async recordEvent() { throw new Error("ledger unavailable"); },
        async has() { return false; },
      },
      sender: { async send() {} },
    });
    const published = await correlation.publish(input);
    let calls = 0;
    const result = await correlation.consume(published.message, async () => ++calls);
    assert.equal(calls, 0);
    assert.equal(result.status, "failed");
    assert.equal(result.shouldRetry, true);
  });
});
