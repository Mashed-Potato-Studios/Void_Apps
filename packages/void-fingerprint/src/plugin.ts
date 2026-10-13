import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { canonical } from "./canonical.js";
import { buildManifest, optsForApp, type EmitOptions } from "./manifest.js";

export type FingerprintPluginOptions = EmitOptions & { root?: string };

export function fingerprintPlugin(opts: FingerprintPluginOptions = {}): Plugin & {
  enforce: "post";
  apply: "build";
  configResolved(config: { root: string }): void;
  buildStart(): void;
  writeBundle(): void;
} {
  let root = opts.root ?? process.cwd();
  return {
    name: "void-fingerprint",
    enforce: "post",
    apply: "build",
    configResolved(config: { root: string }) {
      if (!opts.root) root = config.root;
    },
    buildStart() {},
    writeBundle() {
      const appRoot = root;
      const { root: _root, ...emitOpts } = opts;
      void _root;
      const merged = { ...optsForApp(appRoot), ...emitOpts };
      const manifest = buildManifest(appRoot, merged);
      mkdirSync(join(appRoot, ".void"), { recursive: true });
      writeFileSync(join(appRoot, ".void/fingerprint.json"), canonical(manifest));
    },
  };
}
