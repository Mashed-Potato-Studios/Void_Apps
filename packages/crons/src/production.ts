import { readFileSync, writeFileSync } from "node:fs";
import { isCronProductionEvidence, type CronProductionEvidence } from "./evidence.js";

export function readProductionEvidence(path: string): CronProductionEvidence {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isCronProductionEvidence(parsed)) throw new Error(`invalid production evidence: ${path}`);
  return parsed;
}

export function writeProductionEvidence(path: string, evidence: CronProductionEvidence): void {
  if (!isCronProductionEvidence(evidence)) throw new Error("refusing to write invalid production evidence");
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
}
