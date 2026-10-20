#!/usr/bin/env node
// Runs the bundled dist CLI when fresh; otherwise executes src via Node's
// native type-stripping so the CLI never silently runs stale output.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "cli.js");
const srcEntry = join(root, "src", "cli.ts");

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function newestSrcMtime() {
  let newest = Math.max(mtime(srcEntry), mtime(join(root, "package.json")));
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.(ts|tsx)$/.test(p)) newest = Math.max(newest, mtime(p));
    }
  };
  walk(join(root, "src"));
  return newest;
}
try {
  const fresh = existsSync(distEntry) && mtime(distEntry) >= newestSrcMtime();
  if (fresh) {
    const { run } = await import("../dist/cli.js");
    process.exitCode = await run(process.argv.slice(2), process.cwd());
  } else {
    // Dev fallback: strip types at runtime instead of rebuilding.
    if (existsSync(distEntry)) {
      console.error("note: dist is stale — running from src (run pnpm build to refresh)");
    }
    const { register } = await import("node:module");
    register("../test/hooks/resolve-ts.mjs", import.meta.url);
    const { run } = await import("../src/cli.ts");
    process.exitCode = await run(process.argv.slice(2), process.cwd());
  }
} catch (e) {
  console.log(
    `error: void-crons failed to start: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 2;
}
