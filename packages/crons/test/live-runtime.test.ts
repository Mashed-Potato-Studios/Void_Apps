import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCronLiveNotifier, createCronTopicAuthorizer } from "../src/live.ts";
import { instrumentScheduled, type CronLedgerEvent, type CronRunRecord } from "../src/runtime.ts";

const controller = { scheduledTime: 1_000, cron: "0 * * * *", noRetry() {} };
const env = {};
const ctx = { waitUntil() {}, passThroughOnException() {} };
type Args = [typeof controller, typeof env, typeof ctx];

const event: CronLedgerEvent = {
  id: "run-1",
  runId: "run-1",
  phase: "handler",
  jobName: "top-coffee",
  cron: "0 * * * *",
  scheduledTime: 1_000,
  occurredAt: 2_000,
  status: "success",
};

describe("cron live notifications", () => {
  it("publishes a small correlated notification with an application-owned event id", async () => {
    const calls: unknown[] = [];
    const notifier = createCronLiveNotifier({
      stream: { async publish(...args) { calls.push(args); } },
      topic: "crons",
    });
    const result = await notifier.publish(event);
    assert.equal(result.published, true);
    assert.deepEqual(calls, [[
      "crons",
      {
        id: "run-1",
        runId: "run-1",
        phase: "handler",
        jobName: "top-coffee",
        cron: "0 * * * *",
        scheduledTime: 1_000,
        occurredAt: 2_000,
        status: "success",
      },
      { type: "cron-run", eventId: "live:run-1" },
    ]]);
  });

  it("notifies only after the run store acknowledges persistence", async () => {
    const order: string[] = [];
    const notifier = createCronLiveNotifier({
      stream: { async publish() { order.push("publish"); } },
      topic: "crons",
    });
    const run: CronRunRecord = {
      id: "run-2",
      jobName: "top-coffee",
      cron: "0 * * * *",
      scheduledTime: 1_000,
      startedAt: 1_010,
      finishedAt: 1_020,
      durationMs: 10,
      status: "success",
    };
    const handler = instrumentScheduled("top-coffee", async (..._args: Args) => "ok", {
      store: { async record(record) { order.push("store"); assert.equal(record.id, "run-2"); } },
      createId: () => "run-2",
      notify: async () => { await notifier.notify(run); },
    });
    assert.equal(await handler(controller, env, ctx), "ok");
    assert.deepEqual(order, ["store", "publish"]);
  });

  it("isolates publish failures and reports them without failing business work", async () => {
    const failures: unknown[] = [];
    const notifier = createCronLiveNotifier({
      stream: { async publish() { throw new Error("live unavailable"); } },
      topic: "crons",
      onError(error) { failures.push(error); },
    });
    const result = await notifier.publish(event);
    assert.equal(result.published, false);
    assert.match(result.error?.message ?? "", /live unavailable/);
    await notifier.notify({
      id: "run-3", jobName: "top-coffee", cron: "0 * * * *", scheduledTime: 1,
      startedAt: 2, finishedAt: 3, durationMs: 1, status: "success",
    });
    assert.equal(failures.length, 1);
  });

  it("redacts secrets from notification payloads", async () => {
    const calls: unknown[] = [];
    const notifier = createCronLiveNotifier({
      stream: { async publish(_topic, data) { calls.push(data); } },
      topic: "crons",
    });
    await notifier.publish({
      ...event,
      status: "failed",
      error: { name: "Error", message: "token=super-secret Bearer abc.def" },
    });
    assert.doesNotMatch(JSON.stringify(calls), /super-secret|abc\.def/);
  });

  it("fails closed when topic authorization is missing or throws", async () => {
    const deny = createCronTopicAuthorizer({ authorize: () => false });
    const allow = createCronTopicAuthorizer({ authorize: (_topic, role: string) => role === "admin" });
    const broken = createCronTopicAuthorizer({ authorize: () => { throw new Error("auth unavailable"); } });
    assert.equal(await deny("crons", {}), false);
    assert.equal(await allow("crons", "admin"), true);
    assert.equal(await allow("crons", "viewer"), false);
    assert.equal(await broken("crons", {}), false);
  });
});
