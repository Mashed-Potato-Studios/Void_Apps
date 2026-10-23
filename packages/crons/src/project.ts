import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { isVerifiedProductionEvidence, type CronProductionEvidence } from "./evidence.js";

const CONFIG_FILES = ["void.config.ts", "void.config.mts", "void.config.js", "void.config.mjs", "void.json"];

export function findVoidConfig(appRoot: string): string | undefined {
  return CONFIG_FILES.find((file) => existsSync(join(appRoot, file)));
}

export interface InspectProjectOptions {
  productionEvidence?: CronProductionEvidence;
}

export function inspectProject(appRoot: string, options: InspectProjectOptions = {}) {
  let sdkVersion: string | null = null;
  try {
    const require = createRequire(join(appRoot, "package.json"));
    let directory = dirname(require.resolve("void"));
    while (directory !== parse(directory).root) {
      const manifestPath = join(directory, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.name === "void") {
          sdkVersion = typeof manifest.version === "string" ? manifest.version : null;
          break;
        }
      }
      directory = dirname(directory);
    }
  } catch {
    sdkVersion = null;
  }
  const evidence = options.productionEvidence;
  const productionTrigger = !evidence
    ? "unknown"
    : isVerifiedProductionEvidence(evidence)
      ? "verified"
      : evidence.outcome === "unknown"
        ? "unknown"
        : "rejected";
  return {
    config: findVoidConfig(appRoot) ?? null,
    sdkVersion,
    sdkContract: sdkVersion?.startsWith("1.") ? "void-1.x" : "unverified",
    bindingMode: "unknown",
    productionTrigger,
    productionTarget: evidence?.origin ?? null,
    manifestRole: "local-inspection",
  };
}
