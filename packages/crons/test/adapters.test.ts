import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPlatform,
  fixedPlatform,
  linkAbortSignal,
  type CronPlatform,
} from "../src/platform.ts";
import { createMemoryLedgerStore } from "../src/memory.ts";
import { instrumentScheduled, type CronLedgerEvent } from "../src/runtime.ts";
import { createCronCoordinator } from "../src/durable.ts";
import { createCronQueueCorrelation } from "../src/queue.ts";
import { sendQueueBatch } from "../src/queue-send.ts";

describe("runtime-neutral platform", () => {
  it("applies explicit overrides and fixed helpers", () => {
    const custom = createPlatform({ now: () => 42, newId: () => "fixed" });
    assert.equal(custom.now(), 42);
    assert.equal(custom.newId(), "fixed");

    const fixed = fixedPlatform({ now: 5, ids: ["a", "b"] });
    assert.equal(fixed.now(), 5);
    assert.equal(fixed.newId(), "a");
    assert.equal(fixed.newId(), "b");
    assert.equal(fixed.newId(), "id-0");
    assert.equal(typeof createPlatform().newId(), "string");
  });

  it("relays an external abort into the platform controller and cleans up", () => {
    const external = new AbortController();
    const linked = linkAbortSignal(createPlatform(), external.signal);
    assert.equal(linked.controller.signal.aborted, false);
    external.abort();
    assert.equal(linked.controller.signal.aborted, true);
    linked.cleanup();

    const already = new AbortController();
    already.abort();
    const linked2 = linkAbortSignal(createPlatform(), already.signal);
    assert.equal(linked2.controller.signal.aborted, true);
    linked2.cleanup();
  });

  it("supports the built-in fallback controller without host AbortController", () => {
    const platform = createPlatform();
    const controller = platform.createAbortController();
    let fired = 0;
    controller.signal.addEventListener("abort", () => fired++);
    controller.abort();
    controller.abort();
    assert.equal(controller.signal.aborted, true);
    assert.equal(fired, 1);
  });
});

describe("runtime-neutral memory ledger", () => {
  it("deduplicates by id, redacts errors, and respects the injected clock", async () => {
    const store = createMemoryLedgerStore({ platform: fixedPlatform({ now: 7 }), maxEvents: 2 });
    const base = {
      runId: "r",
      jobName: "job",
      cron: "* * * * *",
      scheduledTime: 1,
      phase: "handler" as const,
    };
    await store.recordEvent({ ...base, id: "a", occurredAt: 1, status: "success" });
    await store.recordEvent({
      ...base,
      id: "b",
      occurredAt: 2,
      status: "failed",
      error: { name: "Error", message: "token=abc123 failed" },
    });
    await store.recordEvent({ ...base, id: "a", occurredAt: 99, status: "success" });
    assert.equal(store.size(), 2, "duplicate id is not inserted twice");
    assert.equal(store.get("b")?.error?.message.includes("abc123"), false);
    assert.match(store.get("b")?.error?.message ?? "", /\[redacted\]/);

    await store.recordEvent({ ...base, id: "c", status: "success", occurredAt: Number.NaN });
    assert.equal(store.get("c")?.occurredAt, 7, "missing clock falls back to platform.now");
    assert.deepEqual(store.list().map((event) => event.id), ["c", "b"]);
    store.clear();
    assert.equal(store.size(), 0);
  });

  it("records instrumented runs through CronRunStore", async () => {
    const store = createMemoryLedgerStore({ platform: fixedPlatform({ now: 7 }) });
    await store.record({
      id: "run-1",
      jobName: "job",
      cron: "* * * * *",
      scheduledTime: 1,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      status: "success",
    });
    const event = store.get("run-1");
    assert.equal(event?.phase, "handler");
    assert.equal(event?.occurredAt, 2);
  });
});

describe("adapters accept injected host capabilities", () => {
  it("instrumentScheduled uses platform clock and ids", async () => {
    const platform = fixedPlatform({ now: 100, ids: ["gen-1"] });
    const store = createMemoryLedgerStore({ platform });
    const handler = instrumentScheduled("job", async () => "ok", { store, platform });
    assert.equal(await handler({ scheduledTime: 1, cron: "* * * * *" }, {}, {}), "ok");
    const [event] = store.list() as CronLedgerEvent[];
    assert.equal(event?.id, "gen-1");
    assert.equal(event?.occurredAt, 100);
    assert.equal(event?.startedAt, 100);
  });

  it("durable coordinator uses platform clock and ids", async () => {
    const values = new Map<string, unknown>();
    const store = {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async delete(key: string): Promise<void> {
        values.delete(key);
      },
    };
    const coordinator = createCronCoordinator({
      store,
      platform: fixedPlatform({ now: 10, ids: ["lease-1"] }),
    });
    const lease = await coordinator.acquire("job", "worker", 1_000);
    assert.equal(lease?.id, "lease-1");
    assert.equal(lease?.expiresAt, 1_010);
  });

  it("queue correlation stamps events with the platform clock", async () => {
    const events: CronLedgerEvent[] = [];
    const correlation = createCronQueueCorrelation({
      store: {
        async recordEvent(event) {
          events.push(event);
        },
        async has() {
          return false;
        },
      },
      sender: { async send() {} },
      platform: fixedPlatform({ now: 55 }),
    });
    await correlation.publish({
      runId: "run-1",
      jobName: "job",
      cron: "* * * * *",
      scheduledTime: 1,
      body: {},
    });
    assert.equal(events[0]?.occurredAt, 55);
  });

  it("queue dispatch uses platform fetch, clock, ids, and sleep", async () => {
    let url = "";
    let body = "";
    let sleeps = 0;
    const platform: CronPlatform = fixedPlatform({
      now: 77,
      ids: ["m1"],
      sleep: async () => {
        sleeps++;
      },
      fetch: async (input, init) => {
        url = input;
        body = init.body ?? "";
        return { ok: true, status: 200 };
      },
    });
    const result = await sendQueueBatch("emails", [{ body: { to: "a@b.c" } }], {
      origin: "http://localhost:5173",
      platform,
      maxAttempts: 2,
    });
    assert.equal(result.ok, true);
    assert.equal(result.durationMs, 0);
    assert.equal(result.count, 1);
    assert.equal(sleeps, 0);
    assert.equal(url, "http://localhost:5173/__void/queue");
    const sent = JSON.parse(body) as { messages: Array<{ id: string }> };
    assert.equal(sent.messages[0]?.id, "emails-77-0-m1");
  });

  it("queue dispatch relays an already-aborted external signal", async () => {
    const external = new AbortController();
    external.abort();
    const result = await sendQueueBatch("emails", [{ body: 1 }], {
      origin: "http://localhost:5173",
      signal: external.signal,
      platform: fixedPlatform(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 0);
    assert.match(result.reason ?? "", /aborted/);
  });
});
