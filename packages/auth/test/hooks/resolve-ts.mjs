// Node type-stripping runs tests directly against src/*.ts, but sources use
// NodeNext `.js` specifiers (required so built dist/*.d.ts resolves). This
// hook maps a missing `./x.js` sibling to the existing `./x.ts` during tests.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    typeof specifier === "string" &&
    specifier.endsWith(".js") &&
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    try {
      const parentPath = fileURLToPath(context.parentURL);
      const target = resolvePath(dirname(parentPath), specifier);
      const tsTarget = target.replace(/\.js$/, ".ts");
      if (!existsSync(target) && existsSync(tsTarget)) {
        return { url: pathToFileURL(tsTarget).href, shortCircuit: true };
      }
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context);
}
