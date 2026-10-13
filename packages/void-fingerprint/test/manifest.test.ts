import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildManifest } from "../src/manifest.ts";
import { emitManifest } from "../src/emit.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-app");

describe("buildManifest", () => {
  it("assembles full manifest with format 1 and verifiable fingerprint", () => {
    const m = buildManifest(appRoot, { extraPaths: ["workflows"] });
    assert.equal(m.format, 1);
    assert.equal(m.app, "demo-app");
    assert.equal(m.target, "cloudflare");
    assert.deepEqual(m.routes, ["routes/hello.ts"]);
    assert.deepEqual(m.pages, []);
    assert.deepEqual(m.middleware, ["middleware/auth.ts"]);
    assert.deepEqual(m.bindings.specifiers, ["void/db"]);
    assert.deepEqual(m.workspaceDeps, { "workspace-dep": "workspace:*" });
    assert.deepEqual(m.plugins, ["voidPlugin", "customPlugin"]);
    assert.equal(m.drizzle, null);
    const { fingerprint } = m;
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
  });
});

describe("emitManifest", () => {
  it("writes void.fingerprint.json round-tripping buildManifest", () => {
    const { path } = emitManifest(appRoot, { extraPaths: ["workflows"] });
    assert.equal(path, join(appRoot, "void.fingerprint.json"));
    assert.ok(existsSync(path));
    const disk = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(disk, buildManifest(appRoot, { extraPaths: ["workflows"] }));
    rmSync(path);
  });
});
