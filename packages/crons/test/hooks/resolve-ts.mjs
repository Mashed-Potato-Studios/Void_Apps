// Node type-stripping runs tests directly against src/*.ts, but sources use
// NodeNext `.js` specifiers. This hook maps a missing `./x.js` sibling
// to the existing `./x.ts` (or `./x.tsx`) during tests.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    typeof specifier === "string" &&
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    try {
      const parentPath = fileURLToPath(context.parentURL);
      const target = resolvePath(dirname(parentPath), specifier);
      if (!existsSync(target)) {
        if (target.endsWith(".js")) {
          const base = target.replace(/\.js$/, "");
          for (const ext of [".ts", ".tsx"]) {
            if (existsSync(base + ext)) {
              return { url: pathToFileURL(base + ext).href, shortCircuit: true };
            }
          }
        }
        for (const ext of [".ts", ".tsx"]) {
          if (existsSync(target + ext)) {
            return { url: pathToFileURL(target + ext).href, shortCircuit: true };
          }
        }
        const indexTs = resolvePath(target, "index.ts");
        if (existsSync(indexTs)) {
          return { url: pathToFileURL(indexTs).href, shortCircuit: true };
        }
      }
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context);
}
