import { createHash } from "node:crypto";
import { SHIP_FINALIZATION_MODES } from "../constants.js";
import { FLOW_STAGES, type FlowStage, type FlowTrack } from "../types.js";

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

export function normalizeHeadingTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export type H2SectionMap = Map<string, string>;

/**
 * Collect H2 sections and body content (`## Section Name`).
 *
 * - Ignores lines that live inside fenced code blocks (``` / ~~~) so a
 *   commented `## Approaches` inside an example doesn't open a phantom
 *   section and swallow real content.
 * - When the same heading appears more than once at the top level we
 *   concatenate the bodies rather than silently overwriting the earlier
 *   occurrence. This keeps lint rules honest when authors split a section
 *   into multiple passes.
 */
export function extractH2Sections(markdown: string): H2SectionMap {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  let fenced: string | null = null;

  const flush = (): void => {
    if (currentHeading === null) return;
    const existing = sections.get(currentHeading);
    const body = buffer.join("\n");
    sections.set(
      currentHeading,
      existing === undefined ? body : `${existing}\n${body}`
    );
  };

  for (const line of lines) {
    const fenceMatch = /^(```|~~~)/u.exec(line);
    if (fenceMatch) {
      if (fenced === null) {
        fenced = fenceMatch[1] ?? null;
      } else if (line.startsWith(fenced)) {
        fenced = null;
      }
      if (currentHeading !== null) buffer.push(line);
      continue;
    }
    if (fenced === null) {
      const match = /^##\s+(.+)$/u.exec(line);
      if (match) {
        flush();
        currentHeading = normalizeHeadingTitle(match[1] ?? "");
        buffer = [];
        continue;
      }
    }
    if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

export function headingPresent(sections: H2SectionMap, section: string): boolean {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const h of sections.keys()) {
    if (h.toLowerCase() === want) {
      return true;
    }
  }
  return false;
}

export function sectionBodyByName(sections: H2SectionMap, section: string): string | null {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const [heading, body] of sections.entries()) {
    if (heading.toLowerCase() === want) {
      return body;
    }
  }
  return null;
}

export function sectionBodyByAnyName(sections: H2SectionMap, sectionNames: string[]): string | null {
  const bodies = sectionNames.flatMap((section) => {
    const body = sectionBodyByName(sections, section);
    return body === null ? [] : [`### ${section}\n${body}`];
  });
  if (bodies.length === 0) return null;
  return bodies.join("\n");
}

export function sectionBodyByHeadingPrefix(sections: H2SectionMap, prefix: string): string | null {
  const want = normalizeHeadingTitle(prefix).toLowerCase();
  for (const [heading, body] of sections.entries()) {
    if (heading.toLowerCase().startsWith(want)) {
      return body;
    }
  }
  return null;
}

export interface CriticPredictionsContractCheck {
  found: boolean;
  details: string;
}

export function checkCriticPredictionsContract(
  sections: H2SectionMap
): CriticPredictionsContractCheck | null {
  const criticFindingsBody = sectionBodyByName(sections, "Critic Findings");
  const layeredReviewBody = sectionBodyByHeadingPrefix(sections, "Layered review");
  const layeredReviewMentionsCritic =
    layeredReviewBody !== null && /\bcritic\b/iu.test(layeredReviewBody);
  const sourceBody = criticFindingsBody ?? (layeredReviewMentionsCritic ? layeredReviewBody : null);
  if (sourceBody === null) return null;

  const predictionsMatch =
    /(?:^|\n)#{3,4}\s*Pre-commitment predictions\b([\s\S]*?)(?=\n#{2,4}\s+|$)/iu.exec(sourceBody);
  const predictionsCount = predictionsMatch ? countListItems(predictionsMatch[1] ?? "") : 0;
  const hasPredictions = predictionsCount >= 1;
  const hasValidated = /(?:^|\n)#{3,4}\s*Validated\s*\/\s*Disproven\b/iu.test(sourceBody);
  const hasOpenQuestions = /(?:^|\n)#{3,4}\s*Open Questions\b/iu.test(sourceBody);

  const missing: string[] = [];
  if (!hasPredictions) {
    missing.push("`Pre-commitment predictions` subsection is missing or has no list items");
  }
  if (!hasValidated) {
    missing.push("`Validated / Disproven` subsection is missing");
  }
  if (!hasOpenQuestions) {
    missing.push("`Open Questions` subsection is missing");
  }

  return {
    found: missing.length === 0,
    details:
      missing.length === 0
        ? "Critic pre-commitment predictions contract is present (predictions, validated/disproven mapping, open questions)."
        : missing.join("; ")
  };
}

const DOCUMENT_REVIEWER_NAMES = [
  "coherence-reviewer",
  "scope-guardian-reviewer",
  "feasibility-reviewer"
] as const;

export interface LayeredDocumentReviewStatus {
  triggeredReviewers: string[];
  missingStructured: string[];
  failOrPartialWithoutWaiver: string[];
}

export function evaluateLayeredDocumentReviewStatus(
  sections: H2SectionMap,
  confidenceFindingRegexSource: string
): LayeredDocumentReviewStatus | null {
  const layeredReviewBody = sectionBodyByHeadingPrefix(sections, "Layered review");
  if (layeredReviewBody === null) return null;

  const triggeredReviewers = DOCUMENT_REVIEWER_NAMES.filter((reviewer) =>
    new RegExp(`\\b${reviewer}\\b`, "iu").test(layeredReviewBody)
  );
  if (triggeredReviewers.length === 0) return null;

  const findingRegex = new RegExp(confidenceFindingRegexSource, "iu");
  const hasCalibratedFinding = findingRegex.test(layeredReviewBody);
  const missingStructured: string[] = [];
  const failOrPartialWithoutWaiver: string[] = [];
  const waiverRegex = /(?:explicit\s+waiver|waiver\s*:|waived\s*:|accepted[-\s]?risk)/iu;

  for (const reviewer of triggeredReviewers) {
    const escaped = reviewer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const subsectionMatch =
      new RegExp(`(?:^|\\n)#{3,4}\\s*${escaped}\\b([\\s\\S]*?)(?=\\n#{2,4}\\s+|$)`, "iu")
        .exec(layeredReviewBody);
    const reviewerBlock = subsectionMatch?.[1] ?? layeredReviewBody;
    const statusMatch = /\b(?:Status|Result|Verdict)\s*:\s*(PASS|PASS_WITH_GAPS|FAIL|PARTIAL|BLOCKED)\b/iu
      .exec(reviewerBlock);
    const inlineStatusMatch =
      new RegExp(`${escaped}[\\s\\S]{0,120}\\b(PASS|PASS_WITH_GAPS|FAIL|PARTIAL|BLOCKED)\\b`, "iu")
        .exec(layeredReviewBody);
    const status = (statusMatch?.[1] ?? inlineStatusMatch?.[1] ?? "").toUpperCase();
    if (!hasCalibratedFinding || status.length === 0) {
      missingStructured.push(reviewer);
    }
    if ((status === "FAIL" || status === "PARTIAL") && !waiverRegex.test(reviewerBlock) && !waiverRegex.test(layeredReviewBody)) {
      failOrPartialWithoutWaiver.push(`${reviewer}:${status}`);
    }
  }

  return {
    triggeredReviewers,
    missingStructured,
    failOrPartialWithoutWaiver
  };
}

/**
 * Build a regex that matches `<field>: <value>` even when the field name
 * and/or value are wrapped in markdown emphasis (`*`, `**`, `_`, `__`).
 *
 * The shipped templates render fields as `- **Field name:** value`, so any
 * structural check that searches for `Field:\s*token` against the rendered
 * artifact must tolerate the closing `**` between the colon and the value.
 *
 * `field` is treated as literal text (regex meta-characters are escaped).
 * `value` is inserted verbatim so callers can pass alternation
 * (`STARTUP|BUILDER|...`). `flags` defaults to case-insensitive Unicode.
 */
export function markdownFieldRegex(field: string, value: string, flags = "iu"): RegExp {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const emph = "[*_]{0,2}";
  const source =
    `(?:^|[\\s>])${emph}\\s*${escapedField}\\s*${emph}\\s*:\\s*${emph}\\s*(?:${value})\\b`;
  return new RegExp(source, flags);
}

export function extractMarkdownSectionBody(markdown: string, section: string): string | null {
  return sectionBodyByName(extractH2Sections(markdown), section);
}

export function headingLineIndex(markdown: string, section: string): number {
  const want = normalizeHeadingTitle(section).toLowerCase();
  const lines = markdown.split(/\r?\n/);
  let fenced: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```+|~~~+)\s*([A-Za-z0-9_-]+)?\s*$/u.exec(line);
    if (fence) {
      const marker = fence[1]!;
      if (fenced === null) {
        fenced = marker;
      } else if (fenced === marker) {
        fenced = null;
      }
      continue;
    }
    if (fenced !== null) continue;
    const heading = /^##\s+(.+)$/u.exec(line);
    if (!heading) continue;
    if (normalizeHeadingTitle(heading[1] ?? "").toLowerCase() === want) {
      return i;
    }
  }
  return -1;
}

export function parseShortCircuitStatus(sectionBody: string | null): string {
  if (!sectionBody) return "";
  const lines = sectionBody.split(/\r?\n/u);
  return lines
    .map((line) => line.replace(/[*_`]/gu, "").trim())
    .map((line) => /^[-*]?\s*status\s*:\s*(.+)$/iu.exec(line)?.[1] ?? "")
    .find((value) => value.trim().length > 0)?.trim().toLowerCase() ?? "";
}

export function isShortCircuitActivated(sectionBody: string | null): boolean {
  const statusValue = parseShortCircuitStatus(sectionBody);
  return /^(?:activated|yes|true)$/u.test(statusValue) || /\bactivated\b/iu.test(statusValue);
}

export function meaningfulLineCount(sectionBody: string): number {
  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("<!--"))
    .filter((line) => !/^[-:| ]+$/u.test(line))
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .length;
}

export function lineHasToken(line: string, token: string): boolean {
  return new RegExp(`\\b${token}\\b`, "u").test(line);
}

export function countListItems(sectionBody: string): number {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const bullets = lines.filter((line) => /^[-*]\s+\S+/u.test(line)).length;
  const tableRows = lines.filter((line) => /^\|.*\|$/u.test(line) && !/^\|[-:| ]+\|$/u.test(line));
  const tableDataRows = tableRows.length > 0 ? Math.max(0, tableRows.length - 1) : 0;
  return Math.max(bullets, tableDataRows);
}

export function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

export function tableHeaderCells(sectionBody: string): string[] | null {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /^\|.*\|$/u.test(line));
  if (headerIndex < 0) return null;
  const separator = lines[headerIndex + 1];
  if (!separator || !/^\|[-:| ]+\|$/u.test(separator)) {
    return null;
  }
  return parseMarkdownTableRow(lines[headerIndex]);
}

export function extractMinItemsFromRule(rule: string): number | null {
  const match = /at least\s+(\d+)/iu.exec(rule);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tokensFromRule(rule: string): string[] {
  const allCaps = rule.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [];
  if (allCaps.length > 0) {
    return [...new Set(allCaps)];
  }
  if (/finalization enum token/iu.test(rule)) {
    return [...SHIP_FINALIZATION_MODES];
  }
  if (/final verdict/iu.test(rule)) {
    return ["APPROVED", "APPROVED_WITH_CONCERNS", "BLOCKED"];
  }
  return [];
}

export const VAGUE_AC_ADJECTIVES = [
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

export function isSeparatorRow(line: string): boolean {
  return /^\|[-:| ]+\|$/u.test(line);
}

export function getMarkdownTableRows(sectionBody: string): string[][] {
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

export type BinaryFlag = "yes" | "no" | "unknown";

export function parseBinaryFlag(value: string): BinaryFlag {
  const normalized = value.trim().toLowerCase();
  if (/^(?:y|yes|true|1)$/u.test(normalized)) return "yes";
  if (/^(?:n|no|false|0|none)$/u.test(normalized)) return "no";
  return "unknown";
}

export function parseKeyedBinaryFlag(value: string, key: string): BinaryFlag {
  const match = new RegExp(`${key}\\s*=\\s*(y|yes|true|1|n|no|false|0)`, "iu").exec(value);
  if (!match) return "unknown";
  return /^(?:y|yes|true|1)$/iu.test(match[1] ?? "") ? "yes" : "no";
}

export function parseFailureModeRescueFlag(rescueCell: string): BinaryFlag {
  const keyed = parseKeyedBinaryFlag(rescueCell, "rescued");
  if (keyed !== "unknown") return keyed;
  const direct = parseBinaryFlag(rescueCell);
  if (direct !== "unknown") return direct;
  if (/\b(?:no rescue|without rescue|unrescued|no fallback|none|absent)\b/iu.test(rescueCell)) {
    return "no";
  }
  if (/\b(?:fallback|retry|degrade|recover|rescue|mitigat)\b/iu.test(rescueCell)) {
    return "yes";
  }
  return "unknown";
}

export function parseFailureModeTestFlag(rowText: string): BinaryFlag {
  const keyed = parseKeyedBinaryFlag(rowText, "test");
  if (keyed !== "unknown") return keyed;
  if (/\b(?:no tests?|untested|without tests?)\b/iu.test(rowText)) {
    return "no";
  }
  if (/\b(?:tested|has tests?|with tests?|covered by tests?)\b/iu.test(rowText)) {
    return "yes";
  }
  return "unknown";
}

export function validateFailureModeTable(sectionBody: string): { ok: boolean; details: string } {
  const header = tableHeaderCells(sectionBody);
  if (!header) {
    return {
      ok: false,
      details: "Failure Mode Table must include a markdown header row and separator."
    };
  }
  const expectedHeader = ["Method", "Exception", "Rescue", "UserSees"];
  const normalizedHeader = header.map((cell) => cell.toLowerCase());
  const normalizedExpected = expectedHeader.map((cell) => cell.toLowerCase());
  const headerMatches =
    normalizedHeader.length === normalizedExpected.length &&
    normalizedHeader.every((cell, index) => cell === normalizedExpected[index]);
  if (!headerMatches) {
    return {
      ok: false,
      details: `Failure Mode Table header must be exactly: ${expectedHeader.join(" | ")}.`
    };
  }
  const rows = getMarkdownTableRows(sectionBody);
  if (rows.length === 0) {
    return {
      ok: false,
      details: "Failure Mode Table must include at least one data row."
    };
  }
  for (const [index, row] of rows.entries()) {
    if (row.length < 4) {
      return {
        ok: false,
        details: `Failure Mode Table row ${index + 1} must provide 4 columns (Method, Exception, Rescue, UserSees).`
      };
    }
    const method = (row[0] ?? "").trim();
    const exception = (row[1] ?? "").trim();
    const rescue = (row[2] ?? "").trim();
    const userSees = (row[3] ?? "").trim();
    if (!method || !exception || !rescue || !userSees) {
      return {
        ok: false,
        details: `Failure Mode Table row ${index + 1} must populate all columns (Method, Exception, Rescue, UserSees).`
      };
    }
    const rescueFlag = parseFailureModeRescueFlag(rescue);
    const testFlag = parseFailureModeTestFlag(`${method} ${exception} ${rescue} ${userSees}`);
    const userSilent = /\bsilent\b/iu.test(userSees);
    if (rescueFlag === "no" && testFlag === "no" && userSilent) {
      return {
        ok: false,
        details: `Failure Mode Table CRITICAL row ${index + 1} (${method}): RESCUED=N + TEST=N + UserSees=Silent. Add rescue path, add test coverage, or make user impact explicit.`
      };
    }
  }
  return {
    ok: true,
    details: "Failure Mode Table header and critical-risk checks passed."
  };
}

// Canonical scope mode tokens (gstack CEO review). The four mode names live in
// the scope skill, the artifact template, and downstream traces. Requiring one
// of them in Scope Summary is **structural** — not free-form English keyword
// matching on user prose. Authors may also use the canonical short form on a
// `Mode:` / `Selected mode:` line (e.g. `Selected mode: hold`) as a courtesy.
export const SCOPE_MODE_FULL_TOKENS: readonly string[] = [
  "SCOPE EXPANSION",
  "SELECTIVE EXPANSION",
  "HOLD SCOPE",
  "SCOPE REDUCTION"
];
export type CanonicalScopeMode = (typeof SCOPE_MODE_FULL_TOKENS)[number];

// Short-form synonyms accepted only when stamped on an explicit `Mode:` /
// `Selected mode:` / `Scope mode:` line. Plain prose with the same word does
// not count, so `strict` / `broad` / `narrow` / similar non-mode adjectives
// remain rejected.
export const SCOPE_MODE_LINE_REGEX = /(?:^|\n)\s*[-*]?\s*\**\s*(?:Selected\s+|Scope\s+)?Mode\**\s*:\s*\**\s*([^\n]+)/iu;
export const SCOPE_MODE_SHORT_TOKEN_REGEX = /\b(?:hold(?:[\s_-]?scope)?|selective(?:[\s_-]?expansion)?|scope[\s_-]?expansion|expansion|scope[\s_-]?reduction|reduction|expand|reduce)\b/iu;
export const SPEC_MAX_MODULES = 5;

// Next-stage handoff token. We only enforce the canonical machine-surface stage
// IDs (`design`, `spec`) plus stable handoff phrases. The surrounding prose may
// be written in any language — this guards the downstream cross-stage trace,
// not the wording of the rationale.
export const NEXT_STAGE_HANDOFF_REGEX = /(?:`(?:design|spec)`|\bdesign\b|\bspec\b|next[-\s_]stage|next stage|handoff|hand[-\s]off)/iu;

export function hasCanonicalScopeMode(body: string): boolean {
  return extractCanonicalScopeMode(body) !== null;
}

export function canonicalModesInText(text: string): CanonicalScopeMode[] {
  const normalized = text
    .toUpperCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const hits: CanonicalScopeMode[] = [];
  if (/\bSCOPE EXPANSION\b/u.test(normalized)) hits.push("SCOPE EXPANSION");
  if (/\bSELECTIVE EXPANSION\b/u.test(normalized)) hits.push("SELECTIVE EXPANSION");
  if (/\bHOLD SCOPE\b/u.test(normalized)) hits.push("HOLD SCOPE");
  if (/\bSCOPE REDUCTION\b/u.test(normalized)) hits.push("SCOPE REDUCTION");
  return hits;
}

export function shortModeToCanonical(text: string): CanonicalScopeMode | null {
  if (!SCOPE_MODE_SHORT_TOKEN_REGEX.test(text)) return null;
  const normalized = text
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
  if (/\bselective(?:\s+expansion)?\b/u.test(normalized)) return "SELECTIVE EXPANSION";
  if (/\bhold(?:\s+scope)?\b/u.test(normalized)) return "HOLD SCOPE";
  if (/\b(?:scope\s+reduction|reduction|reduce)\b/u.test(normalized)) return "SCOPE REDUCTION";
  if (/\b(?:scope\s+expansion|expansion|expand)\b/u.test(normalized)) return "SCOPE EXPANSION";
  return null;
}

export function canonicalModeFromCandidate(candidate: string): CanonicalScopeMode | null {
  const canonicalHits = canonicalModesInText(candidate);
  if (canonicalHits.length === 1) return canonicalHits[0];
  if (canonicalHits.length > 1) return null;
  return shortModeToCanonical(candidate);
}

export function extractCanonicalScopeMode(body: string): CanonicalScopeMode | null {
  // Strict: a Mode: / Selected mode: line that picks exactly ONE canonical mode
  // is the strongest signal. The template scaffolding contains all four mode
  // tokens inside an instructional `(one of ...)` placeholder; we ignore that
  // line so authors who never replace the scaffolding still fail validation.
  for (const match of body.matchAll(new RegExp(SCOPE_MODE_LINE_REGEX, "giu"))) {
    const raw = (match[1] ?? "").trim();
    const sanitized = raw.replace(/\(.*?\)/gu, "").trim();
    if (sanitized.length === 0) continue;
    const mode = canonicalModeFromCandidate(sanitized);
    if (mode) return mode;
  }
  // Fallback: any line outside an instructional `(one of ...)` placeholder
  // names exactly one mode. Block lines that list multiple modes (the
  // unfilled template) or are wrapped in an instructional parenthetical.
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/\(\s*one\s+of\b/iu.test(line)) continue;
    const sanitized = line.replace(/\(.*?\)/gu, "");
    const mode = canonicalModeFromCandidate(sanitized);
    if (mode) return mode;
  }
  return null;
}

export function validatePremiseChallenge(sectionBody: string): { ok: boolean; details: string } {
  // gstack-style premise challenge requires a real Q/A structure (table or
  // list), not free-form prose. The validation is *structural* only — we do
  // NOT keyword-grep for English phrases like "right problem"; authors may
  // write the questions in any language, and the answers carry the meaning.
  // The template ships with canonical question labels as scaffolding, but
  // the linter only enforces that the section actually compares premise
  // questions to answers.
  const tableRows = getMarkdownTableRows(sectionBody);
  const bulletRows = sectionBody
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+\.)\s+\S/u.test(line));
  const rowCount = Math.max(tableRows.length, bulletRows.length);
  if (rowCount < 3) {
    return {
      ok: false,
      details: `Premise Challenge needs at least 3 substantive rows in a table or bullet list. Found ${rowCount}.`
    };
  }
  // For tables, each data row must have at least 2 non-empty cells so the
  // section is genuinely a premise/answer comparison, not a list of headlines.
  // For bullet lists, each line must be substantive so we don't accept
  // placeholders like `- a`; punctuation style and natural language do not
  // matter.
  if (tableRows.length >= 3) {
    const sparseRows = tableRows.filter((row) => {
      const filledCells = row.filter((cell) => cell.replace(/[\s|]/gu, "").length >= 2);
      return filledCells.length < 2;
    });
    if (sparseRows.length > 0) {
      return {
        ok: false,
        details: "Premise Challenge table rows must populate at least the question and answer columns (no empty answers)."
      };
    }
  } else if (bulletRows.length >= 3) {
    const sparseBullets = bulletRows.filter((line) => {
      const cleaned = line.replace(/^[-*\d.\s]+/u, "").replace(/[`*_]/gu, "").trim();
      const meaningful = cleaned.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
      return meaningful < 12;
    });
    if (sparseBullets.length > 0) {
      return {
        ok: false,
        details: "Premise Challenge bullet list must include at least 3 substantive rows, not placeholders."
      };
    }
  }
  return {
    ok: true,
    details: `Premise Challenge structures ${rowCount} Q/A rows.`
  };
}

export function validateScopeSummary(sectionBody: string): { ok: boolean; details: string } {
  const meaningfulLines = sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /[\p{L}\p{N}]/u.test(line));

  if (meaningfulLines.length < 2) {
    return {
      ok: false,
      details:
        "Scope Summary must list at least 2 substantive lines covering the selected mode and the next-stage handoff."
    };
  }

  if (!hasCanonicalScopeMode(sectionBody)) {
    return {
      ok: false,
      details:
        "Scope Summary must name the selected mode using a canonical token (SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE, SCOPE REDUCTION) or a short form on a `Mode:` line (hold, selective, expansion, reduction)."
    };
  }

  if (!NEXT_STAGE_HANDOFF_REGEX.test(sectionBody)) {
    return {
      ok: false,
      details:
        "Scope Summary must record the track-aware next-stage handoff (mention `design` for standard, `spec` for medium, or include a `Next-stage handoff:` line)."
    };
  }

  return {
    ok: true,
    details: "Scope Summary names the selected mode and the next-stage handoff."
  };
}

export const APPROACH_ROLE_VALUES = ["baseline", "challenger", "wild-card"] as const;
export const APPROACH_UPSIDE_VALUES = ["low", "modest", "high", "higher"] as const;
export const REQUIREMENT_PRIORITY_VALUES = ["P0", "P1", "P2", "P3", "DROPPED"] as const;

export function normalizeTableToken(value: string): string {
  return value
    .replace(/[`*_]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-");
}

export function columnIndex(header: string[], expected: string): number {
  return header.findIndex((cell) => normalizeTableToken(cell) === expected);
}

export function validateApproachesTaxonomy(sectionBody: string): {
  rowCount: number;
  roleUpsideOk: boolean;
  challengerOk: boolean;
  details: string;
} {
  const header = tableHeaderCells(sectionBody);
  const rows = getMarkdownTableRows(sectionBody);
  if (!header) {
    return {
      rowCount: 0,
      roleUpsideOk: false,
      challengerOk: false,
      details: "Approaches must be a markdown table with canonical Role and Upside columns."
    };
  }

  const roleIndex = columnIndex(header, "role");
  const upsideIndex = columnIndex(header, "upside");
  if (roleIndex < 0 || upsideIndex < 0) {
    const firstColumnTokens = rows.map((row) => normalizeTableToken(row[0] ?? ""));
    const appearsTransposed = firstColumnTokens.includes("role") || firstColumnTokens.includes("upside");
    return {
      rowCount: rows.length,
      roleUpsideOk: false,
      challengerOk: false,
      details: appearsTransposed
        ? "Approaches table appears transposed: `Role`/`Upside` are rows, but must be columns. Use `| Approach | Role | Upside | ... |` with one approach per row."
        : "Approaches table must include canonical `Role` and `Upside` columns (Role: baseline | challenger | wild-card; Upside: low | modest | high | higher)."
    };
  }

  let challengerRows = 0;
  let challengerHasHighUpside = false;
  for (const [index, row] of rows.entries()) {
    const role = normalizeTableToken(row[roleIndex] ?? "");
    const upside = normalizeTableToken(row[upsideIndex] ?? "");
    if (!APPROACH_ROLE_VALUES.includes(role as (typeof APPROACH_ROLE_VALUES)[number])) {
      return {
        rowCount: rows.length,
        roleUpsideOk: false,
        challengerOk: false,
        details: `Approaches row ${index + 1} has invalid Role "${row[roleIndex] ?? ""}". Expected one of: ${APPROACH_ROLE_VALUES.join(", ")}.`
      };
    }
    if (!APPROACH_UPSIDE_VALUES.includes(upside as (typeof APPROACH_UPSIDE_VALUES)[number])) {
      return {
        rowCount: rows.length,
        roleUpsideOk: false,
        challengerOk: false,
        details: `Approaches row ${index + 1} has invalid Upside "${row[upsideIndex] ?? ""}". Expected one of: ${APPROACH_UPSIDE_VALUES.join(", ")}.`
      };
    }
    if (role === "challenger") {
      challengerRows += 1;
      if (upside === "high" || upside === "higher") {
        challengerHasHighUpside = true;
      }
    }
  }

  const challengerOk = challengerRows === 1 && challengerHasHighUpside;
  return {
    rowCount: rows.length,
    roleUpsideOk: true,
    challengerOk,
    details: challengerOk
      ? "Approaches table uses canonical Role/Upside values and exactly one high/higher-upside challenger."
      : `Approaches table must include exactly one challenger row with Upside high or higher. Found ${challengerRows} challenger row(s).`
  };
}

export function validateCalibratedSelfReview(sectionBody: string): { ok: boolean; details: string } {
  const statusLineMatch = /^\s*-\s*Status:\s*(.*)$/imu.exec(sectionBody);
  const statusValue = statusLineMatch ? statusLineMatch[1].trim() : "";
  const mentionsApproved = /\bApproved\b/iu.test(statusValue);
  const mentionsIssuesFound = /\bIssues Found\b/iu.test(statusValue);
  const statusPickedExactlyOne =
    statusLineMatch !== null && (mentionsApproved !== mentionsIssuesFound);

  const hasPatchesHeader = /^\s*-\s*Patches applied:/imu.test(sectionBody);
  const hasConcernsHeader = /^\s*-\s*Remaining concerns:/imu.test(sectionBody);

  if (statusPickedExactlyOne && hasPatchesHeader && hasConcernsHeader) {
    return {
      ok: true,
      details: "Self-Review Notes use the calibrated review prompt format."
    };
  }

  const problems: string[] = [];
  if (!statusLineMatch) {
    problems.push("missing `- Status:` line");
  } else if (!mentionsApproved && !mentionsIssuesFound) {
    problems.push("`- Status:` must include `Approved` or `Issues Found`");
  } else if (mentionsApproved && mentionsIssuesFound) {
    problems.push(
      "`- Status:` must pick exactly one of `Approved` or `Issues Found` (the placeholder `Approved | Issues Found` is not a decision)"
    );
  }
  if (!hasPatchesHeader) problems.push("missing `- Patches applied:` line");
  if (!hasConcernsHeader) problems.push("missing `- Remaining concerns:` line");

  return {
    ok: false,
    details:
      "Self-Review Notes must use the calibrated review prompt format: `- Status: Approved` (or `Issues Found`), `- Patches applied:` (inline note or sub-bullets), and `- Remaining concerns:` (inline note or sub-bullets). Issues: " +
      problems.join("; ") +
      "."
  };
}

export function validateRequirementsTaxonomy(sectionBody: string): { ok: boolean; details: string } {
  const header = tableHeaderCells(sectionBody);
  if (!header) {
    return {
      ok: false,
      details: "Requirements must be a markdown table with a Priority column."
    };
  }
  const priorityIndex = columnIndex(header, "priority");
  if (priorityIndex < 0) {
    return {
      ok: false,
      details: "Requirements table must include a canonical `Priority` column."
    };
  }
  const rows = getMarkdownTableRows(sectionBody);
  if (rows.length === 0) {
    return {
      ok: false,
      details: "Requirements table must include at least one requirement row."
    };
  }
  for (const [index, row] of rows.entries()) {
    const rawPriority = (row[priorityIndex] ?? "").replace(/[`*_]/gu, "").trim().toUpperCase();
    if (!REQUIREMENT_PRIORITY_VALUES.includes(rawPriority as (typeof REQUIREMENT_PRIORITY_VALUES)[number])) {
      return {
        ok: false,
        details: `Requirements row ${index + 1} has invalid Priority "${row[priorityIndex] ?? ""}". Expected one of: ${REQUIREMENT_PRIORITY_VALUES.join(", ")}.`
      };
    }
  }
  return {
    ok: true,
    details: "Requirements table uses canonical Priority values."
  };
}

export function validateLockedDecisionAnchors(sectionBody: string): { ok: boolean; anchors: string[]; details: string } {
  const rows = getMarkdownTableRows(sectionBody);
  const lines = sectionBody
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/u.test(line));
  const anchors: string[] = [];
  const issues: string[] = [];

  for (const [index, row] of rows.entries()) {
    const anchor = (row[0] ?? "").trim().toLowerCase();
    const decisionText = (row[1] ?? "").trim();
    if (!/^ld#[0-9a-f]{8}$/u.test(anchor)) {
      issues.push(`row ${index + 1} has invalid anchor "${row[0] ?? ""}"`);
      continue;
    }
    anchors.push(anchor);
    if (decisionText.length > 0) {
      const expected = lockedDecisionHash(decisionText).toLowerCase();
      if (anchor !== expected) {
        issues.push(`row ${index + 1} anchor should be ${expected} for its Decision text`);
      }
    }
  }

  for (const [index, line] of lines.entries()) {
    const anchor = /\bLD#[0-9a-f]{8}\b/iu.exec(line)?.[0]?.toLowerCase();
    if (!anchor) {
      issues.push(`bullet ${index + 1} is missing an LD#<sha8> anchor`);
      continue;
    }
    anchors.push(anchor);
  }

  const duplicateAnchors = [...new Set(anchors.filter((anchor, index) => anchors.indexOf(anchor) !== index))];
  if (duplicateAnchors.length > 0) {
    issues.push(`duplicate anchors: ${duplicateAnchors.join(", ")}`);
  }
  if (anchors.length === 0 && (rows.length > 0 || lines.length > 0)) {
    issues.push("no LD#<sha8> anchors found");
  }

  return {
    ok: issues.length === 0,
    anchors: [...new Set(anchors)],
    details: issues.length === 0
      ? `${anchors.length} LD#hash anchor(s) recorded with no duplicates.`
      : issues.join("; ")
  };
}

export interface InteractionEdgeCaseRequirement {
  label: string;
  pattern: RegExp;
}

export const INTERACTION_EDGE_CASE_REQUIREMENTS: readonly InteractionEdgeCaseRequirement[] = [
  { label: "double-click", pattern: /\bdouble[\s-]?click\b/iu },
  {
    label: "nav-away-mid-request",
    pattern: /\b(?:nav(?:igate)?[\s-]?away(?:[\s-]?mid[\s-]?request)?|leave\s+(?:page|view|screen).*(?:request|save|submit)|close\s+tab.*(?:request|save|submit))\b/iu
  },
  {
    label: "10K-result dataset",
    pattern: /\b(?:10k(?:[\s-]?result)?|10,?000|large[\s-]?result(?:[\s-]?dataset)?)\b/iu
  },
  {
    label: "background-job abandonment",
    pattern: /\b(?:background[\s-]?job.*abandon(?:ed|ment)?|abandon(?:ed|ment)?.*background[\s-]?job)\b/iu
  },
  { label: "zombie connection", pattern: /\bzombie[\s-]?connection\b/iu }
];

export function validateInteractionEdgeCaseMatrix(sectionBody: string): { ok: boolean; details: string } {
  const rows = getMarkdownTableRows(sectionBody);
  if (rows.length === 0) {
    return {
      ok: false,
      details: "Data Flow must include an Interaction Edge Case matrix table with required rows."
    };
  }

  const seen = new Map<string, true>();
  for (const [index, row] of rows.entries()) {
    const labelCell = (row[0] ?? "").trim();
    if (!labelCell) continue;
    const requirement = INTERACTION_EDGE_CASE_REQUIREMENTS.find((candidate) =>
      candidate.pattern.test(labelCell)
    );
    if (!requirement) continue;

    if (row.length < 4) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" must include 4 columns: Edge case | Handled? | Design response | Deferred item.`
      };
    }

    const handled = parseBinaryFlag((row[1] ?? "").trim());
    const response = (row[2] ?? "").trim();
    const deferred = (row[3] ?? "").trim();
    if (handled === "unknown") {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" must mark Handled? as yes/no.`
      };
    }
    if (!response) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" must describe the design response.`
      };
    }
    if (handled === "no" && (!deferred || /\bnone\b/iu.test(deferred))) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" is unhandled and must reference a deferred item id (for example D-12).`
      };
    }
    seen.set(requirement.label, true);
  }

  const missing = INTERACTION_EDGE_CASE_REQUIREMENTS
    .map((requirement) => requirement.label)
    .filter((label) => !seen.has(label));
  if (missing.length > 0) {
    return {
      ok: false,
      details: `Interaction Edge Case matrix is missing required row(s): ${missing.join(", ")}.`
    };
  }
  return {
    ok: true,
    details: "Interaction Edge Case matrix contains all required rows with handled/deferred status."
  };
}

export const PRE_SCOPE_AUDIT_SIGNALS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "git log -30 --oneline", pattern: /\bgit\s+log\b[^\n]*-30[^\n]*\boneline\b/iu },
  { label: "git diff --stat", pattern: /\bgit\s+diff\b[^\n]*--stat\b/iu },
  { label: "git stash list", pattern: /\bgit\s+stash\s+list\b/iu },
  {
    label: "debt marker scan (TODO|FIXME|XXX|HACK)",
    pattern: /\b(?:rg|ripgrep)\b[^\n]*(?:TODO|FIXME|XXX|HACK)|\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/iu
  }
];

export function validatePreScopeSystemAudit(sectionBody: string): { ok: boolean; details: string } {
  const missing = PRE_SCOPE_AUDIT_SIGNALS
    .filter((signal) => !signal.pattern.test(sectionBody))
    .map((signal) => signal.label);
  if (missing.length > 0) {
    return {
      ok: false,
      details: `Pre-Scope System Audit is missing required signal(s): ${missing.join(", ")}.`
    };
  }
  return {
    ok: true,
    details: "Pre-Scope System Audit captures git log/diff/stash/debt-marker checks."
  };
}

export const DIAGRAM_ARROW_PATTERN = /(?:<--?>|<?==?>|--?>|->>|=>|-\.->|→|⟶|↦)/u;
export const DIAGRAM_FAILURE_EDGE_PATTERN = /\b(fail(?:ed|ure)?|error|timeout|fallback|degrad(?:e|ed|ation)|retry|backoff|circuit|unavailable|recover(?:y)?|rescue|mitigat(?:e|ion)|rollback|exception|abort|dead[\s-]?letter|dlq)\b/iu;
export const DIAGRAM_GENERIC_NODE_PATTERN = /\b(service|component|module|system)\s*(?:[A-Z0-9])?\b/iu;
export const TEST_COMMAND_MARKER_PATTERN = /\b(?:npm|pnpm|yarn|bun|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|dotnet test)\b/iu;
export const RED_FAILURE_MARKER_PATTERN = /\b(?:fail|failed|failing|assertionerror|cannot find|exception|error|exit code\s*[:=]?\s*[1-9])\b/iu;
export const GREEN_SUCCESS_MARKER_PATTERN = /\b(?:pass|passed|green|ok|0 failed|exit code\s*[:=]?\s*0)\b/iu;

export function diagramEdgeLines(sectionBody: string): string[] {
  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !line.startsWith("%%"))
    .filter((line) => DIAGRAM_ARROW_PATTERN.test(line));
}

export function hasFailureEdgeInDiagram(sectionBody: string): boolean {
  const lines = diagramEdgeLines(sectionBody);
  for (const line of lines) {
    if (DIAGRAM_ARROW_PATTERN.test(line) && DIAGRAM_FAILURE_EDGE_PATTERN.test(line)) {
      return true;
    }
  }
  return false;
}

export function hasLabeledDiagramArrow(lines: string[]): boolean {
  return lines.some((line) => /\|[^|]+\|/u.test(line) || /:\s*[A-Za-z]/u.test(line));
}

export function hasAsyncDiagramEdge(lines: string[]): boolean {
  return lines.some((line) => /-\.->|-->>|~~>|\basync\b/iu.test(line));
}

export function hasSyncDiagramEdge(lines: string[]): boolean {
  return lines.some((line) => {
    if (/\bsync\b/iu.test(line)) return true;
    if (!/(-->|->|=>|→|⟶|↦)/u.test(line)) return false;
    return !/-\.->|-->>|~~>/u.test(line);
  });
}

export function validateTddRedEvidence(sectionBody: string): { ok: boolean; details: string } {
  const meaningful = meaningfulLineCount(sectionBody);
  if (meaningful < 2) {
    return {
      ok: false,
      details: "RED Evidence must include at least 2 meaningful lines (command plus failing output context)."
    };
  }
  if (!TEST_COMMAND_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "RED Evidence must include the test command that produced the failure."
    };
  }
  if (!RED_FAILURE_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "RED Evidence must include explicit failing output markers (FAIL/FAILED/AssertionError/exit code != 0)."
    };
  }
  return {
    ok: true,
    details: "RED Evidence includes command + failing output markers."
  };
}

export function validateTddGreenEvidence(sectionBody: string): { ok: boolean; details: string } {
  const meaningful = meaningfulLineCount(sectionBody);
  if (meaningful < 2) {
    return {
      ok: false,
      details: "GREEN Evidence must include at least 2 meaningful lines (command and passing result)."
    };
  }
  if (!TEST_COMMAND_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "GREEN Evidence must include the full-suite test command."
    };
  }
  if (!GREEN_SUCCESS_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "GREEN Evidence must include explicit passing markers (PASS/PASSED/OK/exit code 0)."
    };
  }
  return {
    ok: true,
    details: "GREEN Evidence includes command + passing output markers."
  };
}

export function validateVerificationLadder(sectionBody: string): { ok: boolean; details: string } {
  const hasTextLine = /highest tier reached/iu.test(sectionBody);
  const hasCanonicalTable = hasVerificationLadderTableRow(sectionBody);
  if (!hasTextLine && !hasCanonicalTable) {
    return {
      ok: false,
      details:
        "Verification Ladder must include either a 'Highest tier reached' line or a canonical table row (Slice | Tier reached | Evidence) with non-empty tier and evidence."
    };
  }
  if (!/\b(static|command|behavioral|human)\b/iu.test(sectionBody)) {
    return {
      ok: false,
      details: "Verification Ladder must name a tier (static | command | behavioral | human)."
    };
  }
  if (!/\b(evidence|command|sha|commit)\b/iu.test(sectionBody)) {
    return {
      ok: false,
      details: "Verification Ladder must include evidence details (command output or commit SHA)."
    };
  }
  return {
    ok: true,
    details: "Verification Ladder includes tier + evidence fields."
  };
}

export function hasVerificationLadderTableRow(sectionBody: string): boolean {
  const lines = sectionBody.split(/\r?\n/u);
  let sawHeader = false;
  let sawSeparator = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      sawHeader = false;
      sawSeparator = false;
      continue;
    }
    const cells = trimmed
      .replace(/^\|/u, "")
      .replace(/\|$/u, "")
      .split("|")
      .map((cell) => cell.trim());
    if (!sawHeader) {
      const lowered = cells.map((cell) => cell.toLowerCase());
      const hasTierColumn = lowered.some((cell) => /tier(?:\s+reached)?/u.test(cell));
      const hasEvidenceColumn = lowered.some((cell) => cell.includes("evidence"));
      if (hasTierColumn && hasEvidenceColumn) {
        sawHeader = true;
        continue;
      }
      continue;
    }
    if (!sawSeparator) {
      if (cells.every((cell) => /^[:\-\s]+$/u.test(cell))) {
        sawSeparator = true;
        continue;
      }
      sawHeader = false;
      continue;
    }
    if (cells.length >= 2 && cells.some((cell) => /\b(static|command|behavioral|human)\b/iu.test(cell))) {
      const evidenceCellHasContent = cells.some((cell) => cell.length > 0 && !/^\s*$/u.test(cell) && !/^[:\-\s]+$/u.test(cell));
      if (evidenceCellHasContent) {
        return true;
      }
    }
  }
  return false;
}

export type LearningEntryType = "rule" | "pattern" | "lesson" | "compound";
export type LearningConfidence = "high" | "medium" | "low";
export type LearningSeverity = "critical" | "important" | "suggestion";
export type LearningSource = "stage" | "retro" | "compound" | "idea" | "manual";

export interface LearningSeedEntry {
  type: LearningEntryType;
  trigger: string;
  action: string;
  confidence: LearningConfidence;
  severity?: LearningSeverity;
  stage?: FlowStage | null;
  origin_stage?: FlowStage | null;
  frequency?: number;
  created?: string;
  first_seen_ts?: string;
  last_seen_ts?: string;
  project?: string | null;
  source?: LearningSource | null;
}

export interface LearningsParseResult {
  ok: boolean;
  none: boolean;
  entries: LearningSeedEntry[];
  errors: string[];
  details: string;
}

export const LEARNING_TYPE_SET = new Set<LearningEntryType>(["rule", "pattern", "lesson", "compound"]);
export const LEARNING_CONFIDENCE_SET = new Set<LearningConfidence>(["high", "medium", "low"]);
export const LEARNING_SEVERITY_SET = new Set<LearningSeverity>(["critical", "important", "suggestion"]);
export const LEARNING_SOURCE_SET = new Set<LearningSource>([
  "stage",
  "retro",
  "compound",
  "idea",
  "manual"
]);
export const FLOW_STAGE_SET = new Set<FlowStage>(FLOW_STAGES);
export const LEARNING_ALLOWED_KEYS = new Set([
  "type",
  "trigger",
  "action",
  "confidence",
  "severity",
  "stage",
  "origin_stage",
  "frequency",
  "created",
  "first_seen_ts",
  "last_seen_ts",
  "project",
  "source"
]);

export function isIsoUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isNullableStage(value: unknown): value is FlowStage | null {
  return value === null || (typeof value === "string" && FLOW_STAGE_SET.has(value as FlowStage));
}

export function parseLearningSeedEntry(raw: unknown, index: number): { ok: boolean; entry?: LearningSeedEntry; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `Learnings bullet #${index} must be a JSON object.` };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!LEARNING_ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        error: `Learnings bullet #${index} includes unknown key "${key}" (allowed keys mirror knowledge JSONL fields).`
      };
    }
  }

  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (!LEARNING_TYPE_SET.has(type as LearningEntryType)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must set type to one of: rule, pattern, lesson, compound.`
    };
  }

  const trigger = typeof obj.trigger === "string" ? obj.trigger.trim() : "";
  if (trigger.length === 0) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must include non-empty "trigger".`
    };
  }

  const action = typeof obj.action === "string" ? obj.action.trim() : "";
  if (action.length === 0) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must include non-empty "action".`
    };
  }

  const confidence = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
  if (!LEARNING_CONFIDENCE_SET.has(confidence as LearningConfidence)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must set confidence to high|medium|low.`
    };
  }
  const severity = typeof obj.severity === "string" ? obj.severity.toLowerCase() : undefined;
  if (severity !== undefined && !LEARNING_SEVERITY_SET.has(severity as LearningSeverity)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "severity" must be critical|important|suggestion.`
    };
  }

  if (obj.stage !== undefined && !isNullableStage(obj.stage)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "stage" must be one of ${FLOW_STAGES.join(", ")} or null.`
    };
  }
  if (obj.origin_stage !== undefined && !isNullableStage(obj.origin_stage)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "origin_stage" must be one of ${FLOW_STAGES.join(", ")} or null.`
    };
  }
  if (obj.project !== undefined && !isNullableString(obj.project)) {
    return { ok: false, error: `Learnings bullet #${index} field "project" must be string or null.` };
  }
  if (
    obj.source !== undefined &&
    obj.source !== null &&
    (typeof obj.source !== "string" || !LEARNING_SOURCE_SET.has(obj.source as LearningSource))
  ) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "source" must be stage|retro|compound|idea|manual or null.`
    };
  }
  if (
    obj.frequency !== undefined &&
    (typeof obj.frequency !== "number" || !Number.isInteger(obj.frequency) || obj.frequency < 1)
  ) {
    return { ok: false, error: `Learnings bullet #${index} field "frequency" must be an integer >= 1.` };
  }
  for (const timestampField of ["created", "first_seen_ts", "last_seen_ts"] as const) {
    const value = obj[timestampField];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isIsoUtcTimestamp(value)) {
      return {
        ok: false,
        error: `Learnings bullet #${index} field "${timestampField}" must be ISO UTC (YYYY-MM-DDTHH:MM:SSZ).`
      };
    }
  }

  return {
    ok: true,
    entry: {
      ...obj,
      type: type as LearningEntryType,
      trigger,
      action,
      confidence: confidence as LearningConfidence,
      ...(severity ? { severity: severity as LearningSeverity } : {})
    } as LearningSeedEntry
  };
}

export function parseLearningsSection(sectionBody: string): LearningsParseResult {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);
  const bullets = nonEmpty.filter((line) => /^-\s+\S+/u.test(line));

  if (bullets.length === 0) {
    return {
      ok: false,
      none: false,
      entries: [],
      errors: ["Learnings section must contain bullet entries."],
      details: "Learnings section must contain bullet entries."
    };
  }

  const nonBulletContent = nonEmpty.filter((line) => !/^-\s+\S+/u.test(line));
  if (nonBulletContent.length > 0) {
    return {
      ok: false,
      none: false,
      entries: [],
      errors: ["Learnings section must only contain bullet lines (one bullet per learning)."],
      details: "Learnings section must only contain bullet lines (one bullet per learning)."
    };
  }

  if (bullets.length === 1) {
    const payload = bullets[0]!.replace(/^-\s+/u, "").trim();
    if (/^none this stage\.?$/iu.test(payload)) {
      return {
        ok: true,
        none: true,
        entries: [],
        errors: [],
        details: "Learnings section explicitly marked as none."
      };
    }
  }

  const entries: LearningSeedEntry[] = [];
  const errors: string[] = [];
  for (let i = 0; i < bullets.length; i += 1) {
    const payload = bullets[i]!.replace(/^-\s+/u, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      errors.push(
        `Learnings bullet #${i + 1} must be valid JSON object or "None this stage.": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      continue;
    }
    const parsedEntry = parseLearningSeedEntry(parsed, i + 1);
    if (!parsedEntry.ok || !parsedEntry.entry) {
      errors.push(parsedEntry.error ?? `Learnings bullet #${i + 1} is invalid.`);
      continue;
    }
    entries.push(parsedEntry.entry);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      none: false,
      entries: [],
      errors,
      details: errors.join(" | ")
    };
  }

  return {
    ok: true,
    none: false,
    entries,
    errors: [],
    details: `Parsed ${entries.length} learning bullet(s) as knowledge-compatible JSON entries.`
  };
}

export function lineContainsVagueAdjective(text: string): string | null {
  const lower = text.toLowerCase();
  for (const adjective of VAGUE_AC_ADJECTIVES) {
    const pattern = new RegExp(`(?:^|[^A-Za-z])${adjective.replace(/ /g, "\\s+")}(?:[^A-Za-z]|$)`, "iu");
    if (pattern.test(lower)) return adjective;
  }
  return null;
}

export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  values: Record<string, string>;
}

export const FRONTMATTER_REQUIRED_KEYS = [
  "stage",
  "schema_version",
  "version",
  "locked_decisions",
  "inputs_hash"
] as const;

export const PLACEHOLDER_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "TODO", regex: /\bTODO\b/iu },
  { label: "TBD", regex: /\bTBD\b/iu },
  { label: "FIXME", regex: /\bFIXME\b/iu },
  { label: "<fill-in>", regex: /<fill-in>/iu },
  { label: "<your-*-here>", regex: /<your-[^>]*-here>/iu },
  { label: "xxx", regex: /\bxxx\b/iu },
  { label: "ellipsis", regex: /\.{3}/u }
];

export const SCOPE_REDUCTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "v1", regex: /\bv1\b/iu },
  { label: "for now", regex: /\bfor now\b/iu },
  { label: "later", regex: /\blater\b/iu },
  { label: "temporary", regex: /\btemporary\b/iu },
  { label: "placeholder", regex: /\bplaceholder\b/iu },
  { label: "mock for now", regex: /\bmock for now\b/iu },
  { label: "hardcoded for now", regex: /\bhardcoded for now\b/iu },
  { label: "will improve later", regex: /\bwill improve later\b/iu }
];

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { hasFrontmatter: false, values: {} };
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex < 0) {
    return { hasFrontmatter: false, values: {} };
  }
  const values: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim();
    values[key] = value;
  }
  return { hasFrontmatter: true, values };
}

export function extractDecisionIds(text: string): string[] {
  const ids = text.match(/\bD-\d+\b/gu) ?? [];
  return [...new Set(ids)];
}

export function extractRequirementIdsFromMarkdown(text: string): string[] {
  const ids = text.match(/\bR\d+\b/gu) ?? [];
  return [...new Set(ids)];
}

export function extractLockedDecisionAnchors(text: string): string[] {
  const ids = text.match(/\bLD#[0-9a-f]{8}\b/giu) ?? [];
  return [...new Set(ids.map((id) => id.replace(/^LD#/iu, "LD#").toLowerCase()))];
}

export function lockedDecisionHash(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim().toLowerCase();
  return `LD#${createHash("sha256").update(normalized).digest("hex").slice(0, 8)}`;
}

export function collectPatternHits(
  text: string,
  patterns: Array<{ label: string; regex: RegExp }>
): string[] {
  const hits: string[] = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      hits.push(pattern.label);
    }
  }
  return hits;
}

export function validateSectionBody(
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

  const sectionNameNormalized = normalizeHeadingTitle(sectionName).toLowerCase();
  if (sectionNameNormalized === "red evidence") {
    return validateTddRedEvidence(sectionBody);
  }
  if (sectionNameNormalized === "green evidence") {
    return validateTddGreenEvidence(sectionBody);
  }
  if (sectionNameNormalized === "verification ladder") {
    return validateVerificationLadder(sectionBody);
  }
  if (sectionNameNormalized === "failure mode table") {
    return validateFailureModeTable(sectionBody);
  }
  if (sectionNameNormalized === "pre-scope system audit") {
    return validatePreScopeSystemAudit(sectionBody);
  }
  if (sectionNameNormalized === "scope summary") {
    return validateScopeSummary(sectionBody);
  }
  if (sectionNameNormalized === "premise challenge") {
    return validatePremiseChallenge(sectionBody);
  }
  if (sectionNameNormalized.startsWith("requirements")) {
    return validateRequirementsTaxonomy(sectionBody);
  }
  if (sectionNameNormalized === "data flow") {
    return validateInteractionEdgeCaseMatrix(sectionBody);
  }
  if (sectionNameNormalized === "architecture diagram") {
    const edgeLines = diagramEdgeLines(sectionBody);
    if (edgeLines.length === 0) {
      return {
        ok: false,
        details: "Architecture Diagram must include at least one directional edge line (for example `A -->|action| B`)."
      };
    }
    if (!hasLabeledDiagramArrow(edgeLines)) {
      return {
        ok: false,
        details: "Architecture Diagram must label each edge with an action/message (for example `A -->|sync: persist| B`)."
      };
    }
    const genericLine = edgeLines.find((line) => DIAGRAM_GENERIC_NODE_PATTERN.test(line));
    if (genericLine) {
      return {
        ok: false,
        details: `Architecture Diagram uses a generic node label in edge "${genericLine}". Use concrete component names instead of placeholders like Service/Component.`
      };
    }
    if (!hasAsyncDiagramEdge(edgeLines) || !hasSyncDiagramEdge(edgeLines)) {
      return {
        ok: false,
        details: "Architecture Diagram must distinguish sync vs async edges (for example solid + dotted arrows, or `sync:` and `async:` labels)."
      };
    }
    if (!hasFailureEdgeInDiagram(sectionBody)) {
      return {
        ok: false,
        details: "Architecture Diagram must include at least one failure-edge arrow with a failure keyword (for example: timeout, error, fallback, degraded, retry)."
      };
    }
  }

  if (
    sectionNameNormalized === "acceptance criteria" &&
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


export interface StageLintContext {
  projectRoot: string;
  stage: FlowStage;
  track: FlowTrack;
  raw: string;
  absFile: string;
  sections: H2SectionMap;
  findings: LintFinding[];
  parsedFrontmatter: ParsedFrontmatter;
  brainstormShortCircuitBody: string | null;
  brainstormShortCircuitActivated: boolean;
  scopePreAuditEnabled: boolean;
  staleDiagramAuditEnabled: boolean;
  isTrivialOverride: boolean;
  overrideSet: Set<string> | null;
}
