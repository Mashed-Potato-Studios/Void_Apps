import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inferBindings, scanAppFiles } from "../src/scan.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-app");

describe("scanAppFiles", () => {
  it("scans default dirs, excludes workflows/ unless passed as extraPaths", () => {
    const base = scanAppFiles(appRoot).map((f) => f.path).sort();
    assert.deepEqual(base, ["middleware/auth.ts", "routes/hello.ts"]);
    const extra = scanAppFiles(appRoot, ["workflows"]).map((f) => f.path).sort();
    assert.deepEqual(extra, ["middleware/auth.ts", "routes/hello.ts", "workflows/extra.ts"]);
  });
  it("emits full 64-char hashes sorted by path", () => {
    const files = scanAppFiles(appRoot);
    assert.ok(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
    assert.deepEqual(files.map((f) => f.path), [...files.map((f) => f.path)].sort());
  });
});

describe("inferBindings", () => {
  it("detects void/* specifiers plus env.DB and env[\"KV\"] forms", () => {
    const b = inferBindings(appRoot, scanAppFiles(appRoot, ["workflows"]));
    assert.deepEqual(b.specifiers, ["void/db"]);
    assert.deepEqual(b.envAccess, ["DB", "KV"]);
  });
});
