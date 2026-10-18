#!/usr/bin/env node
try {
  const { run } = await import("../dist/cli.js");
  process.exitCode = await run(process.argv.slice(2), process.cwd());
} catch (e) {
  console.log(
    `error: @void-monorepo/crons is not built (run pnpm --filter @void-monorepo/crons build): ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 2;
}
