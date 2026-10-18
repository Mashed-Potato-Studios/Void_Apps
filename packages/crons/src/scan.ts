import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { CronJob } from "./types.js";

export const CRON_DIR = "crons";
export const CRON_EXTS = [".ts", ".mts", ".js", ".mjs"] as const;

const STRING_EXPORT =
  /export\s+const\s+cron\s*(?::\s*string\s*)?=\s*["']([^"']+)["']/;
const ARRAY_EXPORT =
  /export\s+const\s+cron\s*(?::\s*(?:string\s*\[\]|Array<string>))?\s*=\s*\[([\s\S]*?)\]/;
const QUOTED = /["']([^"']+)["']/g;

/** 5-field cron with `*`, ranges, steps, lists. Void passes it to Cloudflare, so validate shape only. */
const FIELD = /^(?:\*|(?:\*\/\d+)|[0-9,\-*/]+)$/;
export function isCronExpression(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => FIELD.test(p));
}

function parseExpressions(source: string): { expressions: string[]; error?: string } {
  const single = source.match(STRING_EXPORT);
  if (single?.[1] !== undefined) {
    const expr = single[1].trim();
    return isCronExpression(expr)
      ? { expressions: [expr] }
      : { expressions: [], error: `unsupported cron expression: "${expr}" (expected 5-field cron)` };
  }
  const multi = source.match(ARRAY_EXPORT);
  if (multi?.[1] !== undefined) {
    const raw = [...multi[1].matchAll(QUOTED)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
    if (raw.length === 0) return { expressions: [], error: "empty cron array: export at least one expression" };
    const bad = raw.find((e) => !isCronExpression(e));
    if (bad !== undefined) {
      return { expressions: [], error: `unsupported cron expression: "${bad}" (expected 5-field cron)` };
    }
    return { expressions: [...new Set(raw)] };
  }
  if (/export\s+(?:const|let|var)\s+cron\b/.test(source)) {
    return { expressions: [], error: "unsupported cron export: use a string literal or array of string literals" };
  }
  return { expressions: [], error: "missing `export const cron`: Void ignores this file on deploy" };
}

function walk(dir: string, root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    // Void ignores files and directories starting with `_`.
    if (e.startsWith("_")) continue;
    const p = join(dir, e);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(p, root, out);
    } else if (CRON_EXTS.some((x) => p.endsWith(x))) {
      if (p.endsWith(".d.ts")) continue;
      const rel = relative(root, resolve(p)).replace(/\\/g, "/");
      if (rel.startsWith("..") || rel.includes("../")) continue;
      out.push(p);
    }
  }
  return out;
}

export function scanCronFiles(
  appRoot: string,
  opts: { disabled?: Set<string> | string[] } = {},
): CronJob[] {
  const files = walk(join(appRoot, CRON_DIR), appRoot).sort();
  const disabled = new Set(opts.disabled ?? []);
  const jobs: CronJob[] = files.map((abs) => {
    const rel = relative(appRoot, abs).replace(/\\/g, "/");
    const name = basename(abs).replace(/\.(m?ts|m?js)$/, "");
    let source = "";
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      return {
        path: rel,
        name,
        expressions: [],
        status: "invalid",
        error: "unreadable file",
        usesDefineScheduled: false,
        sharedExpression: false,
      } satisfies CronJob;
    }
    const { expressions, error } = parseExpressions(source);
    const usesDefineScheduled = /defineScheduled\s*\(/.test(source);
    if (error !== undefined || expressions.length === 0) {
      return {
        path: rel,
        name,
        expressions: [],
        status: "invalid",
        error,
        usesDefineScheduled,
        sharedExpression: false,
      } satisfies CronJob;
    }
    return {
      path: rel,
      name,
      expressions,
      status: disabled.has(name) || disabled.has(rel) ? "disabled" : "active",
      usesDefineScheduled,
      sharedExpression: false,
    } satisfies CronJob;
  });

  // Jobs sharing one expression each run once per invocation but count
  // once toward the 100-expression platform limit — flag the overlap.
  const counts = new Map<string, number>();
  for (const j of jobs) for (const e of j.expressions) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const j of jobs) {
    if (j.expressions.some((e) => (counts.get(e) ?? 0) > 1)) j.sharedExpression = true;
  }
  return jobs;
}
