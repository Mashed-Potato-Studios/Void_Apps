import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonical } from "../src/canonical.ts";
import { buildManifest } from "../src/manifest.ts";
import { diffManifest } from "../src/diff.ts";
import { checkFingerprint } from "../src/check.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-app");
const baseline = join(appRoot, "void.fingerprint.json");

function writeBaseline(): void {
  writeFileSync(baseline, canonical(buildManifest(appRoot)));
}
function clearBaseline(): void {
  rmSync(baseline, { force: true });
}
function readRoute(): string {
  return readFileSync(join(appRoot, "routes/hello.ts"), "utf8");
}

describe("diffManifest", () => {
  it("reports clean when working tree matches baseline", () => {
    writeBaseline();
    try {
      const d = diffManifest(appRoot);
      assert.equal(d.clean, true);
      assert.deepEqual(d.changed, []);
      assert.equal(d.hash.committed, d.hash.computed);
      assert.equal(d.isNew, false);
    } finally {
      clearBaseline();
    }
  });
  it("names the drifted file with from/to hashes after an edit", () => {
    writeBaseline();
    const orig = readRoute();
    try {
      writeFileSync(join(appRoot, "routes/hello.ts"), orig + "\n// drift\n");
      const d = diffManifest(appRoot);
      assert.equal(d.clean, false);
      assert.equal(d.changed.length, 1);
      assert.equal(d.changed[0].path, "routes/hello.ts");
      assert.match(d.changed[0].from ?? "", /^[0-9a-f]{64}$/);
      assert.match(d.changed[0].to ?? "", /^[0-9a-f]{64}$/);
      assert.notEqual(d.changed[0].from, d.changed[0].to);
      assert.equal(d.changed[0].evidence, "routes/hello.ts");
      assert.notEqual(d.hash.committed, d.hash.computed);
    } finally {
      writeFileSync(join(appRoot, "routes/hello.ts"), orig);
      clearBaseline();
    }
  });
  it("reports config-field drift with source-file evidence", () => {
    writeBaseline();
    const voidJsonPath = join(appRoot, "void.json");
    const orig = readFileSync(voidJsonPath, "utf8");
    try {
      writeFileSync(
        voidJsonPath,
        JSON.stringify({ $schema: "https://void.cloud/schema.json", target: "cloudflare", region: "eu" }),
      );
      const d = diffManifest(appRoot);
      assert.equal(d.clean, false);
      assert.deepEqual(d.changed.map((c) => c.path), ["voidJson"]);
      assert.equal(d.changed[0].evidence, "void.json");
    } finally {
      writeFileSync(voidJsonPath, orig);
      clearBaseline();
    }
  });
  it("reports added binding tokens with file:line evidence", () => {
    writeBaseline();
    const route = join(appRoot, "routes/hello.ts");
    const orig = readRoute();
    try {
      writeFileSync(route, orig + "const t = env.NEWBIND;\n");
      const d = diffManifest(appRoot);
      assert.equal(d.clean, false);
      const token = d.changed.find((c) => c.path === "bindings:NEWBIND");
      assert.ok(token);
      assert.match(token?.evidence ?? "", /^routes\/hello\.ts:\d+$/);
    } finally {
      writeFileSync(route, orig);
      clearBaseline();
    }
  });
  it("treats missing baseline as new, never throws", () => {
    clearBaseline();
    const d = diffManifest(appRoot);
    assert.equal(d.isNew, true);
    assert.equal(d.clean, false);
    assert.deepEqual(
      d.changed.map((c) => c.path),
      ["middleware/auth.ts", "routes/hello.ts"],
    );
    assert.ok(d.changed.every((c) => c.from === null));
    assert.equal(d.hash.committed, null);
  });
});

describe("checkFingerprint", () => {
  it("clean baseline passes, drifted tree fails", () => {
    writeBaseline();
    const orig = readRoute();
    try {
      assert.deepEqual(checkFingerprint(appRoot), { clean: true, drift: [] });
      writeFileSync(join(appRoot, "routes/hello.ts"), orig + "\n// drift\n");
      const c = checkFingerprint(appRoot);
      assert.equal(c.clean, false);
      assert.ok(c.drift.includes("routes/hello.ts"));
    } finally {
      writeFileSync(join(appRoot, "routes/hello.ts"), orig);
      clearBaseline();
    }
  });
});
