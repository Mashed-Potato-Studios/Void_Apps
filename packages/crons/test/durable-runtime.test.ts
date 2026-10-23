import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCronCoordinator, type CronCoordinationStateStore } from "../src/durable.ts";

class MemoryState implements CronCoordinationStateStore {
  readonly values = new Map<string, unknown>();
  alarm: number | null = null;
  failGet = false;

  async get<T>(key: string): Promise<T | undefined> {
    if (this.failGet) throw new Error("state unavailable");
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async setAlarm(at: number): Promise<void> {
    this.alarm = at;
  }
}

function fixture() {
  const state = new MemoryState();
  let tick = 1_000;
  const coordinator = createCronCoordinator({
    store: state,
    now: () => (tick += 10),
    createId: (() => { let id = 0; return () => `lease-${++id}`; })(),
  });
  return { state, coordinator };
}

describe("cron durable coordinator", () => {
  it("acquires one lease at a time and releases it by identity", async () => {
    const setup = fixture();
    const first = await setup.coordinator.acquire("top-coffee", "worker-a", 1_000);
    assert.equal(first?.id, "lease-1");
    assert.equal(setup.state.alarm, first?.expiresAt);
    assert.equal(await setup.coordinator.acquire("top-coffee", "worker-b", 1_000), null);
    assert.equal(await setup.coordinator.release("top-coffee", "wrong"), false);
    assert.equal(await setup.coordinator.release("top-coffee", "lease-1"), true);
    assert.ok(await setup.coordinator.acquire("top-coffee", "worker-b", 1_000));
  });

  it("serializes concurrent acquisitions within one coordinator", async () => {
    const setup = fixture();
    const [first, second] = await Promise.all([
      setup.coordinator.acquire("top-coffee", "worker-a", 1_000),
      setup.coordinator.acquire("top-coffee", "worker-b", 1_000),
    ]);
    assert.equal([first, second].filter(Boolean).length, 1);
  });

  it("reclaims an expired lease and renews only the current identity", async () => {
    const setup = fixture();
    const first = await setup.coordinator.acquire("top-coffee", "worker-a", 1_000);
    assert.ok(first);
    assert.equal(await setup.coordinator.renew("top-coffee", "wrong", 2_000), null);
    const renewed = await setup.coordinator.renew("top-coffee", first.id, 5_000);
    assert.ok(renewed && renewed.expiresAt > first.expiresAt);
    assert.equal(setup.state.alarm, renewed.expiresAt);

    setup.state.values.set("cron:lease:top-coffee", { ...first, expiresAt: 1_000 });
    const reclaimed = await setup.coordinator.acquire("top-coffee", "worker-b", 1_000);
    assert.equal(reclaimed?.owner, "worker-b");
  });

  it("runs work outside the coordination state and always releases the lease", async () => {
    const setup = fixture();
    let observed: unknown;
    const result = await setup.coordinator.withLease("top-coffee", "worker-a", 1_000, async () => {
      observed = setup.state.values.get("cron:lease:top-coffee");
      return "done";
    });
    assert.equal(result.ran, true);
    assert.equal(result.result, "done");
    assert.ok(observed);
    assert.equal(setup.state.values.has("cron:lease:top-coffee"), false);
  });

  it("skips paused jobs and fails closed when pause state is unavailable", async () => {
    const setup = fixture();
    await setup.coordinator.setPaused("top-coffee", true);
    assert.equal((await setup.coordinator.withLease("top-coffee", "worker-a", 1_000, async () => "no")).ran, false);
    assert.equal((await setup.coordinator.withLease("top-coffee", "worker-a", 1_000, async () => "no")).reason, "paused");

    setup.state.failGet = true;
    const unavailable = await setup.coordinator.withLease("top-coffee", "worker-a", 1_000, async () => "no");
    assert.equal(unavailable.ran, false);
    assert.equal(unavailable.reason, "pause-unavailable");
  });

  it("does not run work when the lease cannot be stored", async () => {
    const state = new MemoryState();
    state.put = async () => { throw new Error("state write failed"); };
    const coordinator = createCronCoordinator({ store: state });
    let calls = 0;
    const result = await coordinator.withLease("top-coffee", "worker-a", 1_000, async () => ++calls);
    assert.equal(calls, 0);
    assert.equal(result.ran, false);
    assert.equal(result.reason, "coordination-unavailable");
  });

  it("expires stale jobs from an alarm handler", async () => {
    const setup = fixture();
    const lease = await setup.coordinator.acquire("top-coffee", "worker-a", 1_000);
    assert.ok(lease);
    setup.state.values.set("cron:lease:top-coffee", { ...lease, expiresAt: 1_000 });
    assert.deepEqual(await setup.coordinator.handleAlarm(["top-coffee", "missing"]), ["top-coffee"]);
  });

  it("expires only the named job's stale lease", async () => {
    const setup = fixture();
    const lease = await setup.coordinator.acquire("top-coffee", "worker-a", 1_000);
    assert.ok(lease);
    setup.state.values.set("cron:lease:other", { ...lease, jobName: "other", expiresAt: 50_000 });
    setup.state.values.set("cron:lease:top-coffee", { ...lease, expiresAt: 1_000 });
    assert.equal(await setup.coordinator.expire("top-coffee"), true);
    assert.equal(setup.state.values.has("cron:lease:top-coffee"), false);
    assert.equal(setup.state.values.has("cron:lease:other"), true);
  });
});
