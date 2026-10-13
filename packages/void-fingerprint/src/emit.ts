import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "./canonical.ts";
import { buildManifest, type EmitOptions, type Manifest } from "./manifest.ts";

export function emitManifest(
  appRoot: string,
  opts: EmitOptions = {},
): { manifest: Manifest; path: string } {
  const manifest = buildManifest(appRoot, opts);
  const path = join(appRoot, "void.fingerprint.json");
  writeFileSync(path, canonical(manifest));
  return { manifest, path };
}
