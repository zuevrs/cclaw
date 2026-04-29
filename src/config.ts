import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { isIronLawId, normalizeStrictLawIds } from "./content/iron-laws.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { FLOW_TRACKS, HARNESS_IDS, LANGUAGE_RULE_PACKS } from "./types.js";
import type { CclawConfig, FlowTrack, HarnessId, LanguageRulePack, VcsMode } from "./types.js";

const CONFIG_PATH = `${RUNTIME_ROOT}/config.yaml`;
const HARNESS_ID_SET = new Set<string>(HARNESS_IDS);
const FLOW_TRACK_SET = new Set<string>(FLOW_TRACKS);
const LANGUAGE_RULE_PACK_SET = new Set<string>(LANGUAGE_RULE_PACKS);
const SUPPORTED_HARNESSES_TEXT = HARNESS_IDS.join(", ");
const SUPPORTED_TRACKS_TEXT = FLOW_TRACKS.join(", ");
const SUPPORTED_LANGUAGE_RULE_PACKS_TEXT = LANGUAGE_RULE_PACKS.join(", ");
const ALLOWED_CONFIG_KEYS = new Set<string>([
  "version",
  "flowVersion",
  "harnesses",
  "vcs",
  "strictness",
  "tddTestGlobs",
  "tdd",
  "compound",
  "gitHookGuards",
  "defaultTrack",
  "languageRulePacks",
  "trackHeuristics",
  "sliceReview",
  "ironLaws",
  "optInAudits",
  "reviewLoop"
]);

/**
 * Config keys removed in the advisory-by-default consolidation. Kept here so
 * the parser can emit a helpful migration error pointing users at the new
 * single `strictness` knob instead of a generic "unknown key" message.
 */
const RETIRED_GUARD_CONFIG_KEYS = new Set<string>([
  "promptGuardMode",
  "tddEnforcement",
  "workflowGuardMode"
]);

/**
 * Config keys always present in the minimal init template. Everything else
 * is "advanced" — parsed when present, but not pre-populated by `cclaw init`.
 *
 * Deliberately small: a first-time user should only see knobs they might
 * actually flip. Power users override by adding more keys by hand; the
 * reference lives in `docs/config.md`.
 */
const MINIMAL_CONFIG_KEYS = [
  "version",
  "flowVersion",
  "harnesses",
  "vcs",
  "strictness",
  "gitHookGuards"
] as const;

const DEFAULT_SLICE_REVIEW_THRESHOLD = 5;
const DEFAULT_SLICE_REVIEW_TRACKS: FlowTrack[] = ["standard"];

export interface ConfigWarningState {
  emitted: Set<string>;
}

export interface ReadConfigOptions {
  warningState?: ConfigWarningState;
}

export function createConfigWarningState(): ConfigWarningState {
  return { emitted: new Set<string>() };
}

function emitConfigWarningOnce(
  warningState: ConfigWarningState,
  code: string,
  message: string
): void {
  const key = `${code}:${message}`;
  if (warningState.emitted.has(key)) {
    return;
  }
  warningState.emitted.add(key);
  process.emitWarning(message, { code });
}

function sameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function configFixExample(): string {
  return `harnesses:
  - claude
  - cursor`;
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}

function configValidationError(configFilePath: string, reason: string): InvalidConfigError {
  return new InvalidConfigError(
    `Invalid cclaw config at ${configFilePath}: ${reason}\n` +
      `Supported harnesses: ${SUPPORTED_HARNESSES_TEXT}\n` +
      `Supported tracks: ${SUPPORTED_TRACKS_TEXT}\n` +
      `Supported languageRulePacks: ${SUPPORTED_LANGUAGE_RULE_PACKS_TEXT}\n` +
      `Example config:\n${configFixExample()}\n` +
      `After fixing, run: cclaw sync`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStringArray(
  value: unknown,
  fieldName: string,
  configFilePath: string
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw configValidationError(configFilePath, `"${fieldName}" must be an array of strings`);
  }
  const invalid = value.filter((item) => typeof item !== "string");
  if (invalid.length > 0) {
    throw configValidationError(configFilePath, `"${fieldName}" must contain only strings`);
  }
  return value as string[];
}

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_PATH);
}

/**
 * Default test-path patterns used by the workflow-guard hook to classify TDD writes.
 *
 * Scope is intentionally narrow and language-agnostic; users can extend this
 * list in config when their repository uses different conventions.
 */
export const DEFAULT_TDD_TEST_PATH_PATTERNS: readonly string[] = [
  "**/*.test.*",
  "**/tests/**",
  "**/__tests__/**"
];

/**
 * Legacy alias kept for backwards compatibility with `tddTestGlobs`.
 * Prefer `tdd.testPathPatterns` in new configurations.
 */
export const DEFAULT_TDD_TEST_GLOBS: readonly string[] = [...DEFAULT_TDD_TEST_PATH_PATTERNS];

export const DEFAULT_TDD_PRODUCTION_PATH_PATTERNS: readonly string[] = [];
export const DEFAULT_COMPOUND_RECURRENCE_THRESHOLD = 3;

/**
 * Populated runtime view of config values that downstream callers (install,
 * observe, doctor) consume. Always has the derived guard modes populated,
 * regardless of whether the user wrote `strictness`, the legacy keys, both,
 * or neither.
 */
export function createDefaultConfig(
  harnesses: HarnessId[] = DEFAULT_HARNESSES,
  defaultTrack: FlowTrack = "standard"
): CclawConfig {
  const tddTestPathPatterns = [...DEFAULT_TDD_TEST_PATH_PATTERNS];
  const tddProductionPathPatterns = [...DEFAULT_TDD_PRODUCTION_PATH_PATTERNS];
  return {
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION,
    harnesses,
    vcs: "git-local-only",
    strictness: "advisory",
    tddTestGlobs: [...tddTestPathPatterns],
    tdd: {
      testPathPatterns: tddTestPathPatterns,
      productionPathPatterns: tddProductionPathPatterns,
      verificationRef: "auto"
    },
    compound: {
      recurrenceThreshold: DEFAULT_COMPOUND_RECURRENCE_THRESHOLD
    },
    gitHookGuards: false,
    defaultTrack,
    languageRulePacks: [],
    ironLaws: {
      strictLaws: []
    }
  };
}

/**
 * Probe common project-root manifests to infer which language rule packs the
 * user would reasonably want. Pure-functional best-effort: any filesystem
 * error is swallowed, producing an empty list — the user can always override
 * by hand.
 *
 * Called from `cclaw init` only (not `readConfig`), so subsequent upgrades
 * never surprise a user who intentionally cleared the list.
 */
export async function detectLanguageRulePacks(projectRoot: string): Promise<LanguageRulePack[]> {
  const detected: LanguageRulePack[] = [];

  const pkgPath = path.join(projectRoot, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as Record<string, unknown>;
      const deps = {
        ...(pkg.dependencies as Record<string, unknown> | undefined),
        ...(pkg.devDependencies as Record<string, unknown> | undefined)
      };
      if ("typescript" in deps || typeof pkg.types === "string") {
        detected.push("typescript");
      }
    } catch {
      // Malformed package.json — skip; user can set the pack manually later.
    }
  }

  const pythonMarkers = ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"];
  for (const marker of pythonMarkers) {
    if (await exists(path.join(projectRoot, marker))) {
      detected.push("python");
      break;
    }
  }

  if (await exists(path.join(projectRoot, "go.mod"))) {
    detected.push("go");
  }

  return [...new Set(detected)];
}

export async function readConfig(
  projectRoot: string,
  options: ReadConfigOptions = {}
): Promise<CclawConfig> {
  const warningState = options.warningState ?? createConfigWarningState();
  const fullPath = configPath(projectRoot);
  if (!(await exists(fullPath))) {
    return createDefaultConfig();
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = parse(await fs.readFile(fullPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    throw configValidationError(fullPath, `failed to parse YAML (${reason})`);
  }
  if (parsedUnknown !== null && parsedUnknown !== undefined && typeof parsedUnknown !== "object") {
    throw configValidationError(fullPath, "top-level config must be a YAML mapping/object");
  }

  const parsed = (parsedUnknown && typeof parsedUnknown === "object"
    ? parsedUnknown
    : {}) as Partial<CclawConfig>;
  const retiredGuardKeys = Object.keys(parsed).filter((key) =>
    RETIRED_GUARD_CONFIG_KEYS.has(key)
  );
  if (retiredGuardKeys.length > 0) {
    throw configValidationError(
      fullPath,
      `config key(s) ${retiredGuardKeys.join(", ")} were removed; ` +
        `use the single \`strictness: advisory|strict\` knob instead ` +
        `(advisory is the default). See docs/config.md#strictness for migration.`
    );
  }
  const unknownKeys = Object.keys(parsed).filter((key) => !ALLOWED_CONFIG_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw configValidationError(fullPath, `unknown top-level key(s): ${unknownKeys.join(", ")}`);
  }

  const hasHarnessesField = Object.prototype.hasOwnProperty.call(parsed, "harnesses");
  if (hasHarnessesField && !Array.isArray(parsed.harnesses)) {
    throw configValidationError(fullPath, `"harnesses" must be an array`);
  }

  const configuredHarnesses = (parsed.harnesses ?? []) as unknown[];
  const invalidHarnesses = configuredHarnesses.filter(
    (harness) => typeof harness !== "string" || !HARNESS_ID_SET.has(harness)
  );
  if (invalidHarnesses.length > 0) {
    const formatted = invalidHarnesses
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(", ");
    throw configValidationError(fullPath, `unknown harness id(s): ${formatted}`);
  }

  const validatedHarnesses = configuredHarnesses as HarnessId[];
  if (hasHarnessesField && validatedHarnesses.length === 0) {
    throw configValidationError(fullPath, `"harnesses" must include at least one harness`);
  }
  const harnesses = hasHarnessesField
    ? [...new Set(validatedHarnesses)]
    : DEFAULT_HARNESSES;

  const vcsRaw = (parsed as { vcs?: unknown }).vcs;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "vcs") &&
    vcsRaw !== "git-with-remote" &&
    vcsRaw !== "git-local-only" &&
    vcsRaw !== "none"
  ) {
    throw configValidationError(fullPath, `"vcs" must be one of: git-with-remote, git-local-only, none`);
  }
  const vcs: VcsMode =
    vcsRaw === "git-with-remote" || vcsRaw === "git-local-only" || vcsRaw === "none"
      ? vcsRaw
      : "git-local-only";

  const strictnessRaw = (parsed as { strictness?: unknown }).strictness;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "strictness") &&
    strictnessRaw !== "advisory" &&
    strictnessRaw !== "strict"
  ) {
    throw configValidationError(fullPath, `"strictness" must be "advisory" or "strict"`);
  }
  const strictness: "advisory" | "strict" = strictnessRaw === "strict" ? "strict" : "advisory";

  const tddTestGlobsRaw = (parsed as { tddTestGlobs?: unknown }).tddTestGlobs;
  const tddTestGlobs = validateStringArray(tddTestGlobsRaw, "tddTestGlobs", fullPath)
    ?? [...DEFAULT_TDD_TEST_GLOBS];

  const hasTddField = Object.prototype.hasOwnProperty.call(parsed, "tdd");
  const tddRaw = (parsed as { tdd?: unknown }).tdd;
  let explicitTddTestPathPatterns: string[] | undefined;
  let explicitTddProductionPathPatterns: string[] | undefined;
  let explicitTddVerificationRef: "auto" | "required" | "disabled" | undefined;
  if (hasTddField) {
    if (!isRecord(tddRaw)) {
      throw configValidationError(fullPath, `"tdd" must be an object`);
    }
    const unknownTddKeys = Object.keys(tddRaw).filter(
      (key) => key !== "testPathPatterns" && key !== "productionPathPatterns" && key !== "verificationRef"
    );
    if (unknownTddKeys.length > 0) {
      throw configValidationError(
        fullPath,
        `"tdd" has unknown key(s): ${unknownTddKeys.join(", ")}`
      );
    }
    explicitTddTestPathPatterns = validateStringArray(
      tddRaw.testPathPatterns,
      "tdd.testPathPatterns",
      fullPath
    );
    explicitTddProductionPathPatterns = validateStringArray(
      tddRaw.productionPathPatterns,
      "tdd.productionPathPatterns",
      fullPath
    );
    if (
      tddRaw.verificationRef !== undefined &&
      tddRaw.verificationRef !== "auto" &&
      tddRaw.verificationRef !== "required" &&
      tddRaw.verificationRef !== "disabled"
    ) {
      throw configValidationError(
        fullPath,
        '"tdd.verificationRef" must be one of: auto, required, disabled'
      );
    }
    explicitTddVerificationRef = tddRaw.verificationRef as typeof explicitTddVerificationRef;
  }

  if (
    tddTestGlobsRaw !== undefined &&
    explicitTddTestPathPatterns !== undefined &&
    !sameStringArray(tddTestGlobs, explicitTddTestPathPatterns)
  ) {
    emitConfigWarningOnce(
      warningState,
      "CCLAW_CONFIG_DEPRECATED_TDD_TEST_GLOBS",
      `[cclaw] Both "tddTestGlobs" (deprecated) and "tdd.testPathPatterns" are set in ${fullPath}. ` +
        `Using "tdd.testPathPatterns".`
    );
  }

  const resolvedTddTestPathPatterns = [
    ...(explicitTddTestPathPatterns ?? tddTestGlobs ?? DEFAULT_TDD_TEST_PATH_PATTERNS)
  ];
  const resolvedTddProductionPathPatterns = [
    ...(explicitTddProductionPathPatterns ?? DEFAULT_TDD_PRODUCTION_PATH_PATTERNS)
  ];

  const hasCompoundField = Object.prototype.hasOwnProperty.call(parsed, "compound");
  const compoundRaw = (parsed as { compound?: unknown }).compound;
  let compoundRecurrenceThreshold = DEFAULT_COMPOUND_RECURRENCE_THRESHOLD;
  if (hasCompoundField) {
    if (!isRecord(compoundRaw)) {
      throw configValidationError(fullPath, `"compound" must be an object`);
    }
    const unknownCompoundKeys = Object.keys(compoundRaw).filter(
      (key) => key !== "recurrenceThreshold"
    );
    if (unknownCompoundKeys.length > 0) {
      throw configValidationError(
        fullPath,
        `"compound" has unknown key(s): ${unknownCompoundKeys.join(", ")}`
      );
    }
    if (
      compoundRaw.recurrenceThreshold !== undefined &&
      (
        typeof compoundRaw.recurrenceThreshold !== "number" ||
        !Number.isInteger(compoundRaw.recurrenceThreshold) ||
        compoundRaw.recurrenceThreshold < 1
      )
    ) {
      throw configValidationError(
        fullPath,
        `"compound.recurrenceThreshold" must be a positive integer`
      );
    }
    if (typeof compoundRaw.recurrenceThreshold === "number") {
      compoundRecurrenceThreshold = compoundRaw.recurrenceThreshold;
    }
  }

  const gitHookGuardsRaw = parsed.gitHookGuards;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "gitHookGuards") &&
    typeof gitHookGuardsRaw !== "boolean"
  ) {
    throw configValidationError(fullPath, `"gitHookGuards" must be a boolean`);
  }
  const gitHookGuards = typeof gitHookGuardsRaw === "boolean" ? gitHookGuardsRaw : false;

  const defaultTrackRaw = parsed.defaultTrack;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "defaultTrack") &&
    (typeof defaultTrackRaw !== "string" || !FLOW_TRACK_SET.has(defaultTrackRaw))
  ) {
    throw configValidationError(fullPath, `"defaultTrack" must be one of: ${SUPPORTED_TRACKS_TEXT}`);
  }
  const defaultTrack: FlowTrack =
    typeof defaultTrackRaw === "string" && FLOW_TRACK_SET.has(defaultTrackRaw)
      ? (defaultTrackRaw as FlowTrack)
      : "standard";

  const languageRulePacksRaw = (parsed as { languageRulePacks?: unknown }).languageRulePacks;
  const hasLanguageRulePacksField = Object.prototype.hasOwnProperty.call(parsed, "languageRulePacks");
  if (hasLanguageRulePacksField && !Array.isArray(languageRulePacksRaw)) {
    throw configValidationError(fullPath, `"languageRulePacks" must be an array`);
  }
  const rawPacks = (languageRulePacksRaw ?? []) as unknown[];
  const invalidPacks = rawPacks.filter(
    (pack) => typeof pack !== "string" || !LANGUAGE_RULE_PACK_SET.has(pack)
  );
  if (invalidPacks.length > 0) {
    const formatted = invalidPacks
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(", ");
    throw configValidationError(fullPath, `unknown languageRulePacks id(s): ${formatted}`);
  }
  const languageRulePacks = [...new Set(rawPacks as LanguageRulePack[])];

  const trackHeuristicsRaw = (parsed as { trackHeuristics?: unknown }).trackHeuristics;
  let trackHeuristics: CclawConfig["trackHeuristics"] = undefined;
  if (Object.prototype.hasOwnProperty.call(parsed, "trackHeuristics")) {
    if (!isRecord(trackHeuristicsRaw)) {
      throw configValidationError(fullPath, `"trackHeuristics" must be an object`);
    }
    const fallbackRaw = trackHeuristicsRaw.fallback;
    if (fallbackRaw !== undefined && (typeof fallbackRaw !== "string" || !FLOW_TRACK_SET.has(fallbackRaw))) {
      throw configValidationError(
        fullPath,
        `"trackHeuristics.fallback" must be one of: ${SUPPORTED_TRACKS_TEXT}`
      );
    }

    if (Object.prototype.hasOwnProperty.call(trackHeuristicsRaw, "priority")) {
      throw configValidationError(
        fullPath,
        `"trackHeuristics.priority" is no longer supported (removed in v0.38.0). Track evaluation order is always standard -> medium -> quick. Remove the field to upgrade.`
      );
    }

    const tracksRaw = trackHeuristicsRaw.tracks;
    let tracks: NonNullable<CclawConfig["trackHeuristics"]>["tracks"] = undefined;
    if (tracksRaw !== undefined) {
      if (!isRecord(tracksRaw)) {
        throw configValidationError(fullPath, `"trackHeuristics.tracks" must be an object`);
      }
      tracks = {};
      for (const [trackName, ruleRaw] of Object.entries(tracksRaw)) {
        if (!FLOW_TRACK_SET.has(trackName)) {
          throw configValidationError(
            fullPath,
            `"trackHeuristics.tracks" contains unknown track "${trackName}". Supported: ${SUPPORTED_TRACKS_TEXT}`
          );
        }
        if (!isRecord(ruleRaw)) {
          throw configValidationError(
            fullPath,
            `"trackHeuristics.tracks.${trackName}" must be an object`
          );
        }

        if (Object.prototype.hasOwnProperty.call(ruleRaw, "patterns")) {
          throw configValidationError(
            fullPath,
            `"trackHeuristics.tracks.${trackName}.patterns" is no longer supported (removed in v0.38.0). Regex patterns were never wired into runtime routing. Move the intent into "triggers" (substrings) or "veto".`
          );
        }

        const triggers = validateStringArray(
          ruleRaw.triggers,
          `trackHeuristics.tracks.${trackName}.triggers`,
          fullPath
        );
        const veto = validateStringArray(
          ruleRaw.veto,
          `trackHeuristics.tracks.${trackName}.veto`,
          fullPath
        );
        tracks[trackName as FlowTrack] = {
          triggers,
          veto
        };
      }
    }

    trackHeuristics = {
      fallback: fallbackRaw as FlowTrack | undefined,
      tracks
    };
  }

  const sliceReviewRaw = (parsed as { sliceReview?: unknown }).sliceReview;
  let sliceReview: CclawConfig["sliceReview"] = undefined;
  if (Object.prototype.hasOwnProperty.call(parsed, "sliceReview")) {
    if (!isRecord(sliceReviewRaw)) {
      throw configValidationError(fullPath, `"sliceReview" must be an object`);
    }

    const enabledRaw = sliceReviewRaw.enabled;
    if (enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
      throw configValidationError(fullPath, `"sliceReview.enabled" must be a boolean`);
    }

    const thresholdRaw = sliceReviewRaw.filesChangedThreshold;
    if (
      thresholdRaw !== undefined &&
      (typeof thresholdRaw !== "number" || !Number.isInteger(thresholdRaw) || thresholdRaw < 1)
    ) {
      throw configValidationError(
        fullPath,
        `"sliceReview.filesChangedThreshold" must be a positive integer`
      );
    }

    const touchTriggers = validateStringArray(
      sliceReviewRaw.touchTriggers,
      "sliceReview.touchTriggers",
      fullPath
    );

    const enforceRaw = sliceReviewRaw.enforceOnTracks;
    let enforceOnTracks: FlowTrack[] | undefined;
    if (enforceRaw !== undefined) {
      if (!Array.isArray(enforceRaw)) {
        throw configValidationError(
          fullPath,
          `"sliceReview.enforceOnTracks" must be an array`
        );
      }
      const invalidTracks = enforceRaw.filter(
        (value) => typeof value !== "string" || !FLOW_TRACK_SET.has(value)
      );
      if (invalidTracks.length > 0) {
        throw configValidationError(
          fullPath,
          `"sliceReview.enforceOnTracks" must contain only: ${SUPPORTED_TRACKS_TEXT}`
        );
      }
      enforceOnTracks = [...new Set(enforceRaw as FlowTrack[])];
    }

    sliceReview = {
      enabled: typeof enabledRaw === "boolean" ? enabledRaw : false,
      filesChangedThreshold:
        typeof thresholdRaw === "number" ? thresholdRaw : DEFAULT_SLICE_REVIEW_THRESHOLD,
      touchTriggers: touchTriggers ?? [],
      enforceOnTracks: enforceOnTracks ?? DEFAULT_SLICE_REVIEW_TRACKS
    };
  }

  const ironLawsRaw = (parsed as { ironLaws?: unknown }).ironLaws;
  let ironLaws: CclawConfig["ironLaws"] = undefined;
  if (Object.prototype.hasOwnProperty.call(parsed, "ironLaws")) {
    if (!isRecord(ironLawsRaw)) {
      throw configValidationError(fullPath, `"ironLaws" must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(ironLawsRaw, "mode")) {
      throw configValidationError(
        fullPath,
        `"ironLaws.mode" was removed; the project-wide \`strictness\` knob now ` +
          `controls iron-law enforcement. Use \`ironLaws.strictLaws\` for per-law overrides.`
      );
    }
    const unknownIronLawKeys = Object.keys(ironLawsRaw).filter((key) => key !== "strictLaws");
    if (unknownIronLawKeys.length > 0) {
      throw configValidationError(
        fullPath,
        `"ironLaws" has unknown key(s): ${unknownIronLawKeys.join(", ")}`
      );
    }
    const strictLawIdsRaw = validateStringArray(
      ironLawsRaw.strictLaws,
      "ironLaws.strictLaws",
      fullPath
    ) ?? [];
    const unknownStrictLawIds = strictLawIdsRaw.filter((id) => !isIronLawId(id));
    if (unknownStrictLawIds.length > 0) {
      throw configValidationError(
        fullPath,
        `"ironLaws.strictLaws" contains unknown law id(s): ${unknownStrictLawIds.join(", ")}`
      );
    }
    ironLaws = {
      strictLaws: normalizeStrictLawIds(strictLawIdsRaw)
    };
  } else {
    ironLaws = { strictLaws: [] };
  }

  const optInAuditsRaw = (parsed as { optInAudits?: unknown }).optInAudits;
  let optInAudits: CclawConfig["optInAudits"] = undefined;
  if (Object.prototype.hasOwnProperty.call(parsed, "optInAudits")) {
    if (!isRecord(optInAuditsRaw)) {
      throw configValidationError(fullPath, `"optInAudits" must be an object`);
    }
    const unknownOptInAuditKeys = Object.keys(optInAuditsRaw).filter(
      (key) => key !== "scopePreAudit" && key !== "staleDiagramAudit"
    );
    if (unknownOptInAuditKeys.length > 0) {
      throw configValidationError(
        fullPath,
        `"optInAudits" has unknown key(s): ${unknownOptInAuditKeys.join(", ")}`
      );
    }
    if (
      optInAuditsRaw.scopePreAudit !== undefined &&
      typeof optInAuditsRaw.scopePreAudit !== "boolean"
    ) {
      throw configValidationError(fullPath, `"optInAudits.scopePreAudit" must be a boolean`);
    }
    if (
      optInAuditsRaw.staleDiagramAudit !== undefined &&
      typeof optInAuditsRaw.staleDiagramAudit !== "boolean"
    ) {
      throw configValidationError(fullPath, `"optInAudits.staleDiagramAudit" must be a boolean`);
    }
    optInAudits = {
      scopePreAudit:
        typeof optInAuditsRaw.scopePreAudit === "boolean"
          ? optInAuditsRaw.scopePreAudit
          : false,
      staleDiagramAudit:
        typeof optInAuditsRaw.staleDiagramAudit === "boolean"
          ? optInAuditsRaw.staleDiagramAudit
          : false
    };
  }

  const reviewLoopRaw = (parsed as { reviewLoop?: unknown }).reviewLoop;
  let reviewLoop: CclawConfig["reviewLoop"] = undefined;
  if (Object.prototype.hasOwnProperty.call(parsed, "reviewLoop")) {
    if (!isRecord(reviewLoopRaw)) {
      throw configValidationError(fullPath, `"reviewLoop" must be an object`);
    }
    const unknownReviewLoopKeys = Object.keys(reviewLoopRaw).filter(
      (key) => key !== "externalSecondOpinion"
    );
    if (unknownReviewLoopKeys.length > 0) {
      throw configValidationError(
        fullPath,
        `"reviewLoop" has unknown key(s): ${unknownReviewLoopKeys.join(", ")}`
      );
    }
    const externalRaw = reviewLoopRaw.externalSecondOpinion;
    let externalSecondOpinion: NonNullable<CclawConfig["reviewLoop"]>["externalSecondOpinion"] =
      undefined;
    if (externalRaw !== undefined) {
      if (!isRecord(externalRaw)) {
        throw configValidationError(
          fullPath,
          `"reviewLoop.externalSecondOpinion" must be an object`
        );
      }
      const unknownExternalKeys = Object.keys(externalRaw).filter(
        (key) => key !== "enabled" && key !== "model" && key !== "scoreDeltaThreshold"
      );
      if (unknownExternalKeys.length > 0) {
        throw configValidationError(
          fullPath,
          `"reviewLoop.externalSecondOpinion" has unknown key(s): ${unknownExternalKeys.join(", ")}`
        );
      }
      if (externalRaw.enabled !== undefined && typeof externalRaw.enabled !== "boolean") {
        throw configValidationError(
          fullPath,
          `"reviewLoop.externalSecondOpinion.enabled" must be a boolean`
        );
      }
      if (externalRaw.model !== undefined && typeof externalRaw.model !== "string") {
        throw configValidationError(
          fullPath,
          `"reviewLoop.externalSecondOpinion.model" must be a string`
        );
      }
      if (
        externalRaw.scoreDeltaThreshold !== undefined &&
        (
          typeof externalRaw.scoreDeltaThreshold !== "number" ||
          Number.isNaN(externalRaw.scoreDeltaThreshold) ||
          externalRaw.scoreDeltaThreshold < 0 ||
          externalRaw.scoreDeltaThreshold > 1
        )
      ) {
        throw configValidationError(
          fullPath,
          `"reviewLoop.externalSecondOpinion.scoreDeltaThreshold" must be a number between 0 and 1`
        );
      }
      externalSecondOpinion = {
        enabled: externalRaw.enabled === true,
        model: typeof externalRaw.model === "string" ? externalRaw.model : undefined,
        scoreDeltaThreshold:
          typeof externalRaw.scoreDeltaThreshold === "number"
            ? externalRaw.scoreDeltaThreshold
            : 0.2
      };
    }
    reviewLoop = { externalSecondOpinion };
  }

  return {
    version: parsed.version ?? CCLAW_VERSION,
    flowVersion: parsed.flowVersion ?? FLOW_VERSION,
    harnesses,
    vcs,
    strictness,
    tddTestGlobs,
    tdd: {
      testPathPatterns: resolvedTddTestPathPatterns,
      productionPathPatterns: resolvedTddProductionPathPatterns,
      verificationRef: explicitTddVerificationRef ?? "auto"
    },
    compound: {
      recurrenceThreshold: compoundRecurrenceThreshold
    },
    gitHookGuards,
    defaultTrack,
    languageRulePacks,
    trackHeuristics,
    sliceReview,
    ironLaws,
    optInAudits,
    reviewLoop
  };
}

/**
 * Fields that live on the populated runtime `CclawConfig` but are considered
 * "advanced" — we keep them in the in-memory object so downstream callers
 * don't have to branch, but we do **not** write them to `config.yaml` unless
 * the user set them explicitly. Keeps the default template small and honest:
 * only knobs a new user would meaningfully flip show up.
 */
type AdvancedConfigKey =
  | "vcs"
  | "tddTestGlobs"
  | "tdd"
  | "compound"
  | "defaultTrack"
  | "languageRulePacks"
  | "trackHeuristics"
  | "sliceReview"
  | "ironLaws"
  | "optInAudits"
  | "reviewLoop";

/**
 * Options controlling the serialisation shape of `config.yaml`.
 *
 * - `"full"` (default): write every field on the `CclawConfig` object that
 *   isn't `undefined`. Preserves existing shapes and keeps legacy callers
 *   working without migration.
 * - `"minimal"`: write only the user-facing knobs (`MINIMAL_CONFIG_KEYS`)
 *   plus any non-empty `languageRulePacks` (so auto-detected values survive
 *   a fresh `cclaw init`). Use this when generating the default template;
 *   power users can still add advanced keys by hand.
 *
 * `advancedKeysPresent` upgrades an otherwise-minimal serialisation by
 * including the listed advanced keys. `cclaw upgrade` uses it to preserve
 * the exact shape a user hand-authored, while still re-minimising configs
 * where the user stayed at defaults.
 */
export interface WriteConfigOptions {
  mode?: "full" | "minimal";
  advancedKeysPresent?: ReadonlySet<AdvancedConfigKey>;
}

function isMinimalKey(key: string): boolean {
  return (MINIMAL_CONFIG_KEYS as readonly string[]).includes(key);
}

function buildSerializableConfig(
  config: CclawConfig,
  options: WriteConfigOptions = {}
): Record<string, unknown> {
  const mode = options.mode ?? "full";
  const advanced = options.advancedKeysPresent;
  const output: Record<string, unknown> = {};
  const ordered: (keyof CclawConfig)[] = [
    "version",
    "flowVersion",
    "harnesses",
    "vcs",
    "strictness",
    "tddTestGlobs",
    "tdd",
    "compound",
    "gitHookGuards",
    "defaultTrack",
    "languageRulePacks",
    "trackHeuristics",
    "sliceReview",
    "ironLaws",
    "optInAudits",
    "reviewLoop"
  ];
  for (const key of ordered) {
    const value = config[key];
    if (value === undefined) continue;

    if (mode === "full") {
      output[key] = value;
      continue;
    }

    // Minimal mode: always include the short list; advanced keys only when
    // the caller explicitly opted in, or for auto-detected non-empty
    // `languageRulePacks`.
    if (isMinimalKey(key)) {
      output[key] = value;
      continue;
    }
    if (advanced?.has(key as AdvancedConfigKey)) {
      output[key] = value;
      continue;
    }
    if (key === "languageRulePacks" && Array.isArray(value) && value.length > 0) {
      output[key] = value;
    }
  }
  return output;
}

export async function writeConfig(
  projectRoot: string,
  config: CclawConfig,
  options: WriteConfigOptions = {}
): Promise<void> {
  const serialisable = buildSerializableConfig(config, options);
  await writeFileSafe(configPath(projectRoot), stringify(serialisable));
}

/**
 * Enumerate which advanced keys are currently set in the on-disk config.
 * Used by `cclaw upgrade` to preserve the user's existing shape — if they
 * wrote `tddTestGlobs` by hand, the upgrade keeps it; if they didn't, the
 * upgrade stays minimal.
 */
export async function detectAdvancedKeys(
  projectRoot: string
): Promise<ReadonlySet<AdvancedConfigKey>> {
  const fullPath = configPath(projectRoot);
  if (!(await exists(fullPath))) return new Set();
  try {
    const parsedUnknown = parse(await fs.readFile(fullPath, "utf8"));
    if (!isRecord(parsedUnknown)) return new Set();
    const advancedCandidates: AdvancedConfigKey[] = [
      "tddTestGlobs",
      "tdd",
      "compound",
      "defaultTrack",
      "languageRulePacks",
      "trackHeuristics",
      "sliceReview",
      "ironLaws",
      "optInAudits",
      "reviewLoop"
    ];
    const present = new Set<AdvancedConfigKey>();
    for (const key of advancedCandidates) {
      if (Object.prototype.hasOwnProperty.call(parsedUnknown, key)) {
        present.add(key);
      }
    }
    return present;
  } catch {
    return new Set();
  }
}
