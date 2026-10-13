import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hashFile } from "../src/canonical.ts";
import { buildManifest, optsForApp } from "../src/manifest.ts";
import { diffManifest } from "../src/diff.ts";
import { scanAppFiles } from "../src/scan.ts";
import { fingerprintPlugin } from "../src/plugin.ts";

function makeApp(extra: Record<string, string> = {}): string {
  const app = mkdtempSync(join(tmpdir(), "fp-harden-"));
  mkdirSync(join(app, "routes"), { recursive: true });
  writeFileSync(join(app, "void.json"), JSON.stringify({ target: "cloudflare" }));
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "harden-app" }));
  writeFileSync(join(app, "routes/a.ts"), "// a\n");
  for (const [p, content] of Object.entries(extra)) {
    mkdirSync(join(app, dirname(p)), { recursive: true });
    writeFileSync(join(app, p), content);
  }
  return app;
}

function dirname(p: string): string {
  return p.split("/").slice(0, -1).join("/") || ".";
}

describe("hardening", () => {
  it("hashFile normalizes CRLF and lone CR to LF", () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-hash-"));
    try {
      const lf = join(dir, "lf.ts");
      const crlf = join(dir, "crlf.ts");
      const cr = join(dir, "cr.ts");
      writeFileSync(lf, "a\nb\n");
      writeFileSync(crlf, "a\r\nb\r\n");
      writeFileSync(cr, "a\rb\r");
      assert.equal(hashFile(crlf), hashFile(lf));
      assert.equal(hashFile(cr), hashFile(lf));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scanAppFiles skips symlink cycles and escaping links", () => {
    const app = makeApp();
    try {
      // symlink cycle: routes/loop -> app root (must not hang or escape)
      symlinkSync(app, join(app, "routes", "loop"), "dir");
      const files = scanAppFiles(app);
      assert.deepEqual(files.map((f) => f.path), ["routes/a.ts"]);
      for (const f of files) assert.ok(!f.path.startsWith("..") && !f.path.includes("../"));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("diffManifest rejects format-mismatched and corrupt baselines", () => {
    const app = makeApp();
    try {
      writeFileSync(
        join(app, "void.fingerprint.json"),
        canonical({ ...buildManifest(app), format: 999 }),
      );
      assert.throws(() => diffManifest(app), /unsupported manifest format/);
      writeFileSync(join(app, "void.fingerprint.json"), JSON.stringify({ format: 1 }));
      assert.throws(() => diffManifest(app), /corrupt.*re-run fp:emit/);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("extraPaths drift is attributed, not silent", () => {
    const app = makeApp({ "workflows/w.ts": "// w\n" });
    try {
      writeFileSync(join(app, "void.fingerprint.json"), canonical(buildManifest(app)));
      const d = diffManifest(app, { extraPaths: ["workflows"] });
      assert.equal(d.clean, false);
      const entry = d.changed.find((c) => c.path === "extraPaths");
      assert.ok(entry, "expected extraPaths drift entry");
      assert.equal(entry?.evidence, "fingerprint opts");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("plugin and CLI agree on per-app extraPaths via shared optsForApp", () => {
    const app = mkdtempSync(join(tmpdir(), "fp-parity-"));
    try {
      mkdirSync(join(app, "routes"), { recursive: true });
      mkdirSync(join(app, "workflows"), { recursive: true });
      writeFileSync(join(app, "void.json"), JSON.stringify({ target: "cloudflare" }));
      writeFileSync(join(app, "package.json"), JSON.stringify({ name: "@void-monorepo/api" }));
      writeFileSync(join(app, "routes/a.ts"), "// a\n");
      writeFileSync(join(app, "workflows/w.ts"), "// w\n");
      const p = fingerprintPlugin();
      p.configResolved({ root: app });
      p.writeBundle();
      const snap = JSON.parse(readFileSync(join(app, ".void/fingerprint.json"), "utf8"));
      const cliManifest = buildManifest(app, optsForApp(app));
      assert.deepEqual(snap.files, cliManifest.files);
      assert.ok(snap.files.some((f: { path: string }) => f.path === "workflows/w.ts"));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
