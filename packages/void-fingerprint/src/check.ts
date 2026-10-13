import { diffManifest } from "./diff.ts";
import type { EmitOptions } from "./manifest.ts";

export function checkFingerprint(
  appRoot: string,
  opts: EmitOptions = {},
): { clean: boolean; drift: string[] } {
  const d = diffManifest(appRoot, opts);
  const drift = d.changed.map((c) => c.path);
  if (!d.clean && drift.length === 0) drift.push("fingerprint");
  return { clean: d.clean, drift };
}
