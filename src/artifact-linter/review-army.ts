import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import {
  extractH2Sections,
  normalizeHeadingTitle,
  sectionBodyByName,
  type H2SectionMap
} from "./shared.js";

interface ResolvedArtifactPath {
  absPath: string;
  relPath: string;
}

async function resolveNamedArtifactPath(projectRoot: string, fileName: string): Promise<ResolvedArtifactPath> {
  const relPath = path.join(RUNTIME_ROOT, "artifacts", fileName);
  const absPath = path.join(projectRoot, relPath);
  return { absPath, relPath };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

export async function validateReviewArmy(
  projectRoot: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const { absPath, relPath } = await resolveNamedArtifactPath(projectRoot, "07-review-army.json");

  if (!(await exists(absPath))) {
    return { valid: false, errors: [`Missing file: ${relPath}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(absPath, "utf8")) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, errors: [`Invalid JSON: ${msg}`] };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, errors: ["Root value must be a JSON object."] };
  }

  const root = parsed as Record<string, unknown>;

  if (!("version" in root) || !isFiniteNumber(root.version) || root.version < 1) {
    errors.push('Field "version" must be a finite number >= 1.');
  }
  if (!isNonEmptyString(root.generatedAt)) {
    errors.push('Field "generatedAt" must be a non-empty string.');
  }

  if (!("scope" in root) || root.scope === null || typeof root.scope !== "object" || Array.isArray(root.scope)) {
    errors.push('Field "scope" must be an object.');
  } else {
    const scope = root.scope as Record<string, unknown>;
    if (!isNonEmptyString(scope.base)) {
      errors.push("scope.base must be a non-empty string.");
    }
    if (!isNonEmptyString(scope.head)) {
      errors.push("scope.head must be a non-empty string.");
    }
    if (!isStringArray(scope.files)) {
      errors.push("scope.files must be an array of strings.");
    }
  }

  const severitySet = new Set(["Critical", "Important", "Suggestion"]);
  const statusSet = new Set(["open", "accepted", "resolved"]);
  const sourceSet = new Set([
    "spec",
    "correctness",
    "security",
    "performance",
    "architecture",
    "external-safety"
  ]);
  const findingIds = new Set<string>();
  const openCriticalIds = new Set<string>();

  if (!Array.isArray(root.findings)) {
    errors.push('Field "findings" must be an array.');
  } else {
    root.findings.forEach((f, i) => {
      if (f === null || typeof f !== "object" || Array.isArray(f)) {
        errors.push(`findings[${i}] must be an object.`);
        return;
      }
      const o = f as Record<string, unknown>;
      if (!isNonEmptyString(o.id)) {
        errors.push(`findings[${i}].id must be a non-empty string.`);
      } else if (findingIds.has(o.id)) {
        errors.push(`findings[${i}].id must be unique.`);
      } else {
        findingIds.add(o.id);
      }
      if (!isNonEmptyString(o.severity) || !severitySet.has(o.severity)) {
        errors.push(`findings[${i}].severity must be one of: Critical, Important, Suggestion.`);
      }
      if (!isNonEmptyString(o.status) || !statusSet.has(o.status)) {
        errors.push(`findings[${i}].status must be one of: open, accepted, resolved.`);
      }
      if (!isNonEmptyString(o.fingerprint)) {
        errors.push(`findings[${i}].fingerprint must be a non-empty string.`);
      }
      if (!isFiniteNumber(o.confidence) || o.confidence < 1 || o.confidence > 10) {
        errors.push(`findings[${i}].confidence must be a number in [1,10].`);
      }
      if (!isStringArray(o.reportedBy) || o.reportedBy.length === 0) {
        errors.push(`findings[${i}].reportedBy must be a non-empty string array.`);
      }
      if (o.sources !== undefined) {
        if (!isStringArray(o.sources) || o.sources.length === 0) {
          errors.push(`findings[${i}].sources must be a non-empty string array when present.`);
        } else {
          const invalidSources = o.sources.filter((source) => !sourceSet.has(source));
          if (invalidSources.length > 0) {
            errors.push(
              `findings[${i}].sources contains unknown values: ${invalidSources.join(", ")}.`
            );
          }
        }
      }
      if (o.location === undefined || o.location === null) {
        errors.push(`findings[${i}].location is required and must be an object with file + line.`);
      } else if (typeof o.location !== "object" || Array.isArray(o.location)) {
        errors.push(`findings[${i}].location must be an object with file + line.`);
      } else {
        const loc = o.location as Record<string, unknown>;
        if (!isNonEmptyString(loc.file)) {
          errors.push(`findings[${i}].location.file must be a non-empty string.`);
        }
        if (!isFiniteNumber(loc.line) || loc.line < 1) {
          errors.push(`findings[${i}].location.line must be a positive number.`);
        }
      }
      if (o.recommendation !== undefined && !isNonEmptyString(o.recommendation)) {
        errors.push(`findings[${i}].recommendation must be a non-empty string when present.`);
      }
      if (o.severity === "Critical" && o.status === "open" && !isNonEmptyString(o.recommendation)) {
        errors.push(`findings[${i}] open Critical finding must include recommendation.`);
      }
      if (o.id && o.severity === "Critical" && o.status === "open" && typeof o.id === "string") {
        openCriticalIds.add(o.id);
      }
    });
  }

  if (!("reconciliation" in root) || root.reconciliation === null || typeof root.reconciliation !== "object") {
    errors.push('Field "reconciliation" must be an object.');
  } else {
    const rec = root.reconciliation as Record<string, unknown>;
    if (!isNonNegativeInteger(rec.duplicatesCollapsed)) {
      errors.push("reconciliation.duplicatesCollapsed must be a non-negative integer.");
    }
    if (!Array.isArray(rec.conflicts)) {
      errors.push("reconciliation.conflicts must be an array.");
    } else {
      (rec.conflicts as unknown[]).forEach((c, ci) => {
        if (c === null || typeof c !== "object" || Array.isArray(c)) {
          errors.push(`reconciliation.conflicts[${ci}] must be an object.`);
          return;
        }
        const co = c as Record<string, unknown>;
        if (!isNonEmptyString(co.findingId)) {
          errors.push(`reconciliation.conflicts[${ci}].findingId must be a non-empty string.`);
        } else if (!findingIds.has(co.findingId)) {
          errors.push(`reconciliation.conflicts[${ci}].findingId references unknown finding "${co.findingId}".`);
        }
        if (!isNonEmptyString(co.description)) {
          errors.push(`reconciliation.conflicts[${ci}].description must be a non-empty string.`);
        }
      });
    }
    if (!isStringArray(rec.multiSpecialistConfirmed)) {
      errors.push("reconciliation.multiSpecialistConfirmed must be an array of finding ids.");
    } else {
      for (const msId of rec.multiSpecialistConfirmed) {
        if (!findingIds.has(msId)) {
          errors.push(`reconciliation.multiSpecialistConfirmed references unknown finding id "${msId}".`);
          continue;
        }
        if (Array.isArray(root.findings)) {
          const finding = root.findings.find((f) => {
            return f && typeof f === "object" && !Array.isArray(f) && (f as Record<string, unknown>).id === msId;
          });
          if (finding && typeof finding === "object" && !Array.isArray(finding)) {
            const reportedBy = (finding as Record<string, unknown>).reportedBy;
            const count = Array.isArray(reportedBy)
              ? new Set((reportedBy as unknown[]).filter((v) => typeof v === "string")).size
              : 0;
            if (count < 2) {
              errors.push(
                `reconciliation.multiSpecialistConfirmed entry "${msId}" must be confirmed by at least 2 distinct reviewers (found ${count}).`
              );
            }
          }
        }
      }
    }
    if (!isStringArray(rec.shipBlockers)) {
      errors.push("reconciliation.shipBlockers must be an array of finding ids.");
    } else {
      const blockers = new Set(rec.shipBlockers);
      for (const id of rec.shipBlockers) {
        if (!findingIds.has(id)) {
          errors.push(`reconciliation.shipBlockers references unknown finding id "${id}".`);
        }
      }
      for (const criticalId of openCriticalIds) {
        if (!blockers.has(criticalId)) {
          errors.push(`reconciliation.shipBlockers must include open Critical finding "${criticalId}".`);
        }
      }
    }

    if (isStringArray(rec.multiSpecialistConfirmed)) {
      for (const id of rec.multiSpecialistConfirmed) {
        if (!findingIds.has(id)) {
          errors.push(`reconciliation.multiSpecialistConfirmed references unknown finding id "${id}".`);
        }
      }
    }
    if (rec.layerCoverage !== undefined) {
      if (rec.layerCoverage === null || typeof rec.layerCoverage !== "object" || Array.isArray(rec.layerCoverage)) {
        errors.push("reconciliation.layerCoverage must be an object when present.");
      } else {
        const coverage = rec.layerCoverage as Record<string, unknown>;
        for (const source of sourceSet) {
          if (coverage[source] !== undefined && typeof coverage[source] !== "boolean") {
            errors.push(`reconciliation.layerCoverage.${source} must be boolean when present.`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export interface ReviewVerdictConsistencyResult {
  ok: boolean;
  errors: string[];
  finalVerdict: "APPROVED" | "APPROVED_WITH_CONCERNS" | "BLOCKED" | "UNKNOWN";
  openCriticalCount: number;
  shipBlockerCount: number;
}

export interface ReviewSecurityNoChangeAttestationResult {
  ok: boolean;
  errors: string[];
  hasSecurityFinding: boolean;
  hasNoChangeAttestation: boolean;
}

/**
 * Ensure the narrative verdict in 07-review.md is consistent with the
 * structured review-army reconciliation. A review cannot declare
 * APPROVED while open Critical findings or shipBlockers remain.
 */
export async function checkReviewVerdictConsistency(
  projectRoot: string
): Promise<ReviewVerdictConsistencyResult> {
  const errors: string[] = [];
  const reviewMdPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "07-review.md");
  const armyJsonPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "07-review-army.json");

  let finalVerdict: ReviewVerdictConsistencyResult["finalVerdict"] = "UNKNOWN";
  if (await exists(reviewMdPath)) {
    const raw = await fs.readFile(reviewMdPath, "utf8");
    const sections = extractH2Sections(raw);
    const verdictBody = sectionBodyByName(sections, "Final Verdict");
    if (verdictBody) {
      const chosen: Array<ReviewVerdictConsistencyResult["finalVerdict"]> = [];
      for (const token of ["APPROVED_WITH_CONCERNS", "APPROVED", "BLOCKED"] as const) {
        const regex = new RegExp(`\\b${token}\\b`, "u");
        if (regex.test(verdictBody)) {
          // APPROVED would match inside APPROVED_WITH_CONCERNS; prefer the longer match first.
          if (token === "APPROVED" && /\bAPPROVED_WITH_CONCERNS\b/u.test(verdictBody)) continue;
          chosen.push(token);
        }
      }
      if (chosen.length === 1) {
        finalVerdict = chosen[0]!;
      } else if (chosen.length > 1) {
        errors.push(
          `Final Verdict section lists multiple verdict tokens (${chosen.join(", ")}). Select exactly one.`
        );
      } else {
        errors.push('Final Verdict section does not select APPROVED, APPROVED_WITH_CONCERNS, or BLOCKED.');
      }
    } else {
      errors.push('07-review.md is missing the "## Final Verdict" section.');
    }
  }

  let openCriticalCount = 0;
  let shipBlockerCount = 0;
  if (await exists(armyJsonPath)) {
    try {
      const raw = await fs.readFile(armyJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      for (const f of findings) {
        if (!f || typeof f !== "object" || Array.isArray(f)) continue;
        const o = f as Record<string, unknown>;
        if (o.severity === "Critical" && o.status === "open") {
          openCriticalCount++;
        }
      }
      const rec = parsed.reconciliation && typeof parsed.reconciliation === "object" && !Array.isArray(parsed.reconciliation)
        ? (parsed.reconciliation as Record<string, unknown>)
        : null;
      if (rec && Array.isArray(rec.shipBlockers)) {
        shipBlockerCount = (rec.shipBlockers as unknown[]).filter((v) => typeof v === "string").length;
      }
    } catch {
      // JSON validity is the concern of validateReviewArmy; skip silently here.
    }
  }

  if (finalVerdict === "APPROVED" && (openCriticalCount > 0 || shipBlockerCount > 0)) {
    errors.push(
      `Final Verdict is APPROVED but review-army has ${openCriticalCount} open Critical finding(s) and ${shipBlockerCount} shipBlocker(s). Use BLOCKED or APPROVED_WITH_CONCERNS.`
    );
  }
  // APPROVED_WITH_CONCERNS is intended for Important/Suggestion findings
  // the author has accepted. An *open* Critical finding or an active
  // shipBlocker must route through BLOCKED (review_verdict_blocked gate)
  // rather than pass as a concession — previously this slipped through.
  if (
    finalVerdict === "APPROVED_WITH_CONCERNS" &&
    (openCriticalCount > 0 || shipBlockerCount > 0)
  ) {
    errors.push(
      `Final Verdict is APPROVED_WITH_CONCERNS but review-army has ${openCriticalCount} open Critical finding(s) and ${shipBlockerCount} shipBlocker(s). Resolve them or use BLOCKED.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    finalVerdict,
    openCriticalCount,
    shipBlockerCount
  };
}

export interface ReviewTddDuplicationConflict {
  findingId: string;
  tddSeverity: string | null;
  reviewSeverity: string | null;
  tddDisposition: string | null;
  reviewDisposition: string | null;
}

export interface ReviewTddDuplicationResult {
  ok: boolean;
  errors: string[];
  conflicts: ReviewTddDuplicationConflict[];
  tddArtifactExists: boolean;
  reviewArtifactExists: boolean;
}

const FINDING_ID_PATTERN = /\bF-\d+\b/giu;
const SEVERITY_TOKENS = ["Critical", "Important", "Suggestion"];
const DISPOSITION_TOKENS = ["open", "accepted", "resolved", "deferred", "won't-fix", "wont-fix"];

function findFirstToken(text: string, tokens: string[]): string | null {
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "iu");
    if (regex.test(text)) return token;
  }
  return null;
}

function normalizeDisposition(value: string | null): string | null {
  if (value === null) return null;
  const lower = value.toLowerCase();
  if (lower === "wont-fix" || lower === "won't-fix") return "won't-fix";
  return lower;
}

interface TddFindingRow {
  id: string;
  severity: string | null;
  disposition: string | null;
}

function extractTddPerSliceFindings(perSliceBody: string): Map<string, TddFindingRow> {
  const rows = new Map<string, TddFindingRow>();
  const lines = perSliceBody.split(/\r?\n/u);
  for (const line of lines) {
    const ids = line.match(FINDING_ID_PATTERN);
    if (!ids || ids.length === 0) continue;
    const severity = findFirstToken(line, SEVERITY_TOKENS);
    const disposition = normalizeDisposition(findFirstToken(line, DISPOSITION_TOKENS));
    for (const rawId of ids) {
      const id = rawId.toUpperCase();
      if (rows.has(id)) continue;
      rows.set(id, { id, severity, disposition });
    }
  }
  return rows;
}

/**
 * Cross-artifact duplication guard.
 *
 * When the same finding ID (`F-NN`) appears in both
 * `06-tdd.md > Per-Slice Review` and `07-review-army.json`, the
 * severity and disposition MUST match. Per-slice tdd reviews own
 * single-slice findings; review cites them, never re-classifies.
 *
 * If neither artifact uses `F-NN` IDs, the check is a no-op.
 */
export async function checkReviewTddNoCrossArtifactDuplication(
  projectRoot: string
): Promise<ReviewTddDuplicationResult> {
  const tddPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "06-tdd.md");
  const armyPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "07-review-army.json");

  const tddArtifactExists = await exists(tddPath);
  const reviewArtifactExists = await exists(armyPath);
  if (!tddArtifactExists || !reviewArtifactExists) {
    return {
      ok: true,
      errors: [],
      conflicts: [],
      tddArtifactExists,
      reviewArtifactExists
    };
  }

  const tddRaw = await fs.readFile(tddPath, "utf8");
  const tddSections = extractH2Sections(tddRaw);
  const perSliceBody = sectionBodyByName(tddSections, "Per-Slice Review");
  if (!perSliceBody) {
    return {
      ok: true,
      errors: [],
      conflicts: [],
      tddArtifactExists,
      reviewArtifactExists
    };
  }

  const tddFindings = extractTddPerSliceFindings(perSliceBody);
  if (tddFindings.size === 0) {
    return {
      ok: true,
      errors: [],
      conflicts: [],
      tddArtifactExists,
      reviewArtifactExists
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(armyPath, "utf8"));
  } catch {
    return {
      ok: true,
      errors: [],
      conflicts: [],
      tddArtifactExists,
      reviewArtifactExists
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: true,
      errors: [],
      conflicts: [],
      tddArtifactExists,
      reviewArtifactExists
    };
  }
  const root = parsed as Record<string, unknown>;
  const findings = Array.isArray(root.findings) ? (root.findings as unknown[]) : [];

  const conflicts: ReviewTddDuplicationConflict[] = [];
  for (const f of findings) {
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    const o = f as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    const id = o.id.toUpperCase();
    const tddRow = tddFindings.get(id);
    if (!tddRow) continue;
    const reviewSeverity = typeof o.severity === "string" ? o.severity : null;
    const reviewDisposition = normalizeDisposition(typeof o.status === "string" ? o.status : null);
    const severityMismatch =
      tddRow.severity !== null &&
      reviewSeverity !== null &&
      tddRow.severity.toLowerCase() !== reviewSeverity.toLowerCase();
    const dispositionMismatch =
      tddRow.disposition !== null &&
      reviewDisposition !== null &&
      tddRow.disposition !== reviewDisposition;
    if (severityMismatch || dispositionMismatch) {
      conflicts.push({
        findingId: id,
        tddSeverity: tddRow.severity,
        reviewSeverity,
        tddDisposition: tddRow.disposition,
        reviewDisposition
      });
    }
  }

  const errors = conflicts.map((c) => {
    const parts: string[] = [];
    if (c.tddSeverity !== null && c.reviewSeverity !== null && c.tddSeverity.toLowerCase() !== c.reviewSeverity.toLowerCase()) {
      parts.push(`severity tdd=${c.tddSeverity} vs review-army=${c.reviewSeverity}`);
    }
    if (c.tddDisposition !== null && c.reviewDisposition !== null && c.tddDisposition !== c.reviewDisposition) {
      parts.push(`disposition tdd=${c.tddDisposition} vs review-army=${c.reviewDisposition}`);
    }
    return `Finding ${c.findingId} appears in both 06-tdd.md > Per-Slice Review and 07-review-army.json with mismatched ${parts.join(" and ")}. Review must cite, not re-classify.`;
  });

  return {
    ok: errors.length === 0,
    errors,
    conflicts,
    tddArtifactExists,
    reviewArtifactExists
  };
}

export async function checkReviewSecurityNoChangeAttestation(
  projectRoot: string
): Promise<ReviewSecurityNoChangeAttestationResult> {
  const reviewMdPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "07-review.md");
  if (!(await exists(reviewMdPath))) {
    return {
      ok: true,
      errors: [],
      hasSecurityFinding: false,
      hasNoChangeAttestation: false
    };
  }

  const errors: string[] = [];
  const raw = await fs.readFile(reviewMdPath, "utf8");
  const sections = extractH2Sections(raw);
  const securityBody =
    sectionBodyByName(sections, "Layer 2 Security")
    ?? sectionBodyByName(sections, "Layer 2b: Security")
    ?? sectionBodyByName(sections, "Layer 2 Findings");

  if (!securityBody) {
    errors.push('07-review.md is missing a Layer 2 security section.');
    return {
      ok: false,
      errors,
      hasSecurityFinding: false,
      hasNoChangeAttestation: false
    };
  }

  const securityTableRowPattern = /^\|\s*[^|\n]+\|\s*[^|\n]+\|\s*security\s*\|\s*[^|\n]+\|\s*[^|\n]+\|/imu;
  const securityBulletPattern = /^[*-]\s+.*\b(?:security|auth|injection|secret|credential|permission)\b/imu;
  const hasSecurityFinding =
    securityTableRowPattern.test(securityBody) || securityBulletPattern.test(securityBody);

  const attestationMatch = /\b(NO_CHANGE_ATTESTATION|NO_SECURITY_IMPACT)\b\s*:\s*(.*)/iu.exec(securityBody);
  const attestationToken = attestationMatch?.[1] ?? "NO_CHANGE_ATTESTATION";
  const hasNoChangeAttestation = Boolean(attestationMatch && attestationMatch[2]?.trim().length > 0);
  if (attestationMatch && attestationMatch[2]?.trim().length === 0) {
    errors.push(`${attestationToken} must include a non-empty rationale.`);
  }

  if (!hasSecurityFinding && !hasNoChangeAttestation) {
    errors.push(
      "Layer 2 security evidence missing: include at least one security finding or `NO_CHANGE_ATTESTATION: <reason>` / `NO_SECURITY_IMPACT: <reason>`."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    hasSecurityFinding,
    hasNoChangeAttestation
  };
}
