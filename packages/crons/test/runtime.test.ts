import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { instrumentScheduled } from "../src/runtime.ts";
import type { CronRunRecord, CronRunStore } from "../src/runtime.ts";

const controller = { scheduledTime: 100, cron: "*/5 * * * *", noRetry() {} };
const env = { binding: { value: "user-owned" } };
const ctx = { waitUntil(_promise: Promise<unknown>) {}, passThroughOnException() {} };
type Arguments = [typeof controller, typeof env, typeof ctx];

function fixture() {
  const runs: CronRunRecord[] = [];
  const store: CronRunStore = {
    async record(run) {
      runs.push(run);
    },
  };
  let tick = 1_000;
  return { runs, store, now: () => (tick += 25), createId: () => "run-1" };
}

describe("instrumentScheduled", () => {
  it("forwards the exact typed tuple once, returns the result, and records actual timing", async () => {
    const setup = fixture();
    const value = { items: 3 };
    let calls = 0;
    const handler = instrumentScheduled("cleanup", async (...args: Arguments) => {
      calls += 1;
      assert.equal(args[0], controller);
      assert.equal(args[1], env);
      assert.equal(args[2], ctx);
      return value;
    }, setup);
    const typed: (...args: Arguments) => Promise<typeof value> = handler;
    assert.equal(await typed(controller, env, ctx), value);
    assert.equal(calls, 1);
    assert.deepEqual(setup.runs, [{
      id: "run-1", jobName: "cleanup", cron: controller.cron,
      scheduledTime: 100, startedAt: 1_025, finishedAt: 1_050,
      durationMs: 25, status: "success",
    }]);
  });

  it("accepts a structural defineScheduled contract without importing an SDK", async () => {
    const defineScheduled = (handler: (...args: Arguments) => unknown | Promise<unknown>) => handler;
    const handler = defineScheduled(async (scheduled, bindings, context) => {
      assert.equal(scheduled, controller);
      assert.equal(bindings, env);
      assert.equal(context, ctx);
      return "done";
    });
    assert.equal(await instrumentScheduled("structural", handler, fixture())(controller, env, ctx), "done");
  });

  it("forwards synchronous returns and supports void handlers", async () => {
    assert.equal(await instrumentScheduled("sync", (..._args: Arguments) => 42, fixture())(controller, env, ctx), 42);
    const handler: (...args: Arguments) => Promise<void> = instrumentScheduled(
      "void", async (..._args: Arguments) => {}, fixture(),
    );
    assert.equal(await handler(controller, env, ctx), undefined);
  });

  it("awaits the pause policy with the original tuple and skips business work", async () => {
    const setup = fixture();
    let calls = 0;
    let policyArgs: Arguments | undefined;
    const handler = instrumentScheduled("paused", async (..._args: Arguments) => { calls += 1; }, {
      ...setup,
      async isPaused(...args) {
        policyArgs = args;
        return true;
      },
    });
    assert.equal(await handler(controller, env, ctx), undefined);
    assert.equal(calls, 0);
    assert.equal(policyArgs?.[0], controller);
    assert.equal(policyArgs?.[1], env);
    assert.equal(policyArgs?.[2], ctx);
    assert.equal(setup.runs[0]?.status, "skipped");
  });

  it("runs exactly once when the asynchronous policy allows execution", async () => {
    const setup = fixture();
    let calls = 0;
    const handler = instrumentScheduled("allowed", async (..._args: Arguments) => ++calls, {
      ...setup, isPaused: async () => false,
    });
    assert.equal(await handler(controller, env, ctx), 1);
    assert.equal(calls, 1);
    assert.equal(setup.runs[0]?.status, "success");
  });

  it("fails closed on policy rejection even if the observer rejects", async () => {
    const setup = fixture();
    const failure = new Error("policy unavailable");
    let calls = 0;
    const observed: unknown[] = [];
    const handler = instrumentScheduled("closed", async (..._args: Arguments) => { calls += 1; }, {
      ...setup,
      async isPaused() { throw failure; },
      async onTelemetryError(error, stage) {
        observed.push(error, stage);
        throw new Error("observer unavailable");
      },
    });
    await handler(controller, env, ctx);
    assert.equal(calls, 0);
    assert.deepEqual(observed, [failure, "pause"]);
    assert.equal(setup.runs[0]?.status, "skipped");
  });

  for (const failure of [new Error("business failed"), { reason: "business failed" }, undefined]) {
    it(`preserves thrown identity (${String(failure)}) despite telemetry failures`, async () => {
      const setup = fixture();
      let calls = 0;
      const order: string[] = [];
      const handler = instrumentScheduled("failed", (..._args: Arguments) => {
        calls += 1;
        throw failure;
      }, {
        ...setup,
        store: { async record(run) {
          order.push("store");
          setup.runs.push(run);
          throw new Error("store failed");
        } },
        async notify(run) {
          order.push("notify");
          assert.equal(run.status, "failed");
          throw new Error("notify failed");
        },
        onTelemetryError(_error, stage) { order.push(stage + " error"); throw "observer failed"; },
      });
      let rejected = false;
      try {
        await handler(controller, env, ctx);
      } catch (error) {
        rejected = true;
        assert.equal(error, failure);
      }
      assert.equal(rejected, true);
      assert.equal(calls, 1);
      assert.equal(setup.runs[0]?.status, "failed");
      assert.deepEqual(order, ["store", "store error"]);
    });
  }

  it("awaits persistence before notification and forwards notification arguments", async () => {
    const setup = fixture();
    const order: string[] = [];
    let notifiedRun: CronRunRecord | undefined;
    let notifiedArgs: Arguments | undefined;
    const handler = instrumentScheduled("ordered", async (..._args: Arguments) => {
      order.push("handler");
      return "result";
    }, {
      ...setup,
      store: { async record(run) {
        await Promise.resolve();
        setup.runs.push(run);
        order.push("store");
      } },
      async notify(run, ...args) {
        notifiedRun = run;
        notifiedArgs = args;
        order.push("notify");
      },
    });
    assert.equal(await handler(controller, env, ctx), "result");
    assert.equal(notifiedRun, setup.runs[0]);
    assert.equal(notifiedArgs?.[0], controller);
    assert.equal(notifiedArgs?.[1], env);
    assert.equal(notifiedArgs?.[2], ctx);
    assert.deepEqual(order, ["handler", "store", "notify"]);
  });

  it("records an asynchronous handler rejection and rethrows the same value", async () => {
    const setup = fixture();
    const failure = new Error("async business failure");
    let calls = 0;
    const handler = instrumentScheduled("rejected", async (..._args: Arguments) => {
      calls += 1;
      throw failure;
    }, setup);
    await assert.rejects(handler(controller, env, ctx), (error: unknown) => error === failure);
    assert.equal(calls, 1);
    assert.equal(setup.runs[0]?.status, "failed");
  });

  it("retains the incoming schedule metadata if business work mutates the controller", async () => {
    const setup = fixture();
    const mutable = { ...controller };
    const handler = instrumentScheduled("metadata", async (scheduled: typeof mutable, _env: typeof env, _ctx: typeof ctx) => {
      scheduled.cron = "changed";
      scheduled.scheduledTime = 999;
    }, setup);
    await handler(mutable, env, ctx);
    assert.equal(setup.runs[0]?.cron, controller.cron);
    assert.equal(setup.runs[0]?.scheduledTime, controller.scheduledTime);
  });

  it("does not notify an unpersisted run and isolates rejected observers", async () => {
    const setup = fixture();
    const failures = [new Error("store"), new Error("notify")];
    const observed: unknown[] = [];
    const handler = instrumentScheduled("success", async (..._args: Arguments) => 7, {
      ...setup,
      store: { async record() { throw failures[0]; } },
      async notify() { assert.fail("unpersisted run must not be announced"); },
      async onTelemetryError(error) { observed.push(error); throw new Error("observer"); },
    });
    assert.equal(await handler(controller, env, ctx), 7);
    assert.deepEqual(observed, [failures[0]]);
  });

  it("isolates notification failure after successful persistence", async () => {
    const setup = fixture();
    const failure = new Error("notify unavailable");
    const stages: string[] = [];
    const handler = instrumentScheduled("success", async (..._args: Arguments) => 7, {
      ...setup,
      async notify() { throw failure; },
      onTelemetryError(error, stage) { assert.equal(error, failure); stages.push(stage); },
    });
    assert.equal(await handler(controller, env, ctx), 7);
    assert.equal(setup.runs.length, 1);
    assert.deepEqual(stages, ["notify"]);
  });

  it("uses Worker crypto UUIDs by default and creates separate run records", async () => {
    const setup = fixture();
    const handler = instrumentScheduled("uuid", async (..._args: Arguments) => {}, { store: setup.store });
    await handler(controller, env, ctx);
    await handler(controller, env, ctx);
    assert.equal(setup.runs.length, 2);
    assert.match(setup.runs[0]!.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    assert.notEqual(setup.runs[0]!.id, setup.runs[1]!.id);
  });

  it("isolates clock and ID failures without suppressing business work", async () => {
    const stages: string[] = [];
    let calls = 0;
    const handler = instrumentScheduled("metadata", async (..._args: Arguments) => ++calls, {
      store: { async record() { assert.fail("invalid run must not be persisted"); } },
      now() { throw new Error("clock"); },
      createId() { throw new Error("id"); },
      onTelemetryError(_error, stage) { stages.push(stage); },
    });
    assert.equal(await handler(controller, env, ctx), 1);
    assert.deepEqual(stages, ["clock", "clock", "record"]);
  });
});
