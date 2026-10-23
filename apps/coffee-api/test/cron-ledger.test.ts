import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, it } from "node:test";
import { createCoffeeCronLedger } from "../src/cron-ledger.ts";
import { createStagingHeartbeat } from "../src/jobs/staging-heartbeat.ts";

class FakeStatement {
  private params: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly query: string;

  constructor(db: DatabaseSync, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): FakeStatement {
    const next = new FakeStatement(this.db, this.query);
    next.params = values;
    return next;
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.db.prepare(this.query).run(...(this.params as SQLInputValue[]));
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.query).all(...(this.params as SQLInputValue[])) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.query).get(...(this.params as SQLInputValue[])) as T | undefined) ?? null;
  }
}

class FakeD1 {
  readonly db = new DatabaseSync(":memory:");

  prepare(query: string): FakeStatement {
    return new FakeStatement(this.db, query);
  }
}

const controller = { scheduledTime: 1_000, cron: "0 4 * * *", noRetry() {} };
const env = {};
const ctx = { waitUntil() {}, passThroughOnException() {} };

describe("coffee cron ledger integration", () => {
  it("persists the staging-safe heartbeat through the D1 adapter", async () => {
    const db = new FakeD1();
    const store = await createCoffeeCronLedger(db);
    const handler = createStagingHeartbeat(store);

    const result = await handler(controller, env, ctx);
    assert.equal(result.jobName, "coffee-staging-heartbeat");
    assert.equal(result.status, "success");

    const runs = await store.list(10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.phase, "handler");
    assert.equal(runs[0]?.jobName, "coffee-staging-heartbeat");
    assert.equal(runs[0]?.cron, "0 4 * * *");
    assert.equal(runs[0]?.status, "success");
    assert.equal(runs[0]?.runId, "coffee-staging-heartbeat:0 4 * * *:1000");
    assert.equal((await store.get(runs[0]!.id))?.id, runs[0]!.id);
  });

  it("dedupes a duplicate scheduled delivery with the coffee idempotency key", async () => {
    const db = new FakeD1();
    const store = await createCoffeeCronLedger(db);
    const handler = createStagingHeartbeat(store);

    await handler(controller, env, ctx);
    await handler(controller, env, ctx);
    assert.equal((await store.list(10)).length, 1);
    assert.equal((await store.listByRun("coffee-staging-heartbeat:0 4 * * *:1000")).length, 1);
  });
});
