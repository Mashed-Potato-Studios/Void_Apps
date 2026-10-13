import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const bad = [];
for (const f of readdirSync(dist)) {
  if (!f.endsWith(".d.ts")) continue;
  const s = readFileSync(join(dist, f), "utf8");
  if (/from\s+["']\.[^"']*\.ts["']/.test(s)) bad.push(f);
}
if (bad.length > 0) {
  console.error(`assert-dts: unresolvable .ts specifiers in d.ts: ${bad.join(", ")}`);
  process.exit(1);
}
