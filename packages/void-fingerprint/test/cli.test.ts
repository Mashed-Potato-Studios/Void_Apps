import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";

function makeApp(root: string): string {
  const dir = mkdtempSync(join(root, "cli-app-"));
  mkdirSync(join(dir, "routes"), { recursive: true });
  writeFileSync(join(dir, "void.json"), JSON.stringify({ target: "cloudflare" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "cli-app" }));
  writeFileSync(join(dir, "vite.config.ts"), "export default { plugins: [] };\n");
  writeFileSync(join(dir, "routes/a.ts"), "// a\n");
  return dir;
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (s: string): void => {
    logs.push(String(s));
  };
  try {
    const code = await fn();
    return { code, out: logs.join("\n") };
  } finally {
    console.log = orig;
  }
}

describe("run", () => {
  it("emit then check passes; drift fails with 1; usage errors exit 2", async () => {
    const root = mkdtempSync(join(tmpdir(), "fp-cli-"));
    const app = makeApp(root);
    try {
      assert.equal((await capture(() => run(["emit"], app))).code, 0);
      assert.equal((await capture(() => run([], app))).code, 0); // bare = check, clean
      assert.equal((await capture(() => run(["check", "--ci"], app))).code, 0);
      writeFileSync(join(app, "routes/a.ts"), "// a\n// drift\n");
      assert.equal((await capture(() => run(["check", "--ci"], app))).code, 1);
      const diff = await capture(() => run(["diff", "--json"], app));
      assert.equal(diff.code, 1);
      assert.ok(diff.out.includes('"path":"routes/a.ts"'));
      assert.equal((await capture(() => run(["bogus"], app))).code, 2);
      rmSync(join(app, "void.fingerprint.json"));
      assert.equal((await capture(() => run(["check", "--ci"], app))).code, 2);
      assert.equal((await capture(() => run(["check"], app))).code, 0); // local warning, not error
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("--base compares the tree against the manifest at a git ref", async () => {
    const root = mkdtempSync(join(tmpdir(), "fp-cli-base-"));
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", root, "config", "user.name", "t"]);
    const app = makeApp(root);
    try {
      assert.equal((await capture(() => run(["emit"], app))).code, 0);
      execFileSync("git", ["-C", root, "add", "."]);
      execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
      writeFileSync(join(app, "routes/a.ts"), "// a\n// drift\n");
      assert.equal((await capture(() => run(["diff", "--base", "HEAD"], app))).code, 1);
      assert.equal((await capture(() => run(["diff", "--base", "no-such-ref"], app))).code, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("malformed void.json is a tool error, and graph --format mermaid prints a diagram", async () => {
    const root = mkdtempSync(join(tmpdir(), "fp-cli-misc-"));
    const app = makeApp(root);
    try {
      assert.equal((await capture(() => run(["emit"], app))).code, 0);
      writeFileSync(join(app, "void.json"), "{broken");
      assert.equal((await capture(() => run(["check"], app))).code, 2);
      writeFileSync(join(app, "void.json"), JSON.stringify({ target: "cloudflare" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    const mono = mkdtempSync(join(tmpdir(), "fp-cli-graph-"));
    try {
      const a = join(mono, "apps", "demo");
      mkdirSync(join(a, "routes"), { recursive: true });
      writeFileSync(join(a, "void.json"), JSON.stringify({ target: "cloudflare" }));
      writeFileSync(
        join(a, "package.json"),
        JSON.stringify({ name: "demo", dependencies: { "@void-monorepo/db": "workspace:*" } }),
      );
      writeFileSync(join(a, "vite.config.ts"), "export default { plugins: [] };\n");
      writeFileSync(join(a, "routes/a.ts"), "// a\n");
      assert.equal((await capture(() => run(["emit", "--all"], mono))).code, 0);
      const g = await capture(() => run(["graph", "--all", "--format", "mermaid"], mono));
      assert.equal(g.code, 0);
      assert.ok(g.out.includes("graph TD"));
      assert.ok(g.out.includes("fingerprint.graph.json"));
    } finally {
      rmSync(mono, { recursive: true, force: true });
    }
  });
});
