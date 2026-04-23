import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath as resolveStageArtifactPath } from "./artifact-paths.js";
import { RUNTIME_ROOT, SHIP_FINALIZATION_MODES } from "./constants.js";
import { exists } from "./fs-utils.js";
import { stageSchema } from "./content/stage-schema.js";
import { FLOW_STAGES, type FlowStage, type FlowTrack } from "./types.js";

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

async function resolveNamedArtifactPath(projectRoot: string, fileName: string): Promise<ResolvedArtifactPath> {
  const relPath = path.join(RUNTIME_ROOT, "artifacts", fileName);
  const absPath = path.join(projectRoot, relPath);
  return { absPath, relPath };
}

function normalizeHeadingTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

type H2SectionMap = Map<string, string>;

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
function extractH2Sections(markdown: string): H2SectionMap {
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

export function extractMarkdownSectionBody(markdown: string, section: string): string | null {
  return sectionBodyByName(extractH2Sections(markdown), section);
}

function headingLineIndex(markdown: string, section: string): number {
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
    return [...SHIP_FINALIZATION_MODES];
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

type BinaryFlag = "yes" | "no" | "unknown";

function parseBinaryFlag(value: string): BinaryFlag {
  const normalized = value.trim().toLowerCase();
  if (/^(?:y|yes|true|1)$/u.test(normalized)) return "yes";
  if (/^(?:n|no|false|0|none)$/u.test(normalized)) return "no";
  return "unknown";
}

function parseKeyedBinaryFlag(value: string, key: string): BinaryFlag {
  const match = new RegExp(`${key}\\s*=\\s*(y|yes|true|1|n|no|false|0)`, "iu").exec(value);
  if (!match) return "unknown";
  return /^(?:y|yes|true|1)$/iu.test(match[1] ?? "") ? "yes" : "no";
}

function parseFailureModeRescueFlag(rescueCell: string): BinaryFlag {
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

function parseFailureModeTestFlag(rowText: string): BinaryFlag {
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

function validateFailureModeTable(sectionBody: string): { ok: boolean; details: string } {
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

const DIAGRAM_ARROW_PATTERN = /(?:<--?>|<?==?>|--?>|->>|=>|-\.->|→|⟶|↦)/u;
const DIAGRAM_FAILURE_EDGE_PATTERN = /\b(fail(?:ed|ure)?|error|timeout|fallback|degrad(?:e|ed|ation)|retry|backoff|circuit|unavailable|recover(?:y)?|rescue|mitigat(?:e|ion)|rollback|exception|abort|dead[\s-]?letter|dlq)\b/iu;
const DIAGRAM_GENERIC_NODE_PATTERN = /\b(service|component|module|system)\s*(?:[A-Z0-9])?\b/iu;
const TEST_COMMAND_MARKER_PATTERN = /\b(?:npm|pnpm|yarn|bun|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|dotnet test)\b/iu;
const RED_FAILURE_MARKER_PATTERN = /\b(?:fail|failed|failing|assertionerror|cannot find|exception|error|exit code\s*[:=]?\s*[1-9])\b/iu;
const GREEN_SUCCESS_MARKER_PATTERN = /\b(?:pass|passed|green|ok|0 failed|exit code\s*[:=]?\s*0)\b/iu;

function diagramEdgeLines(sectionBody: string): string[] {
  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !line.startsWith("%%"))
    .filter((line) => DIAGRAM_ARROW_PATTERN.test(line));
}

function hasFailureEdgeInDiagram(sectionBody: string): boolean {
  const lines = diagramEdgeLines(sectionBody);
  for (const line of lines) {
    if (DIAGRAM_ARROW_PATTERN.test(line) && DIAGRAM_FAILURE_EDGE_PATTERN.test(line)) {
      return true;
    }
  }
  return false;
}

function hasLabeledDiagramArrow(lines: string[]): boolean {
  return lines.some((line) => /\|[^|]+\|/u.test(line) || /:\s*[A-Za-z]/u.test(line));
}

function hasAsyncDiagramEdge(lines: string[]): boolean {
  return lines.some((line) => /-\.->|-->>|~~>|\basync\b/iu.test(line));
}

function hasSyncDiagramEdge(lines: string[]): boolean {
  return lines.some((line) => {
    if (/\bsync\b/iu.test(line)) return true;
    if (!/(-->|->|=>|→|⟶|↦)/u.test(line)) return false;
    return !/-\.->|-->>|~~>/u.test(line);
  });
}

function validateTddRedEvidence(sectionBody: string): { ok: boolean; details: string } {
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

function validateTddGreenEvidence(sectionBody: string): { ok: boolean; details: string } {
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

function validateVerificationLadder(sectionBody: string): { ok: boolean; details: string } {
  if (!/highest tier reached/iu.test(sectionBody)) {
    return {
      ok: false,
      details: "Verification Ladder must include a 'Highest tier reached' line."
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

export type LearningEntryType = "rule" | "pattern" | "lesson" | "compound";
export type LearningConfidence = "high" | "medium" | "low";
export type LearningSeverity = "critical" | "important" | "suggestion";
export type LearningUniversality = "project" | "personal" | "universal";
export type LearningMaturity = "raw" | "lifted-to-rule" | "lifted-to-enforcement";
export type LearningSource = "stage" | "retro" | "compound" | "ideate" | "manual";

export interface LearningSeedEntry {
  type: LearningEntryType;
  trigger: string;
  action: string;
  confidence: LearningConfidence;
  severity?: LearningSeverity;
  domain?: string | null;
  stage?: FlowStage | null;
  origin_stage?: FlowStage | null;
  origin_feature?: string | null;
  frequency?: number;
  universality?: LearningUniversality;
  maturity?: LearningMaturity;
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

const LEARNING_TYPE_SET = new Set<LearningEntryType>(["rule", "pattern", "lesson", "compound"]);
const LEARNING_CONFIDENCE_SET = new Set<LearningConfidence>(["high", "medium", "low"]);
const LEARNING_SEVERITY_SET = new Set<LearningSeverity>(["critical", "important", "suggestion"]);
const LEARNING_UNIVERSALITY_SET = new Set<LearningUniversality>(["project", "personal", "universal"]);
const LEARNING_MATURITY_SET = new Set<LearningMaturity>(["raw", "lifted-to-rule", "lifted-to-enforcement"]);
const LEARNING_SOURCE_SET = new Set<LearningSource>([
  "stage",
  "retro",
  "compound",
  "ideate",
  "manual"
]);
const FLOW_STAGE_SET = new Set<FlowStage>(FLOW_STAGES);
const LEARNING_ALLOWED_KEYS = new Set([
  "type",
  "trigger",
  "action",
  "confidence",
  "severity",
  "domain",
  "stage",
  "origin_stage",
  "origin_feature",
  "frequency",
  "universality",
  "maturity",
  "created",
  "first_seen_ts",
  "last_seen_ts",
  "project",
  "source"
]);

function isIsoUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableStage(value: unknown): value is FlowStage | null {
  return value === null || (typeof value === "string" && FLOW_STAGE_SET.has(value as FlowStage));
}

function parseLearningSeedEntry(raw: unknown, index: number): { ok: boolean; entry?: LearningSeedEntry; error?: string } {
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

  if (obj.domain !== undefined && !isNullableString(obj.domain)) {
    return { ok: false, error: `Learnings bullet #${index} field "domain" must be string or null.` };
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
  if (obj.origin_feature !== undefined && !isNullableString(obj.origin_feature)) {
    return { ok: false, error: `Learnings bullet #${index} field "origin_feature" must be string or null.` };
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
      error: `Learnings bullet #${index} field "source" must be stage|retro|compound|ideate|manual or null.`
    };
  }
  if (
    obj.frequency !== undefined &&
    (typeof obj.frequency !== "number" || !Number.isInteger(obj.frequency) || obj.frequency < 1)
  ) {
    return { ok: false, error: `Learnings bullet #${index} field "frequency" must be an integer >= 1.` };
  }
  if (
    obj.universality !== undefined &&
    (typeof obj.universality !== "string" ||
      !LEARNING_UNIVERSALITY_SET.has(obj.universality as LearningUniversality))
  ) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "universality" must be project|personal|universal.`
    };
  }
  if (
    obj.maturity !== undefined &&
    (typeof obj.maturity !== "string" || !LEARNING_MATURITY_SET.has(obj.maturity as LearningMaturity))
  ) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "maturity" must be raw|lifted-to-rule|lifted-to-enforcement.`
    };
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

function lineContainsVagueAdjective(text: string): string | null {
  const lower = text.toLowerCase();
  for (const adjective of VAGUE_AC_ADJECTIVES) {
    const pattern = new RegExp(`(?:^|[^A-Za-z])${adjective.replace(/ /g, "\\s+")}(?:[^A-Za-z]|$)`, "iu");
    if (pattern.test(lower)) return adjective;
  }
  return null;
}

interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  values: Record<string, string>;
}

const FRONTMATTER_REQUIRED_KEYS = [
  "stage",
  "schema_version",
  "version",
  "feature",
  "locked_decisions",
  "inputs_hash"
] as const;

const PLACEHOLDER_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "TODO", regex: /\bTODO\b/iu },
  { label: "TBD", regex: /\bTBD\b/iu },
  { label: "FIXME", regex: /\bFIXME\b/iu },
  { label: "<fill-in>", regex: /<fill-in>/iu },
  { label: "<your-*-here>", regex: /<your-[^>]*-here>/iu },
  { label: "xxx", regex: /\bxxx\b/iu },
  { label: "ellipsis", regex: /\.{3}/u }
];

const SCOPE_REDUCTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "v1", regex: /\bv1\b/iu },
  { label: "for now", regex: /\bfor now\b/iu },
  { label: "later", regex: /\blater\b/iu },
  { label: "temporary", regex: /\btemporary\b/iu },
  { label: "placeholder", regex: /\bplaceholder\b/iu },
  { label: "mock for now", regex: /\bmock for now\b/iu },
  { label: "hardcoded for now", regex: /\bhardcoded for now\b/iu },
  { label: "will improve later", regex: /\bwill improve later\b/iu }
];

function parseFrontmatter(markdown: string): ParsedFrontmatter {
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

function extractDecisionIds(text: string): string[] {
  const ids = text.match(/\bD-\d+\b/gu) ?? [];
  return [...new Set(ids)];
}

function collectPatternHits(
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

  if (sectionNameNormalized !== "architecture diagram") {
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

export async function lintArtifact(
  projectRoot: string,
  stage: FlowStage,
  track: FlowTrack = "standard"
): Promise<LintResult> {
  const schema = stageSchema(stage, track);
  const { absPath: absFile, relPath: relFile } = await resolveStageArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
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
  const parsedFrontmatter = parseFrontmatter(raw);
  const frontmatterMissingKeys = FRONTMATTER_REQUIRED_KEYS.filter((key) => {
    const value = parsedFrontmatter.values[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
  const frontmatterStage = parsedFrontmatter.values.stage?.replace(/^['"]|['"]$/gu, "");
  const frontmatterSchemaVersion = parsedFrontmatter.values.schema_version?.replace(/^['"]|['"]$/gu, "");
  const frontmatterInputsHash = parsedFrontmatter.values.inputs_hash?.replace(/^['"]|['"]$/gu, "");
  const frontmatterValid =
    parsedFrontmatter.hasFrontmatter &&
    frontmatterMissingKeys.length === 0 &&
    frontmatterStage === stage &&
    frontmatterSchemaVersion === "1" &&
    /^sha256:(?:pending|[a-f0-9]{64})$/iu.test(frontmatterInputsHash ?? "");
  const requireFrontmatter = parsedFrontmatter.hasFrontmatter;
  findings.push({
    section: "Frontmatter",
    required: requireFrontmatter,
    rule: "Artifact must include frontmatter keys (stage, schema_version=1, version, feature, locked_decisions, inputs_hash=sha256:pending|sha256:<64hex>).",
    found: parsedFrontmatter.hasFrontmatter ? frontmatterValid : true,
    details: !parsedFrontmatter.hasFrontmatter
      ? "Legacy artifact without YAML frontmatter (allowed for backward compatibility)."
      : frontmatterMissingKeys.length > 0
        ? `Frontmatter missing required key(s): ${frontmatterMissingKeys.join(", ")}.`
        : frontmatterStage !== stage
          ? `Frontmatter stage must be "${stage}" (found "${frontmatterStage ?? "(missing)"}").`
          : frontmatterSchemaVersion !== "1"
            ? `Frontmatter schema_version must be "1" (found "${frontmatterSchemaVersion ?? "(missing)"}").`
            : !/^sha256:(?:pending|[a-f0-9]{64})$/iu.test(frontmatterInputsHash ?? "")
              ? "Frontmatter inputs_hash must be sha256:pending or sha256:<64 hex chars>."
              : "Frontmatter integrity checks passed."
  });

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

  const learningsBody = sectionBodyByName(sections, "Learnings");
  const requireLearnings = parsedFrontmatter.hasFrontmatter;
  if (learningsBody === null) {
    findings.push({
      section: "Learnings",
      required: requireLearnings,
      rule: "Required for schema-v1 artifacts: include `## Learnings` with bullets of strict JSON objects compatible with knowledge.jsonl schema, or a single `- None this stage.` sentinel.",
      found: false,
      details: "No ## heading matching required section \"Learnings\"."
    });
  } else {
    const learnings = parseLearningsSection(learningsBody);
    findings.push({
      section: "Learnings",
      required: requireLearnings,
      rule: "`## Learnings` must contain either a single `- None this stage.` bullet or JSON bullets compatible with knowledge.jsonl fields (type/trigger/action/confidence required).",
      found: learnings.ok,
      details: learnings.details
    });
  }

  if (stage === "brainstorm") {
    // Brainstorm Iron Law: "NO ARTIFACT IS COMPLETE WITHOUT AN EXPLICITLY
    // APPROVED DIRECTION — SILENCE IS NOT APPROVAL." Previously this was
    // prose-only — nothing failed when the Selected Direction section
    // omitted an approval marker, or when the Approaches table collapsed
    // to a single row (defeating the "2-3 distinct approaches" gate).
    const tierBody = sectionBodyByName(sections, "Approach Tier");
    if (tierBody !== null) {
      const hasTierToken = /\b(?:lightweight|standard|deep)\b/iu.test(tierBody);
      findings.push({
        section: "Approach Tier Classification",
        required: true,
        rule: "Approach Tier must explicitly classify depth as Lightweight, Standard, or Deep.",
        found: hasTierToken,
        details: hasTierToken
          ? "Approach Tier includes a recognized depth token."
          : "Approach Tier is missing a recognized depth token (Lightweight/Standard/Deep)."
      });
    }

    const approachesBody = sectionBodyByName(sections, "Approaches");
    if (approachesBody !== null) {
      const tableRows = getMarkdownTableRows(approachesBody);
      const bulletRows = approachesBody
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /^(?:[-*]|\d+\.)\s+\S/u.test(line));
      const rowCount = Math.max(tableRows.length, bulletRows.length);
      const hasChallengerFromTable = tableRows.some((row) => {
        const joined = row.join(" ");
        return /\bchallenger\b/iu.test(joined) && /\bhigher[-\s]?upside\b/iu.test(joined);
      });
      const hasChallengerFromBullets = bulletRows.some((row) =>
        /\bchallenger\b/iu.test(row) && /\bhigher[-\s]?upside\b/iu.test(row)
      );
      const hasChallenger = hasChallengerFromTable || hasChallengerFromBullets;
      findings.push({
        section: "Distinct Approaches Enforcement",
        required: true,
        rule: "Approaches section must document at least 2 distinct approaches so the Iron Law comparison is meaningful.",
        found: rowCount >= 2,
        details:
          rowCount >= 2
            ? `Detected ${rowCount} approach row(s).`
            : `Detected ${rowCount} approach row(s); at least 2 required.`
      });
      findings.push({
        section: "Challenger Alternative Enforcement",
        required: true,
        rule: "Approaches must include one option labeled `challenger: higher-upside`.",
        found: hasChallenger,
        details: hasChallenger
          ? "Challenger higher-upside alternative detected."
          : "Missing `challenger: higher-upside` alternative in Approaches."
      });
    }

    const reactionBody = sectionBodyByName(sections, "Approach Reaction");
    const reactionIndex = headingLineIndex(raw, "Approach Reaction");
    const directionIndex = headingLineIndex(raw, "Selected Direction");
    if (directionIndex >= 0) {
      const orderOk = reactionIndex >= 0 && reactionIndex < directionIndex;
      findings.push({
        section: "Approach Reaction Ordering",
        required: true,
        rule: "Approach Reaction must appear before Selected Direction (propose -> react -> recommend).",
        found: orderOk,
        details: orderOk
          ? "Approach Reaction appears before Selected Direction."
          : "Approach Reaction must be present before Selected Direction."
      });
    }

    const directionBody = sectionBodyByName(sections, "Selected Direction");
    if (directionBody !== null) {
      const approvalMarker = /\bapprov(?:ed|al)\b/iu.test(directionBody);
      const reactionTrace = /\b(?:reaction|feedback|concern(?:s)?)\b/iu.test(directionBody);
      findings.push({
        section: "Direction Approval Marker",
        required: true,
        rule: "Selected Direction section must state an explicit approval marker (for example `Approval: approved` or `Approved by: user`).",
        found: approvalMarker,
        details: approvalMarker
          ? "Approval marker present in Selected Direction."
          : "No explicit `approved`/`approval` marker found in Selected Direction."
      });
      findings.push({
        section: "Direction Reaction Trace",
        required: true,
        rule: "Selected Direction rationale must reference user reaction/feedback before recommendation.",
        found: reactionTrace,
        details: reactionTrace
          ? "Selected Direction rationale references user reaction/feedback."
          : "Selected Direction rationale does not reference user reaction/feedback."
      });
    }

    const shortCircuitBody = sectionBodyByName(sections, "Short-Circuit Decision");
    if (shortCircuitBody !== null) {
      const shortCircuitLines = shortCircuitBody.split(/\r?\n/u);
      const statusValue = shortCircuitLines
        .map((line) => line.replace(/[*_`]/gu, "").trim())
        .map((line) => /^[-*]?\s*status\s*:\s*(.+)$/iu.exec(line)?.[1] ?? "")
        .find((value) => value.trim().length > 0)?.trim().toLowerCase() ?? "";
      const hasStatus = statusValue.length > 0;
      findings.push({
        section: "Short-Circuit Status",
        required: true,
        rule: "Short-Circuit Decision must include a `Status:` line (`activated` or `bypassed`).",
        found: hasStatus,
        details: hasStatus
          ? `Short-circuit status declared as "${statusValue}".`
          : "Short-Circuit Decision is missing a `Status:` line."
      });
      const activated =
        /^(?:activated|yes|true)$/u.test(statusValue) ||
        /\bstatus\s*:\s*activated\b/iu.test(shortCircuitBody);
      if (activated) {
        const artifactLines = meaningfulLineCount(raw);
        const withinStubLimit = artifactLines <= 30;
        const hasScopeHandoff = /\bscope\b/iu.test(shortCircuitBody);
        findings.push({
          section: "Short-Circuit Stub Size",
          required: true,
          rule: "When short-circuit is activated, brainstorm artifact must remain a <=30 meaningful-line stub.",
          found: withinStubLimit,
          details: withinStubLimit
            ? `Short-circuit stub size within limit (${artifactLines} meaningful lines).`
            : `Short-circuit stub too large (${artifactLines} meaningful lines); expected <= 30.`
        });
        findings.push({
          section: "Short-Circuit Scope Handoff",
          required: true,
          rule: "When short-circuit is activated, the section must explicitly hand off to scope.",
          found: hasScopeHandoff,
          details: hasScopeHandoff
            ? "Short-circuit section includes explicit scope handoff."
            : "Short-circuit section is missing explicit scope handoff guidance."
        });
      }
    }
  }

  if (stage === "plan") {
    const strictPlanGuards =
      parsedFrontmatter.hasFrontmatter ||
      headingPresent(sections, "No-Placeholder Scan") ||
      headingPresent(sections, "No Scope Reduction Language Scan") ||
      headingPresent(sections, "Locked Decision Coverage");
    const taskListBody = sectionBodyByName(sections, "Task List") ?? raw;
    const placeholderHits = collectPatternHits(taskListBody, PLACEHOLDER_PATTERNS);
    findings.push({
      section: "No Placeholder Enforcement",
      required: strictPlanGuards,
      rule: "Task List must not contain placeholders (TODO/TBD/FIXME/<fill-in>/<your-*-here>/xxx/ellipsis).",
      found: placeholderHits.length === 0,
      details:
        placeholderHits.length === 0
          ? "No placeholder tokens detected in Task List."
          : `Detected placeholder token(s) in Task List: ${placeholderHits.join(", ")}.`
    });

    const scopeArtifact = await resolveStageArtifactPath("scope", {
      projectRoot,
      track,
      intent: "read"
    });
    const scopeRaw = (await exists(scopeArtifact.absPath))
      ? await fs.readFile(scopeArtifact.absPath, "utf8")
      : "";
    const scopeDecisionIds = extractDecisionIds(scopeRaw);
    const missingDecisionRefs = scopeDecisionIds.filter((id) => !raw.includes(id));
    findings.push({
      section: "Locked Decision Traceability",
      required: strictPlanGuards && scopeDecisionIds.length > 0,
      rule: "Every locked decision ID (D-XX) in scope must be referenced in plan.",
      found: missingDecisionRefs.length === 0,
      details:
        scopeDecisionIds.length === 0
          ? "No D-XX IDs found in scope artifact; traceability check skipped."
          : missingDecisionRefs.length === 0
            ? `All ${scopeDecisionIds.length} scope decision IDs are referenced in plan.`
            : `Missing scope decision reference(s) in plan: ${missingDecisionRefs.join(", ")}.`
    });

    const reductionHits = collectPatternHits(taskListBody, SCOPE_REDUCTION_PATTERNS);
    findings.push({
      section: "No Scope Reduction Language",
      required: strictPlanGuards && scopeDecisionIds.length > 0,
      rule: "Task List must not include scope-reduction language when locked decisions exist.",
      found: reductionHits.length === 0,
      details:
        scopeDecisionIds.length === 0
          ? "No locked decisions found in scope artifact; scope-reduction scan is advisory."
          : reductionHits.length === 0
            ? "No scope-reduction phrases detected in Task List."
            : `Detected scope-reduction phrase(s) in Task List: ${reductionHits.join(", ")}.`
    });
  }

  if (stage === "scope") {
    const lockedDecisionsBody = sectionBodyByName(sections, "Locked Decisions (D-XX)") ?? "";
    const strictScopeGuards =
      parsedFrontmatter.hasFrontmatter ||
      headingPresent(sections, "Locked Decisions (D-XX)");
    const scopeSections = [
      sectionBodyByName(sections, "In Scope / Out of Scope") ?? "",
      sectionBodyByName(sections, "Scope Summary") ?? "",
      lockedDecisionsBody
    ].join("\n");
    const reductionHits = collectPatternHits(scopeSections, SCOPE_REDUCTION_PATTERNS);
    findings.push({
      section: "No Scope Reduction Language",
      required: strictScopeGuards,
      rule: "Scope boundary sections must not use reduction placeholders (`v1`, `for now`, `later`, `temporary`, `placeholder`).",
      found: reductionHits.length === 0,
      details:
        reductionHits.length === 0
          ? "No scope-reduction phrases detected in scope boundary sections."
          : `Detected scope-reduction phrase(s): ${reductionHits.join(", ")}.`
    });

    // When the Locked Decisions section is present we must enforce the
    // D-XX ID contract at runtime (previously this was prose-only in the
    // artifactValidation rule). Empty body, missing IDs, and duplicate
    // IDs all fail the lint; absence of the section remains advisory so
    // scope stays optional for small/quick tracks.
    if (headingPresent(sections, "Locked Decisions (D-XX)")) {
      const decisionIds = extractDecisionIds(lockedDecisionsBody);
      const bulletLines = lockedDecisionsBody
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /^(?:[-*]|\|)\s+\S/u.test(line));
      const orphanBullets = bulletLines.filter((line) => !/\bD-\d+\b/u.test(line));
      const duplicateIds: string[] = (() => {
        const all = lockedDecisionsBody.match(/\bD-\d+\b/gu) ?? [];
        const counts = new Map<string, number>();
        for (const id of all) counts.set(id, (counts.get(id) ?? 0) + 1);
        return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
      })();
      const issues: string[] = [];
      if (decisionIds.length === 0 && bulletLines.length === 0) {
        issues.push("section is empty");
      }
      if (orphanBullets.length > 0) {
        issues.push(
          `${orphanBullets.length} bullet(s) missing a D-XX ID`
        );
      }
      if (duplicateIds.length > 0) {
        issues.push(`duplicate IDs: ${duplicateIds.join(", ")}`);
      }
      findings.push({
        section: "Locked Decisions ID Integrity",
        required: true,
        rule: "Locked Decisions section must list each decision with a unique stable D-XX ID.",
        found: issues.length === 0,
        details:
          issues.length === 0
            ? `${decisionIds.length} decision ID(s) recorded with no duplicates.`
            : issues.join("; ")
      });
    }
  }

  const passed = findings.every((f) => !f.required || f.found);
  return { stage, file: relFile, passed, findings };
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

  const attestationMatch = /NO_CHANGE_ATTESTATION\s*:\s*(.*)/iu.exec(securityBody);
  const hasNoChangeAttestation = Boolean(attestationMatch && attestationMatch[1]?.trim().length > 0);
  if (attestationMatch && attestationMatch[1]?.trim().length === 0) {
    errors.push("NO_CHANGE_ATTESTATION must include a non-empty rationale.");
  }

  if (!hasSecurityFinding && !hasNoChangeAttestation) {
    errors.push(
      "Layer 2 security evidence missing: include at least one security finding or `NO_CHANGE_ATTESTATION: <reason>`."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    hasSecurityFinding,
    hasNoChangeAttestation
  };
}
