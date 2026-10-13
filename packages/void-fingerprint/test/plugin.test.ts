import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintPlugin } from "../src/plugin.ts";

describe("fingerprintPlugin", () => {
  it("is post-ordered, build-applied, and writes .void/fingerprint.json", () => {
    const app = mkdtempSync(join(tmpdir(), "fp-plugin-"));
    mkdirSync(join(app, "routes"), { recursive: true });
    writeFileSync(join(app, "void.json"), JSON.stringify({ target: "cloudflare" }));
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "plugin-app" }));
    writeFileSync(join(app, "vite.config.ts"), "export default { plugins: [] };\n");
    writeFileSync(join(app, "routes/a.ts"), "// a\n");
    const prev = process.cwd();
    process.chdir(app);
    try {
      const p = fingerprintPlugin();
      assert.equal(p.name, "void-fingerprint");
      assert.equal(p.enforce, "post");
      assert.equal(p.apply, "build");
      p.buildStart();
      p.writeBundle();
      assert.equal(existsSync(join(app, ".void/fingerprint.json")), true);
    } finally {
      process.chdir(prev);
      rmSync(app, { recursive: true, force: true });
    }
  });
});
