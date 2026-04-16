import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { exists } from "./fs-utils.js";
import { orderedStageSchemas, stageSchema } from "./content/stage-schema.js";
import type { FlowStage } from "./types.js";

export interface LintFinding {
  section: string;
  required: boolean;
  rule: string;
  found: boolean;
  details: string;
}

export interface LintResult {
  stage: string;
  file: string;
  passed: boolean;
  findings: LintFinding[];
}

interface ResolvedArtifactPath {
  absPath: string;
  relPath: string;
}

async function resolveArtifactPath(projectRoot: string, fileName: string): Promise<ResolvedArtifactPath> {
  const relPath = path.join(RUNTIME_ROOT, "artifacts", fileName);
  const absPath = path.join(projectRoot, relPath);
  return { absPath, relPath };
}

function normalizeHeadingTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

type H2SectionMap = Map<string, string>;

/** Collect H2 sections and body content (`## Section Name`). */
function extractH2Sections(markdown: string): H2SectionMap {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentHeading === null) return;
    sections.set(currentHeading, buffer.join("\n"));
  };

  for (const line of lines) {
    const match = /^##\s+(.+)$/u.exec(line);
    if (match) {
      flush();
      currentHeading = normalizeHeadingTitle(match[1] ?? "");
      buffer = [];
      continue;
    }
    if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function headingPresent(sections: H2SectionMap, section: string): boolean {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const h of sections.keys()) {
    if (h.toLowerCase() === want) {
      return true;
    }
  }
  return false;
}

function sectionBodyByName(sections: H2SectionMap, section: string): string | null {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const [heading, body] of sections.entries()) {
    if (heading.toLowerCase() === want) {
      return body;
    }
  }
  return null;
}

function meaningfulLineCount(sectionBody: string): number {
  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("<!--"))
    .filter((line) => !/^[-:| ]+$/u.test(line))
    .filter((line) => /[A-Za-z0-9]/u.test(line))
    .length;
}

function lineHasToken(line: string, token: string): boolean {
  return new RegExp(`\\b${token}\\b`, "u").test(line);
}

function countListItems(sectionBody: string): number {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const bullets = lines.filter((line) => /^[-*]\s+\S+/u.test(line)).length;
  const tableRows = lines.filter((line) => /^\|.*\|$/u.test(line) && !/^\|[-:| ]+\|$/u.test(line));
  const tableDataRows = tableRows.length > 0 ? Math.max(0, tableRows.length - 1) : 0;
  return Math.max(bullets, tableDataRows);
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function tableHeaderCells(sectionBody: string): string[] | null {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /^\|.*\|$/u.test(line));
  if (headerIndex < 0) return null;
  const separator = lines[headerIndex + 1];
  if (!separator || !/^\|[-:| ]+\|$/u.test(separator)) {
    return null;
  }
  return parseMarkdownTableRow(lines[headerIndex]);
}

function extractMinItemsFromRule(rule: string): number | null {
  const match = /at least\s+(\d+)/iu.exec(rule);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokensFromRule(rule: string): string[] {
  const allCaps = rule.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [];
  if (allCaps.length > 0) {
    return [...new Set(allCaps)];
  }
  if (/finalization enum token/iu.test(rule)) {
    return [
      "FINALIZE_MERGE_LOCAL",
      "FINALIZE_OPEN_PR",
      "FINALIZE_KEEP_BRANCH",
      "FINALIZE_DISCARD_BRANCH"
    ];
  }
  if (/final verdict/iu.test(rule)) {
    return ["APPROVED", "APPROVED_WITH_CONCERNS", "BLOCKED"];
  }
  return [];
}

/**
 * Extract required keywords from validation rules that contain comma-separated
 * concept lists. Activates only for rules with structured enumerations like
 * "failure modes, error surface, data-flow paths" — not for short rules.
 */
function extractRequiredKeywords(rule: string): string[] {
  const colonMatch = /:\s*(.+)$/u.exec(rule);
  if (!colonMatch) return [];
  const tail = colonMatch[1]!;
  const parts = tail.split(/,\s*(?:and\s+)?/u).map((p) => p.trim().replace(/\.$/u, ""));
  const phrases = parts.filter((p) => p.length >= 4 && !/^(must|should|at least|if |or )/iu.test(p));
  if (phrases.length < 3) return [];
  return phrases;
}

const VAGUE_AC_ADJECTIVES = [
  "fast",
  "quick",
  "slow",
  "fast enough",
  "quickly",
  "intuitive",
  "robust",
  "reliable",
  "scalable",
  "simple",
  "easy",
  "user-friendly",
  "user friendly",
  "nice",
  "good",
  "clean",
  "secure enough",
  "responsive",
  "efficient",
  "performant",
  "smooth",
  "seamless",
  "modern"
];

function isSeparatorRow(line: string): boolean {
  return /^\|[-:| ]+\|$/u.test(line);
}

function getMarkdownTableRows(sectionBody: string): string[][] {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const rows: string[][] = [];
  let sawSeparator = false;
  for (const line of lines) {
    if (!/^\|.*\|$/u.test(line)) continue;
    if (isSeparatorRow(line)) {
      sawSeparator = true;
      continue;
    }
    if (!sawSeparator) continue;
    rows.push(parseMarkdownTableRow(line));
  }
  return rows;
}

function lineContainsVagueAdjective(text: string): string | null {
  const lower = text.toLowerCase();
  for (const adjective of VAGUE_AC_ADJECTIVES) {
    const pattern = new RegExp(`(?:^|[^A-Za-z])${adjective.replace(/ /g, "\\s+")}(?:[^A-Za-z]|$)`, "iu");
    if (pattern.test(lower)) return adjective;
  }
  return null;
}

function validateSectionBody(
  sectionBody: string,
  rule: string,
  sectionName: string
): { ok: boolean; details: string } {
  const bodyLines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const meaningful = meaningfulLineCount(sectionBody);
  if (meaningful === 0) {
    return {
      ok: false,
      details: "Section exists but has no meaningful content yet."
    };
  }

  const minItems = extractMinItemsFromRule(rule);
  if (minItems !== null) {
    const count = countListItems(sectionBody);
    if (count < minItems) {
      return {
        ok: false,
        details: `Rule expects at least ${minItems} item(s), found ${count}.`
      };
    }
  }

  if (/table must use 4 columns/iu.test(rule)) {
    const header = tableHeaderCells(sectionBody);
    if (!header) {
      return {
        ok: false,
        details: "Rule expects a markdown table header with a separator row."
      };
    }
    const expected = ["Category", "Question asked", "User answer", "Evidence note"];
    const normalizedHeader = header.map((cell) => cell.toLowerCase());
    const normalizedExpected = expected.map((cell) => cell.toLowerCase());
    const matches =
      normalizedHeader.length === normalizedExpected.length &&
      normalizedHeader.every((cell, index) => cell === normalizedExpected[index]);
    if (!matches) {
      return {
        ok: false,
        details: `Rule expects Clarification Log header: ${expected.join(" | ")}.`
      };
    }
  }

  if (/exactly one/iu.test(rule)) {
    const tokens = tokensFromRule(rule);
    if (tokens.length > 0) {
      const selected = new Set<string>();
      const tokenLines: Array<{ line: string; token: string }> = [];
      for (const line of bodyLines) {
        if (!line) continue;
        for (const token of tokens) {
          if (!lineHasToken(line, token)) continue;
          tokenLines.push({ line, token });
          if (/\[x\]/iu.test(line) || /selected|verdict|enum|execution result|status/iu.test(line)) {
            selected.add(token);
          }
        }
      }
      if (selected.size === 0 && tokenLines.length === 1 && !tokenLines[0]!.line.includes("|")) {
        selected.add(tokenLines[0]!.token);
      }
      if (selected.size !== 1) {
        return {
          ok: false,
          details: `Rule expects exactly one selected token (${tokens.join(", ")}); found ${selected.size}.`
        };
      }
      return { ok: true, details: "Exactly one token selected as expected." };
    }
  }

  if (/Status:\s*pending\s+until/iu.test(rule)) {
    const statusLine = bodyLines.find((l) => /^\s*-?\s*Status\s*:/iu.test(l));
    if (!statusLine) {
      return { ok: false, details: "WAIT_FOR_CONFIRM section must contain a 'Status:' line." };
    }
    const validStatuses = ["pending", "approved"];
    const statusMatch = /Status\s*:\s*(\S+)/iu.exec(statusLine);
    const statusValue = statusMatch?.[1]?.toLowerCase();
    if (!statusValue || !validStatuses.includes(statusValue)) {
      const foundLabel = statusValue || "(empty)";
      return {
        ok: false,
        details: "WAIT_FOR_CONFIRM Status must be exactly one of: " + validStatuses.join(", ") + ". Found: " + foundLabel + "."
      };
    }
  }

  const keywords = extractRequiredKeywords(rule);
  if (keywords.length > 0) {
    const bodyLower = sectionBody.toLowerCase();
    const found = keywords.filter((kw) => bodyLower.includes(kw.toLowerCase()));
    const threshold = Math.ceil(keywords.length * 0.5);
    if (found.length < threshold) {
      const missing = keywords.filter((kw) => !bodyLower.includes(kw.toLowerCase()));
      return {
        ok: false,
        details: `Rule expects keywords (${threshold}/${keywords.length} minimum): missing ${missing.join(", ")}.`
      };
    }
  }

  if (
    normalizeHeadingTitle(sectionName).toLowerCase() === "acceptance criteria" &&
    /observable[\s,]*measurable[\s,]+(and )?falsifiable/iu.test(rule)
  ) {
    const rows = getMarkdownTableRows(sectionBody);
    for (const row of rows) {
      const criterionText = row[1] ?? row[0] ?? "";
      const adjective = lineContainsVagueAdjective(criterionText);
      if (adjective) {
        return {
          ok: false,
          details: `Acceptance criterion uses vague adjective "${adjective}" without a measurable predicate: "${criterionText.slice(0, 140)}". Rewrite with a numeric threshold or boolean outcome.`
        };
      }
      const hasDigit = /\d/u.test(criterionText);
      const hasMeasurableVerb = /\b(blocks?|rejects?|returns?|matches?|equals?|emits?|succeeds?|fails?|publishes?|logs?|persists?|reads?|writes?|creates?|deletes?|throws?|contains?|restores?|exceeds?|responds?|warns?|quarantines?|includes?|raises?|passes?|denies|refuses|exits|succeeds|completes|prevents|allows|maps|points|signals|surfaces|records|produces|accepts|requires)\b/iu.test(
        criterionText
      );
      const hasMeaningfulText = /[A-Za-z]/u.test(criterionText) && criterionText.trim().length >= 12;
      if (hasMeaningfulText && !hasDigit && !hasMeasurableVerb) {
        return {
          ok: false,
          details: `Acceptance criterion lacks a measurable predicate (no numeric threshold, no observable verb like blocks/returns/publishes/matches): "${criterionText.slice(0, 140)}". Rewrite so the criterion is falsifiable by a single test.`
        };
      }
    }
  }

  return {
    ok: true,
    details: "Section heading and content satisfy lint heuristics."
  };
}

export async function lintArtifact(projectRoot: string, stage: FlowStage): Promise<LintResult> {
  const schema = stageSchema(stage);
  const { absPath: absFile, relPath: relFile } = await resolveArtifactPath(projectRoot, schema.artifactFile);
  const findings: LintFinding[] = [];

  if (!(await exists(absFile))) {
    for (const v of schema.artifactValidation) {
      findings.push({
        section: v.section,
        required: v.required,
        rule: v.validationRule,
        found: false,
        details: `Artifact file missing: ${relFile}`
      });
    }
    return {
      stage,
      file: relFile,
      passed: schema.artifactValidation.every((v) => !v.required),
      findings
    };
  }

  const raw = await fs.readFile(absFile, "utf8");
  const sections = extractH2Sections(raw);

  const isTrivialOverride =
    schema.trivialOverrideSections &&
    schema.trivialOverrideSections.length > 0 &&
    /trivial.change|mini.design|escape.hatch/iu.test(raw);
  const overrideSet = isTrivialOverride
    ? new Set(schema.trivialOverrideSections!.map((s) => normalizeHeadingTitle(s).toLowerCase()))
    : null;

  for (const v of schema.artifactValidation) {
    const effectiveRequired = overrideSet
      ? overrideSet.has(normalizeHeadingTitle(v.section).toLowerCase()) ? true : false
      : v.required;
    const hasHeading = headingPresent(sections, v.section);
    const body = hasHeading ? sectionBodyByName(sections, v.section) : null;
    const validation = body === null
      ? { ok: false, details: `No ## heading matching required section "${v.section}".` }
      : validateSectionBody(body, v.validationRule, v.section);
    const found = hasHeading && validation.ok;
    findings.push({
      section: v.section,
      required: effectiveRequired,
      rule: v.validationRule,
      found,
      details: found
        ? validation.details
        : validation.details
    });
  }

  const passed = findings.every((f) => !f.required || f.found);
  return { stage, file: relFile, passed, findings };
}

export async function lintAllArtifacts(projectRoot: string): Promise<LintResult[]> {
  const out: LintResult[] = [];
  for (const schema of orderedStageSchemas()) {
    out.push(await lintArtifact(projectRoot, schema.stage));
  }
  return out;
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
  const { absPath, relPath } = await resolveArtifactPath(projectRoot, "07-review-army.json");

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

  return {
    ok: errors.length === 0,
    errors,
    finalVerdict,
    openCriticalCount,
    shipBlockerCount
  };
}
