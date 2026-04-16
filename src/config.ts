import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { FLOW_TRACKS, HARNESS_IDS } from "./types.js";
import type { FlowTrack, HarnessId, InitProfile, VibyConfig } from "./types.js";

const CONFIG_PATH = `${RUNTIME_ROOT}/config.yaml`;
const HARNESS_ID_SET = new Set<string>(HARNESS_IDS);
const FLOW_TRACK_SET = new Set<string>(FLOW_TRACKS);
const SUPPORTED_HARNESSES_TEXT = HARNESS_IDS.join(", ");
const SUPPORTED_TRACKS_TEXT = FLOW_TRACKS.join(", ");
const ALLOWED_CONFIG_KEYS = new Set<string>([
  "version",
  "flowVersion",
  "harnesses",
  "autoAdvance",
  "promptGuardMode",
  "gitHookGuards",
  "defaultTrack"
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
      `Example config:\n${configFixExample()}\n` +
      `After fixing, run: cclaw sync`
  );
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
    gitHookGuards: false,
    defaultTrack
  };
}

/**
 * Build a VibyConfig for a named init profile. Profile defaults are applied
 * first, then any explicit overrides (CLI flags) win. This keeps the profile
 * contract deterministic and testable.
 */
export function createProfileConfig(
  profile: InitProfile,
  overrides: { harnesses?: HarnessId[]; defaultTrack?: FlowTrack } = {}
): VibyConfig {
  const base = createDefaultConfig();
  switch (profile) {
    case "minimal":
      return {
        ...base,
        harnesses: overrides.harnesses ?? ["claude"],
        autoAdvance: false,
        promptGuardMode: "advisory",
        gitHookGuards: false,
        defaultTrack: overrides.defaultTrack ?? "quick"
      };
    case "standard":
      return {
        ...base,
        harnesses: overrides.harnesses ?? DEFAULT_HARNESSES,
        autoAdvance: false,
        promptGuardMode: "advisory",
        gitHookGuards: false,
        defaultTrack: overrides.defaultTrack ?? "standard"
      };
    case "full":
      return {
        ...base,
        harnesses: overrides.harnesses ?? DEFAULT_HARNESSES,
        autoAdvance: false,
        promptGuardMode: "strict",
        gitHookGuards: true,
        defaultTrack: overrides.defaultTrack ?? "standard"
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

  return {
    version: parsed.version ?? CCLAW_VERSION,
    flowVersion: parsed.flowVersion ?? FLOW_VERSION,
    harnesses,
    autoAdvance,
    promptGuardMode,
    gitHookGuards,
    defaultTrack
  };
}

export async function writeConfig(projectRoot: string, config: VibyConfig): Promise<void> {
  await writeFileSafe(configPath(projectRoot), stringify(config));
}
