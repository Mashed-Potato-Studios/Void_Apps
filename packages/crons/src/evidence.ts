import type { CronProductionEvidence } from "./types.js";

export type { CronProductionEvidence } from "./types.js";

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isCronProductionEvidence(value: unknown): value is CronProductionEvidence {
  if (typeof value !== "object" || value === null) return false;
  const evidence = value as Record<string, unknown>;
  if (evidence["format"] !== 1) return false;
  if (typeof evidence["origin"] !== "string" || canonicalOrigin(evidence["origin"]) !== evidence["origin"]) return false;
  if (evidence["transport"] !== "framework" || evidence["authMode"] !== "framework-internal") return false;
  if (evidence["outcome"] !== "accepted" && evidence["outcome"] !== "rejected" && evidence["outcome"] !== "unknown") return false;
  if (typeof evidence["httpStatus"] !== "number" || !Number.isInteger(evidence["httpStatus"]) || evidence["httpStatus"] < 0 || evidence["httpStatus"] > 599) {
    return false;
  }
  if (typeof evidence["verifiedAt"] !== "string" || !Number.isFinite(new Date(evidence["verifiedAt"]).getTime())) return false;
  if (evidence["expression"] !== undefined && typeof evidence["expression"] !== "string") return false;
  return true;
}

export function isVerifiedProductionEvidence(
  evidence: CronProductionEvidence | undefined,
  origin?: string,
): boolean {
  if (!evidence || !isCronProductionEvidence(evidence) || evidence.outcome !== "accepted") return false;
  if (evidence.httpStatus < 200 || evidence.httpStatus > 299) return false;
  if (origin === undefined) return true;
  const expected = canonicalOrigin(origin);
  return expected !== null && evidence.origin === expected;
}
