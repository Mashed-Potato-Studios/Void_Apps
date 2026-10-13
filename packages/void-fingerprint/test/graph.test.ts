import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitManifest } from "../src/emit.ts";
import { buildGraph, writeGraph } from "../src/graph.ts";

function makeApp(root: string, name: string, deps: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "void.json"), JSON.stringify({ target: "cloudflare" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, dependencies: deps }));
  writeFileSync(join(dir, "vite.config.ts"), "export default { plugins: [] };\n");
  writeFileSync(join(dir, "routes/a.ts"), `// ${name}\n`);
  emitManifest(dir);
  return dir;
}

describe("graph", () => {
  it("maps per-app fingerprints and dep ranges from committed manifests", () => {
    const root = join(tmpdir(), `fp-graph-${Date.now()}`);
    const a = makeApp(root, "app-a", { "@void-monorepo/db": "workspace:*" });
    const b = makeApp(root, "app-b", { "@void-monorepo/db": "workspace:*" });
    try {
      const g = buildGraph(root, [a, b]);
      assert.equal(g.format, 1);
      assert.deepEqual(Object.keys(g.apps).sort(), ["app-a", "app-b"]);
      assert.deepEqual(g.apps["app-a"]?.deps, { "@void-monorepo/db": "workspace:*" });
      assert.match(g.apps["app-a"]?.fingerprint ?? "", /^[0-9a-f]{64}$/);
      assert.deepEqual(g.crossApp, []);
      const path = writeGraph(root, [a, b]);
      assert.equal(path, join(root, "fingerprint.graph.json"));
      assert.ok(existsSync(path));
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), g);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("marks apps whose manifests list another app package as crossApp", () => {
    const root = join(tmpdir(), `fp-graph-x-${Date.now()}`);
    const a = makeApp(root, "app-a", {});
    const c = makeApp(root, "app-c", { "app-a": "workspace:*" });
    try {
      const g = buildGraph(root, [a, c]);
      assert.deepEqual(g.crossApp, ["app-c"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("errors naming the app when its committed manifest is missing", () => {
    const root = join(tmpdir(), `fp-graph-m-${Date.now()}`);
    const a = makeApp(root, "app-a", {});
    const ghost = join(root, "ghost");
    mkdirSync(join(ghost, "routes"), { recursive: true });
    try {
      assert.throws(() => buildGraph(root, [a, ghost]), /ghost/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
