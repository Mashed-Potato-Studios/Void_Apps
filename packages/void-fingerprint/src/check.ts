import { diffManifest } from "./diff.js";
import type { DiffResult } from "./diff.js";
import type { EmitOptions } from "./manifest.js";

export function checkDiffResult(d: DiffResult): { clean: boolean; drift: string[] } {
  const drift = d.changed.map((c) => c.path);
  if (!d.clean && drift.length === 0) drift.push("fingerprint");
  return { clean: d.clean, drift };
}

export function checkFingerprint(
  appRoot: string,
  opts: EmitOptions = {},
): { clean: boolean; drift: string[] } {
  return checkDiffResult(diffManifest(appRoot, opts));
}
