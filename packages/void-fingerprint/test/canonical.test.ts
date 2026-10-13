import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hashFile, sha256Hex } from "../src/canonical.ts";

describe("canonical", () => {
  it("sorts keys recursively with trailing LF", () => {
    assert.equal(canonical({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}\n');
  });
  it("sha256Hex is 64 hex chars", () => {
    assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
  });
  it("hashFile normalizes CRLF to LF", () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-"));
    const a = join(dir, "a.ts");
    const b = join(dir, "b.ts");
    writeFileSync(a, "line1\r\nline2\r\n");
    writeFileSync(b, "line1\nline2\n");
    assert.equal(hashFile(a), hashFile(b));
    assert.match(hashFile(a), /^[0-9a-f]{64}$/);
  });
});
