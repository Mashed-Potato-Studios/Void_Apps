import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { canonical } from "./canonical.ts";
import { buildManifest, type EmitOptions } from "./manifest.ts";

export function fingerprintPlugin(opts: EmitOptions = {}): Plugin & {
  enforce: "post";
  apply: "build";
  buildStart(): void;
  writeBundle(): void;
} {
  return {
    name: "void-fingerprint",
    enforce: "post",
    apply: "build",
    buildStart() {},
    writeBundle() {
      const appRoot = process.cwd();
      const manifest = buildManifest(appRoot, opts);
      mkdirSync(join(appRoot, ".void"), { recursive: true });
      writeFileSync(join(appRoot, ".void/fingerprint.json"), canonical(manifest));
    },
  };
}
