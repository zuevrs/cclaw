import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { FLOW_TRACKS, HARNESS_IDS, LANGUAGE_RULE_PACKS } from "./types.js";
import type { FlowTrack, HarnessId, LanguageRulePack, VibyConfig } from "./types.js";

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
  "promptGuardMode",
  "tddEnforcement",
  "tddTestGlobs",
  "gitHookGuards",
  "defaultTrack",
  "languageRulePacks",
  "trackHeuristics",
  "sliceReview"
]);

const DEFAULT_SLICE_REVIEW_THRESHOLD = 5;
const DEFAULT_SLICE_REVIEW_TRACKS: FlowTrack[] = ["standard"];

function configFixExample(): string {
  return `harnesses:
  - claude
  - cursor`;
}

function configValidationError(configFilePath: string, reason: string): Error {
  return new Error(
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

export function createDefaultConfig(
  harnesses: HarnessId[] = DEFAULT_HARNESSES,
  defaultTrack: FlowTrack = "standard"
): VibyConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION,
    harnesses,
    promptGuardMode: "advisory",
    tddEnforcement: "advisory",
    tddTestGlobs: ["**/*.test.*", "**/*.spec.*", "**/test/**"],
    gitHookGuards: false,
    defaultTrack,
    languageRulePacks: []
  };
}

export async function readConfig(projectRoot: string): Promise<VibyConfig> {
  const fullPath = configPath(projectRoot);
  if (!(await exists(fullPath))) {
    return createDefaultConfig();
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = parse(await fs.readFile(fullPath, "utf8"));
  } catch {
    return createDefaultConfig();
  }

  const parsed = (parsedUnknown && typeof parsedUnknown === "object"
    ? parsedUnknown
    : {}) as Partial<VibyConfig>;
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
  const harnesses = hasHarnessesField
    ? [...new Set(validatedHarnesses)]
    : DEFAULT_HARNESSES;

  const promptGuardModeRaw = parsed.promptGuardMode;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "promptGuardMode") &&
    promptGuardModeRaw !== "advisory" &&
    promptGuardModeRaw !== "strict"
  ) {
    throw configValidationError(fullPath, `"promptGuardMode" must be "advisory" or "strict"`);
  }
  const promptGuardMode = promptGuardModeRaw === "strict" ? "strict" : "advisory";

  const tddEnforcementRaw = (parsed as { tddEnforcement?: unknown }).tddEnforcement;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "tddEnforcement") &&
    tddEnforcementRaw !== "advisory" &&
    tddEnforcementRaw !== "strict"
  ) {
    throw configValidationError(fullPath, `"tddEnforcement" must be "advisory" or "strict"`);
  }
  const tddEnforcement = tddEnforcementRaw === "strict" ? "strict" : "advisory";

  const tddTestGlobsRaw = (parsed as { tddTestGlobs?: unknown }).tddTestGlobs;
  const tddTestGlobs = validateStringArray(tddTestGlobsRaw, "tddTestGlobs", fullPath)
    ?? ["**/*.test.*", "**/*.spec.*", "**/test/**"];

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
  let trackHeuristics: VibyConfig["trackHeuristics"] = undefined;
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
    let tracks: NonNullable<VibyConfig["trackHeuristics"]>["tracks"] = undefined;
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
  let sliceReview: VibyConfig["sliceReview"] = undefined;
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

  return {
    version: parsed.version ?? CCLAW_VERSION,
    flowVersion: parsed.flowVersion ?? FLOW_VERSION,
    harnesses,
    promptGuardMode,
    tddEnforcement,
    tddTestGlobs,
    gitHookGuards,
    defaultTrack,
    languageRulePacks,
    trackHeuristics,
    sliceReview
  };
}

export async function writeConfig(projectRoot: string, config: VibyConfig): Promise<void> {
  await writeFileSafe(configPath(projectRoot), stringify(config));
}
