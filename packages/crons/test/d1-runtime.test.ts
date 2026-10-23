import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, it } from "node:test";
import { createD1CronStore } from "../src/d1.ts";
import { instrumentScheduled, summarizeCronError } from "../src/runtime.ts";

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

  async batch(statements: FakeStatement[]): Promise<unknown[]> {
    for (const statement of statements) await statement.run();
    return [];
  }
}

const controller = { scheduledTime: 1_000, cron: "0 * * * *", noRetry() {} };
const env = {};
const ctx = { waitUntil() {}, passThroughOnException() {} };
type Args = [typeof controller, typeof env, typeof ctx];

describe("D1 cron run store", () => {
  it("requires explicit schema initialization instead of auto-provisioning", async () => {
    const store = createD1CronStore({ db: new FakeD1(), retentionMs: 0 });
    await assert.rejects(
      store.recordEvent({
        id: "run-0", runId: "run-0", phase: "handler", jobName: "alpha",
        cron: "0 * * * *", scheduledTime: 1, occurredAt: 2, status: "success",
      }),
      /schema is not initialized/,
    );
  });

  it("persists instrumented handler runs and reads them back", async () => {
    const db = new FakeD1();
    const store = createD1CronStore({ db, retentionMs: 0 });
    await store.ensureSchema();
    const handler = instrumentScheduled("top-coffee", async (..._args: Args) => "ok", {
      store,
      now: (() => { let tick = 2_000; return () => (tick += 10); })(),
      createId: () => "run-1",
    });

    assert.equal(await handler(controller, env, ctx), "ok");
    assert.deepEqual(await store.get("run-1"), {
      id: "run-1",
      runId: "run-1",
      phase: "handler",
      jobName: "top-coffee",
      cron: "0 * * * *",
      scheduledTime: 1_000,
      occurredAt: 2_020,
      startedAt: 2_010,
      finishedAt: 2_020,
      durationMs: 10,
      status: "success",
    });
    assert.equal(await store.has("run-1"), true);
  });

  it("dedupes duplicate scheduled deliveries when the app supplies an idempotency key", async () => {
    const db = new FakeD1();
    const store = createD1CronStore({ db, retentionMs: 0 });
    await store.ensureSchema();
    const handler = instrumentScheduled("top-coffee", async (..._args: Args) => "ok", {
      store,
      idempotencyKey: (scheduled) => `top-coffee:${scheduled.cron}:${scheduled.scheduledTime}`,
    });
    await handler(controller, env, ctx);
    await handler(controller, env, ctx);
    assert.equal((await store.list(10)).length, 1);
  });

  it("keeps dispatch acknowledgement and handler completion as separate correlated records", async () => {
    const db = new FakeD1();
    const store = createD1CronStore({ db, retentionMs: 0 });
    await store.ensureSchema();
    await store.recordEvent({
      id: "dispatch:run-2",
      runId: "run-2",
      dispatchId: "dispatch-2",
      phase: "dispatch",
      jobName: "expression:0 * * * *",
      cron: "0 * * * *",
      scheduledTime: 5_000,
      occurredAt: 5_001,
      status: "success",
    });
    await store.record({
      id: "run-2",
      runId: "run-2",
      dispatchId: "dispatch-2",
      jobName: "alpha",
      cron: "0 * * * *",
      scheduledTime: 5_000,
      startedAt: 5_010,
      finishedAt: 5_020,
      durationMs: 10,
      status: "success",
    });

    const events = await store.list(10);
    assert.deepEqual(events.map((event) => event.phase), ["handler", "dispatch"]);
    assert.equal(events[0]?.dispatchId, "dispatch-2");
    assert.equal(events[1]?.runId, "run-2");
  });

  it("makes duplicate telemetry delivery idempotent", async () => {
    const db = new FakeD1();
    const store = createD1CronStore({ db, retentionMs: 0 });
    await store.ensureSchema();
    const event = {
      id: "same-event",
      runId: "run-3",
      phase: "completion" as const,
      jobName: "alpha",
      cron: "0 * * * *",
      scheduledTime: 1,
      occurredAt: 2,
      status: "success" as const,
    };
    await store.recordEvent(event);
    await store.recordEvent(event);
    assert.equal((await store.list(10)).length, 1);
  });

  it("redacts error summaries before persistence", async () => {
    const db = new FakeD1();
    const store = createD1CronStore({ db, retentionMs: 0 });
    await store.ensureSchema();
    await store.recordEvent({
      id: "run-4",
      runId: "run-4",
      phase: "completion",
      jobName: "alpha",
      cron: "0 * * * *",
      scheduledTime: 1,
      occurredAt: 2,
      status: "failed",
      error: { name: "Error", message: "token=super-secret Bearer abc.def" },
    });
    const stored = await store.get("run-4");
    assert.match(stored?.error?.message ?? "", /\[redacted\]/);
    assert.doesNotMatch(JSON.stringify(stored), /super-secret|abc\.def/);
  });

  it("enforces retention while recording new events", async () => {
    const db = new FakeD1();
    const store = createD1CronStore({ db, retentionMs: 1_000, now: () => 10_000 });
    await store.ensureSchema();
    await store.recordEvent({
      id: "old",
      runId: "old",
      phase: "handler",
      jobName: "old",
      cron: "0 * * * *",
      scheduledTime: 1,
      occurredAt: 1,
      status: "success",
    });
    await store.recordEvent({
      id: "new",
      runId: "new",
      phase: "handler",
      jobName: "new",
      cron: "0 * * * *",
      scheduledTime: 2,
      occurredAt: 9_500,
      status: "success",
    });
    assert.deepEqual((await store.list(10)).map((event) => event.id), ["new"]);
  });

  it("summarizes unknown errors without leaking secrets", async () => {
    const summary = summarizeCronError(new Error("Authorization: Bearer secret-token value"));
    assert.doesNotMatch(summary.message, /secret-token/);
    assert.equal(summary.name, "Error");
  });

  it("keeps the worker entries free of Node-only imports", () => {
    for (const file of ["runtime.ts", "d1.ts", "queue.ts", "durable.ts", "live.ts"]) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from\s+["']node:/, `${file} must stay Worker-safe`);
    }
  });
});
