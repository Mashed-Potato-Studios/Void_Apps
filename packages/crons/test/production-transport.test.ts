import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { run } from "../src/cli.ts";
import { isVerifiedProductionEvidence, type CronProductionEvidence } from "../src/evidence.ts";
import { triggerExpression } from "../src/trigger.ts";
import type { CronJob } from "../src/types.ts";

const expression = "0 * * * *";
const job: CronJob = {
  name: "heartbeat",
  path: "crons/heartbeat.ts",
  status: "active",
  expressions: [expression],
  usesDefineScheduled: false,
  sharedExpression: false,
};

function response(status = 200): Response {
  return { ok: status < 400, status } as Response;
}

function evidence(overrides: Partial<CronProductionEvidence> = {}): CronProductionEvidence {
  return {
    format: 1,
    origin: "https://staging.example.com",
    transport: "framework",
    authMode: "framework-internal",
    outcome: "accepted",
    httpStatus: 200,
    verifiedAt: "2026-10-22T20:00:00.000Z",
    expression,
    ...overrides,
  };
}

describe("production transport", () => {
  it("requires explicit remote consent at the library boundary", async () => {
    let calls = 0;
    const result = await triggerExpression(expression, job.name, {
      origin: "https://staging.example.com",
      transport: "framework",
      cronSecret: "internal",
      fetchImpl: async () => { calls += 1; return response(); },
    });
    assert.equal(result.skipped, true);
    assert.match(result.reason ?? "", /allowRemote/);
    assert.equal(calls, 0);
  });

  it("accepts only evidence matching the exact origin and accepted outcome", () => {
    assert.equal(isVerifiedProductionEvidence(evidence()), true);
    assert.equal(isVerifiedProductionEvidence(evidence({ outcome: "rejected", httpStatus: 401 })), false);
    assert.equal(isVerifiedProductionEvidence(evidence({ httpStatus: 500 })), false);
    assert.equal(isVerifiedProductionEvidence(evidence({ outcome: "unknown", httpStatus: 0 })), false);
    assert.equal(isVerifiedProductionEvidence(evidence({ origin: "https://prod.example.com" })), true);
    assert.equal(isVerifiedProductionEvidence(evidence({ origin: "https://prod.example.com" }), "https://staging.example.com"), false);
    assert.equal(isVerifiedProductionEvidence({ ...evidence(), transport: "dev" } as unknown as CronProductionEvidence), false);
  });

  it("refuses mismatched evidence before attaching credentials", async () => {
    let calls = 0;
    const result = await triggerExpression(expression, job.name, {
      origin: "https://staging.example.com",
      transport: "framework",
      allowRemote: true,
      cronSecret: "internal",
      productionEvidence: evidence({ origin: "https://prod.example.com" }),
      fetchImpl: async () => { calls += 1; return response(); },
    });
    assert.equal(result.skipped, true);
    assert.match(result.reason ?? "", /evidence/);
    assert.equal(calls, 0);
  });

  it("verifies a staging target with explicit confirmation and writes sanitized evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-verify-"));
    const originalFetch = globalThis.fetch;
    const originalSecret = process.env.CRON_SECRET;
    const originalLog = console.log;
    const lines: string[] = [];
    try {
      mkdirSync(join(root, "crons"));
      writeFileSync(join(root, "crons", "heartbeat.ts"), `export const cron = '${expression}';\nexport default () => {};`);
      const path = join(root, "void.crons.production.json");
      process.env.CRON_SECRET = "staging-internal-token";
      console.log = (value) => { lines.push(String(value)); };
      globalThis.fetch = (async (url, init) => {
        assert.equal(url, "https://staging.example.com/__void/scheduled");
        assert.equal(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-void-internal"), "staging-internal-token");
        assert.equal(headers.has("x-void-dev-trigger"), false);
        return response(200);
      }) as typeof fetch;

      assert.equal(await run([
        "verify", "--origin", "https://staging.example.com", "--transport", "framework", "--cron", expression,
        "--evidence", path, "--allow-remote", "--confirm-remote-write",
      ], root), 0);
      const stored = JSON.parse(readFileSync(path, "utf8")) as CronProductionEvidence;
      assert.equal(stored.origin, "https://staging.example.com");
      assert.equal(stored.outcome, "accepted");
      assert.equal(stored.httpStatus, 200);
      assert.doesNotMatch(JSON.stringify(stored), /staging-internal-token/);

      assert.equal(await run(["doctor", "--json", "--evidence", path], root), 0);
      const report = JSON.parse(lines.at(-1)!) as { productionTrigger: string };
      assert.equal(report.productionTrigger, "verified");
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      if (originalSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalSecret;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records an unknown transport outcome instead of throwing on missing HTTP status", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-verify-unknown-"));
    const originalFetch = globalThis.fetch;
    const originalSecret = process.env.CRON_SECRET;
    const originalLog = console.log;
    try {
      mkdirSync(join(root, "crons"));
      writeFileSync(join(root, "crons", "heartbeat.ts"), `export const cron = '${expression}';\nexport default () => {};`);
      const path = join(root, "void.crons.production.json");
      process.env.CRON_SECRET = "staging-internal-token";
      console.log = () => {};
      globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
      assert.equal(await run([
        "verify", "--origin", "https://staging.example.com", "--transport", "framework", "--cron", expression,
        "--evidence", path, "--allow-remote", "--confirm-remote-write",
      ], root), 1);
      const stored = JSON.parse(readFileSync(path, "utf8")) as CronProductionEvidence;
      assert.equal(stored.outcome, "unknown");
      assert.equal(stored.httpStatus, 0);
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      if (originalSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalSecret;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not dispatch verification without explicit remote-write confirmation", async () => {
    const root = mkdtempSync(join(tmpdir(), "cron-verify-guard-"));
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    try {
      mkdirSync(join(root, "crons"));
      writeFileSync(join(root, "crons", "heartbeat.ts"), `export const cron = '${expression}';\nexport default () => {};`);
      let calls = 0;
      globalThis.fetch = (async () => { calls += 1; return response(); }) as typeof fetch;
      console.log = () => {};
      assert.equal(await run([
        "verify", "--origin", "https://staging.example.com", "--transport", "framework", "--cron", expression,
        "--evidence", join(root, "evidence.json"), "--allow-remote",
      ], root), 2);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
