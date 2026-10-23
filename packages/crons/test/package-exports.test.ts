import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const packageRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  files: string[];
  exports: Record<string, string>;
  publishConfig: { exports: Record<string, string> };
};

describe("packed package surface", () => {
  it("keeps every source export and publish target for the adapters", () => {
    const expected = ["./d1", "./queue", "./durable", "./live", "./evidence", "./production", "./runtime"];
    for (const entry of expected) {
      assert.equal(typeof manifest.exports[entry], "string", `${entry} source export`);
      assert.equal(typeof manifest.publishConfig.exports[entry], "string", `${entry} publish export`);
      assert.match(manifest.publishConfig.exports[entry]!, /^\.\/dist\/.+\.js$/, `${entry} publish target`);
      assert.equal(existsSync(new URL(manifest.exports[entry]!.replace("./", "../"), import.meta.url)), true, `${entry} source file`);
    }
  });

  it("ships the D1 migration and runtime build output", () => {
    assert.ok(manifest.files.includes("dist"));
    assert.ok(manifest.files.includes("migrations"));
    assert.equal(existsSync(new URL("../migrations/0001_cron_runs.sql", import.meta.url)), true);
    assert.match(readFileSync(new URL("../migrations/0001_cron_runs.sql", import.meta.url), "utf8"), /CREATE TABLE IF NOT EXISTS cron_runs/);
    assert.ok(packageRoot.pathname.endsWith("/crons/"));
  });
});
