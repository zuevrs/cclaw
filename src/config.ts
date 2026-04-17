import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { FLOW_TRACKS, HARNESS_IDS, LANGUAGE_RULE_PACKS } from "./types.js";
import type { FlowTrack, HarnessId, InitProfile, LanguageRulePack, VibyConfig } from "./types.js";

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
  "autoAdvance",
  "promptGuardMode",
  "tddEnforcement",
  "tddTestGlobs",
  "gitHookGuards",
  "defaultTrack",
  "languageRulePacks",
  "trackHeuristics"
]);

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
    autoAdvance: false,
    promptGuardMode: "advisory",
    tddEnforcement: "advisory",
    tddTestGlobs: ["**/*.test.*", "**/*.spec.*", "**/test/**"],
    gitHookGuards: false,
    defaultTrack,
    languageRulePacks: []
  };
}

/**
 * Build a VibyConfig for a named init profile. Profile defaults are applied
 * first, then any explicit overrides (CLI flags) win. This keeps the profile
 * contract deterministic and testable.
 */
export function createProfileConfig(
  profile: InitProfile,
  overrides: {
    harnesses?: HarnessId[];
    defaultTrack?: FlowTrack;
    languageRulePacks?: LanguageRulePack[];
  } = {}
): VibyConfig {
  const base = createDefaultConfig();
  switch (profile) {
    case "minimal":
      return {
        ...base,
        harnesses: overrides.harnesses ?? ["claude"],
        autoAdvance: false,
        promptGuardMode: "advisory",
        tddEnforcement: "advisory",
        gitHookGuards: false,
        defaultTrack: overrides.defaultTrack ?? "medium",
        languageRulePacks: overrides.languageRulePacks ?? []
      };
    case "standard":
      return {
        ...base,
        harnesses: overrides.harnesses ?? DEFAULT_HARNESSES,
        autoAdvance: false,
        promptGuardMode: "advisory",
        tddEnforcement: "advisory",
        gitHookGuards: false,
        defaultTrack: overrides.defaultTrack ?? "standard",
        languageRulePacks: overrides.languageRulePacks ?? []
      };
    case "full":
      return {
        ...base,
        harnesses: overrides.harnesses ?? DEFAULT_HARNESSES,
        autoAdvance: false,
        promptGuardMode: "strict",
        tddEnforcement: "strict",
        gitHookGuards: true,
        defaultTrack: overrides.defaultTrack ?? "standard",
        languageRulePacks: overrides.languageRulePacks ?? [...LANGUAGE_RULE_PACKS]
      };
  }
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

  const autoAdvanceRaw = parsed.autoAdvance;
  const autoAdvance = typeof autoAdvanceRaw === "boolean" ? autoAdvanceRaw : false;

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

    const priorityRaw = trackHeuristicsRaw.priority;
    let priority: FlowTrack[] | undefined;
    if (priorityRaw !== undefined) {
      if (!Array.isArray(priorityRaw)) {
        throw configValidationError(fullPath, `"trackHeuristics.priority" must be an array`);
      }
      const invalidPriority = priorityRaw.filter(
        (value) => typeof value !== "string" || !FLOW_TRACK_SET.has(value)
      );
      if (invalidPriority.length > 0) {
        throw configValidationError(
          fullPath,
          `"trackHeuristics.priority" must contain only: ${SUPPORTED_TRACKS_TEXT}`
        );
      }
      priority = [...new Set(priorityRaw as FlowTrack[])];
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

        const triggers = validateStringArray(
          ruleRaw.triggers,
          `trackHeuristics.tracks.${trackName}.triggers`,
          fullPath
        );
        const patterns = validateStringArray(
          ruleRaw.patterns,
          `trackHeuristics.tracks.${trackName}.patterns`,
          fullPath
        );
        const veto = validateStringArray(
          ruleRaw.veto,
          `trackHeuristics.tracks.${trackName}.veto`,
          fullPath
        );
        if (patterns) {
          for (const pattern of patterns) {
            try {
              // eslint-disable-next-line no-new
              new RegExp(pattern, "iu");
            } catch {
              throw configValidationError(
                fullPath,
                `"trackHeuristics.tracks.${trackName}.patterns" contains invalid regex "${pattern}"`
              );
            }
          }
        }
        tracks[trackName as FlowTrack] = {
          triggers,
          patterns,
          veto
        };
      }
    }

    trackHeuristics = {
      fallback: fallbackRaw as FlowTrack | undefined,
      priority,
      tracks
    };
  }

  return {
    version: parsed.version ?? CCLAW_VERSION,
    flowVersion: parsed.flowVersion ?? FLOW_VERSION,
    harnesses,
    autoAdvance,
    promptGuardMode,
    tddEnforcement,
    tddTestGlobs,
    gitHookGuards,
    defaultTrack,
    languageRulePacks,
    trackHeuristics
  };
}

export async function writeConfig(projectRoot: string, config: VibyConfig): Promise<void> {
  await writeFileSafe(configPath(projectRoot), stringify(config));
}
