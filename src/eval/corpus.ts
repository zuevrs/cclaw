import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import { FLOW_STAGES } from "../types.js";
import type { FlowStage } from "../types.js";
import type {
  EvalCase,
  ExpectedShape,
  RulesExpected,
  RuleRegex,
  StructuralExpected,
  TraceabilityExpected
} from "./types.js";

const FLOW_STAGE_SET = new Set<string>(FLOW_STAGES);

function corpusError(filePath: string, reason: string): Error {
  return new Error(
    `Invalid eval case at ${filePath}: ${reason}\n` +
      `Supported stages: ${FLOW_STAGES.join(", ")}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(
  filePath: string,
  context: string,
  value: unknown
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw corpusError(filePath, `"${context}" must be an array of strings`);
  }
  return value as string[];
}

function readNonNegativeInteger(
  filePath: string,
  context: string,
  value: unknown
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw corpusError(filePath, `"${context}" must be a non-negative integer`);
  }
  return value;
}

function parseStructural(
  filePath: string,
  raw: unknown
): StructuralExpected | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw corpusError(filePath, `"expected.structural" must be a mapping`);
  }
  const requiredSections = readStringArray(
    filePath,
    "expected.structural.required_sections",
    raw.required_sections ?? raw.requiredSections
  );
  const forbiddenPatterns = readStringArray(
    filePath,
    "expected.structural.forbidden_patterns",
    raw.forbidden_patterns ?? raw.forbiddenPatterns
  );
  const requiredFrontmatterKeys = readStringArray(
    filePath,
    "expected.structural.required_frontmatter_keys",
    raw.required_frontmatter_keys ?? raw.requiredFrontmatterKeys
  );
  const minLines = readNonNegativeInteger(
    filePath,
    "expected.structural.min_lines",
    raw.min_lines ?? raw.minLines
  );
  const maxLines = readNonNegativeInteger(
    filePath,
    "expected.structural.max_lines",
    raw.max_lines ?? raw.maxLines
  );
  const minChars = readNonNegativeInteger(
    filePath,
    "expected.structural.min_chars",
    raw.min_chars ?? raw.minChars
  );
  const maxChars = readNonNegativeInteger(
    filePath,
    "expected.structural.max_chars",
    raw.max_chars ?? raw.maxChars
  );

  const structural: StructuralExpected = {};
  if (requiredSections) structural.requiredSections = requiredSections;
  if (forbiddenPatterns) structural.forbiddenPatterns = forbiddenPatterns;
  if (requiredFrontmatterKeys) structural.requiredFrontmatterKeys = requiredFrontmatterKeys;
  if (minLines !== undefined) structural.minLines = minLines;
  if (maxLines !== undefined) structural.maxLines = maxLines;
  if (minChars !== undefined) structural.minChars = minChars;
  if (maxChars !== undefined) structural.maxChars = maxChars;
  return structural;
}

function parseRegexRule(
  filePath: string,
  context: string,
  value: unknown
): RuleRegex {
  if (typeof value === "string") {
    return { pattern: value };
  }
  if (!isRecord(value)) {
    throw corpusError(
      filePath,
      `"${context}" entries must be either a string or a mapping with "pattern"`
    );
  }
  const pattern = value.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw corpusError(
      filePath,
      `"${context}" mapping entry must include a non-empty "pattern" string`
    );
  }
  const flags = value.flags;
  if (flags !== undefined && typeof flags !== "string") {
    throw corpusError(filePath, `"${context}" flags must be a string`);
  }
  const description = value.description;
  if (description !== undefined && typeof description !== "string") {
    throw corpusError(filePath, `"${context}" description must be a string`);
  }
  const rule: RuleRegex = { pattern };
  if (flags !== undefined) rule.flags = flags;
  if (description !== undefined) rule.description = description;
  return rule;
}

function parseRegexRules(
  filePath: string,
  context: string,
  value: unknown
): RuleRegex[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw corpusError(filePath, `"${context}" must be an array`);
  }
  return value.map((entry, index) =>
    parseRegexRule(filePath, `${context}[${index}]`, entry)
  );
}

function parseOccurrenceBounds(
  filePath: string,
  context: string,
  value: unknown
): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw corpusError(filePath, `"${context}" must be a mapping of phrase → integer`);
  }
  const out: Record<string, number> = {};
  for (const [phrase, count] of Object.entries(value)) {
    if (typeof count !== "number" || !Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
      throw corpusError(
        filePath,
        `"${context}.${phrase}" must be a non-negative integer`
      );
    }
    out[phrase] = count;
  }
  return out;
}

function parseRules(filePath: string, raw: unknown): RulesExpected | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw corpusError(filePath, `"expected.rules" must be a mapping`);
  }
  const mustContain = readStringArray(
    filePath,
    "expected.rules.must_contain",
    raw.must_contain ?? raw.mustContain
  );
  const mustNotContain = readStringArray(
    filePath,
    "expected.rules.must_not_contain",
    raw.must_not_contain ?? raw.mustNotContain
  );
  const regexRequired = parseRegexRules(
    filePath,
    "expected.rules.regex_required",
    raw.regex_required ?? raw.regexRequired
  );
  const regexForbidden = parseRegexRules(
    filePath,
    "expected.rules.regex_forbidden",
    raw.regex_forbidden ?? raw.regexForbidden
  );
  const minOccurrences = parseOccurrenceBounds(
    filePath,
    "expected.rules.min_occurrences",
    raw.min_occurrences ?? raw.minOccurrences
  );
  const maxOccurrences = parseOccurrenceBounds(
    filePath,
    "expected.rules.max_occurrences",
    raw.max_occurrences ?? raw.maxOccurrences
  );
  const uniqueBulletsInSection = readStringArray(
    filePath,
    "expected.rules.unique_bullets_in_section",
    raw.unique_bullets_in_section ?? raw.uniqueBulletsInSection
  );

  const rules: RulesExpected = {};
  if (mustContain) rules.mustContain = mustContain;
  if (mustNotContain) rules.mustNotContain = mustNotContain;
  if (regexRequired) rules.regexRequired = regexRequired;
  if (regexForbidden) rules.regexForbidden = regexForbidden;
  if (minOccurrences) rules.minOccurrences = minOccurrences;
  if (maxOccurrences) rules.maxOccurrences = maxOccurrences;
  if (uniqueBulletsInSection) rules.uniqueBulletsInSection = uniqueBulletsInSection;

  return Object.keys(rules).length === 0 ? undefined : rules;
}

function parseTraceability(
  filePath: string,
  raw: unknown
): TraceabilityExpected | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw corpusError(filePath, `"expected.traceability" must be a mapping`);
  }
  const idPattern = raw.id_pattern ?? raw.idPattern;
  if (typeof idPattern !== "string" || idPattern.length === 0) {
    throw corpusError(
      filePath,
      `"expected.traceability.id_pattern" must be a non-empty regex source`
    );
  }
  const idFlags = raw.id_flags ?? raw.idFlags;
  if (idFlags !== undefined && typeof idFlags !== "string") {
    throw corpusError(filePath, `"expected.traceability.id_flags" must be a string`);
  }
  const source = raw.source;
  if (typeof source !== "string" || source.length === 0) {
    throw corpusError(
      filePath,
      `"expected.traceability.source" must be "self" or an extra_fixtures label`
    );
  }
  const requireInRaw = raw.require_in ?? raw.requireIn;
  const requireIn = readStringArray(
    filePath,
    "expected.traceability.require_in",
    requireInRaw
  );
  if (!requireIn || requireIn.length === 0) {
    throw corpusError(
      filePath,
      `"expected.traceability.require_in" must be a non-empty array`
    );
  }
  const out: TraceabilityExpected = { idPattern, source, requireIn };
  if (idFlags !== undefined) out.idFlags = idFlags;
  return out;
}

function parseExtraFixtures(
  filePath: string,
  raw: unknown
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw corpusError(filePath, `"extra_fixtures" must be a mapping of label → path`);
  }
  const out: Record<string, string> = {};
  for (const [label, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.length === 0) {
      throw corpusError(
        filePath,
        `"extra_fixtures.${label}" must be a non-empty path string`
      );
    }
    out[label] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function parseExpected(filePath: string, raw: unknown): ExpectedShape | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw corpusError(filePath, `"expected" must be a mapping`);
  }
  const shape: ExpectedShape = {};
  const structural = parseStructural(filePath, raw.structural);
  if (structural) shape.structural = structural;
  const rules = parseRules(filePath, raw.rules);
  if (rules) shape.rules = rules;
  const traceability = parseTraceability(filePath, raw.traceability);
  if (traceability) shape.traceability = traceability;
  if (raw.judge !== undefined) {
    if (!isRecord(raw.judge)) {
      throw corpusError(filePath, `"expected.judge" must be a mapping`);
    }
    shape.judge = raw.judge as Record<string, unknown>;
  }
  return Object.keys(shape).length === 0 ? undefined : shape;
}

function validateCase(filePath: string, raw: unknown): EvalCase {
  if (!isRecord(raw)) {
    throw corpusError(filePath, "top-level value must be a mapping");
  }

  const id = raw.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw corpusError(filePath, `"id" must be a non-empty string`);
  }

  const stageRaw = raw.stage;
  if (typeof stageRaw !== "string" || !FLOW_STAGE_SET.has(stageRaw)) {
    throw corpusError(filePath, `"stage" must be one of: ${FLOW_STAGES.join(", ")}`);
  }

  const inputPrompt = raw.input_prompt ?? raw.inputPrompt;
  if (typeof inputPrompt !== "string" || inputPrompt.trim().length === 0) {
    throw corpusError(filePath, `"input_prompt" must be a non-empty string`);
  }

  const contextFiles = readStringArray(
    filePath,
    "context_files",
    raw.context_files ?? raw.contextFiles
  );
  const expected = parseExpected(filePath, raw.expected);
  const fixture = typeof raw.fixture === "string" ? raw.fixture : undefined;
  const extraFixtures = parseExtraFixtures(
    filePath,
    raw.extra_fixtures ?? raw.extraFixtures
  );

  return {
    id: id.trim(),
    stage: stageRaw as FlowStage,
    inputPrompt: inputPrompt.trim(),
    contextFiles,
    expected,
    fixture,
    extraFixtures
  };
}

/**
 * Load all eval cases under `.cclaw/evals/corpus/**`. Optionally restrict to a
 * single stage. Returns an empty array for a fresh install.
 */
export async function loadCorpus(
  projectRoot: string,
  stage?: FlowStage
): Promise<EvalCase[]> {
  const corpusRoot = path.join(projectRoot, EVALS_ROOT, "corpus");
  if (!(await exists(corpusRoot))) {
    return [];
  }

  const cases: EvalCase[] = [];
  const stageDirs = stage
    ? [path.join(corpusRoot, stage)]
    : (await fs.readdir(corpusRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .filter((entry) => FLOW_STAGE_SET.has(entry.name))
        .map((entry) => path.join(corpusRoot, entry.name));

  for (const stageDir of stageDirs) {
    if (!(await exists(stageDir))) continue;
    const entries = await fs.readdir(stageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
      const filePath = path.join(stageDir, entry.name);
      let parsed: unknown;
      try {
        parsed = parse(await fs.readFile(filePath, "utf8"));
      } catch (err) {
        throw corpusError(filePath, err instanceof Error ? err.message : String(err));
      }
      cases.push(validateCase(filePath, parsed));
    }
  }

  cases.sort((a, b) => a.stage.localeCompare(b.stage) || a.id.localeCompare(b.id));
  return cases;
}

/**
 * Resolve a case's `fixture` path to an absolute filesystem path. The fixture
 * field is interpreted relative to the case's stage directory (i.e., a
 * sibling subdirectory or file inside `.cclaw/evals/corpus/<stage>/`).
 */
export function fixturePathFor(
  projectRoot: string,
  caseEntry: EvalCase
): string | undefined {
  if (!caseEntry.fixture) return undefined;
  return path.resolve(
    projectRoot,
    EVALS_ROOT,
    "corpus",
    caseEntry.stage,
    caseEntry.fixture
  );
}

/**
 * Read the fixture artifact text for a case. Returns `undefined` if the case
 * has no fixture reference. Throws a descriptive error if the path exists in
 * the case but not on disk — structural fixtures ship alongside cases.
 */
export async function readFixtureArtifact(
  projectRoot: string,
  caseEntry: EvalCase
): Promise<string | undefined> {
  const fixturePath = fixturePathFor(projectRoot, caseEntry);
  if (!fixturePath) return undefined;
  if (!(await exists(fixturePath))) {
    throw new Error(
      `Fixture missing for case ${caseEntry.stage}/${caseEntry.id}: ${fixturePath}`
    );
  }
  return fs.readFile(fixturePath, "utf8");
}

/**
 * Resolve an entry from `extraFixtures` to an absolute filesystem path,
 * relative to the case's stage directory (same convention as `fixture`).
 */
export function extraFixturePath(
  projectRoot: string,
  caseEntry: EvalCase,
  label: string
): string | undefined {
  const value = caseEntry.extraFixtures?.[label];
  if (!value) return undefined;
  return path.resolve(
    projectRoot,
    EVALS_ROOT,
    "corpus",
    caseEntry.stage,
    value
  );
}

/**
 * Read every declared extra fixture for a case into a `{ label → text }`
 * map. Missing files throw so authoring mistakes surface immediately rather
 * than being silently skipped by cross-artifact verifiers.
 */
export async function readExtraFixtures(
  projectRoot: string,
  caseEntry: EvalCase
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!caseEntry.extraFixtures) return out;
  for (const label of Object.keys(caseEntry.extraFixtures)) {
    const filePath = extraFixturePath(projectRoot, caseEntry, label);
    if (!filePath) continue;
    if (!(await exists(filePath))) {
      throw new Error(
        `Extra fixture missing for ${caseEntry.stage}/${caseEntry.id} ` +
          `(label="${label}"): ${filePath}`
      );
    }
    out[label] = await fs.readFile(filePath, "utf8");
  }
  return out;
}
