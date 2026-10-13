import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value)) + "\n";
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hashFile(path: string): string {
  const raw = readFileSync(path);
  const text = raw.toString("utf8");
  return sha256Hex(text.replace(/\r\n?/g, "\n"));
}
