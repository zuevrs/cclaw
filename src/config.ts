import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { HARNESS_IDS } from "./types.js";
import type { HarnessId, VibyConfig } from "./types.js";

const CONFIG_PATH = `${RUNTIME_ROOT}/config.yaml`;
const HARNESS_ID_SET = new Set<string>(HARNESS_IDS);
const SUPPORTED_HARNESSES_TEXT = HARNESS_IDS.join(", ");
const ALLOWED_CONFIG_KEYS = new Set<string>([
  "version",
  "flowVersion",
  "harnesses",
  "autoAdvance",
  "globalLearnings",
  "globalLearningsPath"
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
      `Example config:\n${configFixExample()}\n` +
      `After fixing, run: cclaw sync`
  );
}

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_PATH);
}

export function createDefaultConfig(harnesses: HarnessId[] = DEFAULT_HARNESSES): VibyConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION,
    harnesses,
    autoAdvance: false,
    globalLearnings: false
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

  const autoAdvanceRaw = parsed.autoAdvance;
  const autoAdvance = typeof autoAdvanceRaw === "boolean" ? autoAdvanceRaw : false;

  const globalLearningsRaw = parsed.globalLearnings;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "globalLearnings") &&
    typeof globalLearningsRaw !== "boolean"
  ) {
    throw configValidationError(fullPath, `"globalLearnings" must be a boolean`);
  }
  const globalLearnings = typeof globalLearningsRaw === "boolean" ? globalLearningsRaw : false;

  const globalLearningsPathRaw = parsed.globalLearningsPath;
  if (
    Object.prototype.hasOwnProperty.call(parsed, "globalLearningsPath") &&
    typeof globalLearningsPathRaw !== "string"
  ) {
    throw configValidationError(fullPath, `"globalLearningsPath" must be a string`);
  }
  const globalLearningsPath = typeof globalLearningsPathRaw === "string" && globalLearningsPathRaw.trim().length > 0
    ? globalLearningsPathRaw.trim()
    : undefined;

  return {
    version: parsed.version ?? CCLAW_VERSION,
    flowVersion: parsed.flowVersion ?? FLOW_VERSION,
    harnesses,
    autoAdvance,
    globalLearnings,
    globalLearningsPath
  };
}

export async function writeConfig(projectRoot: string, config: VibyConfig): Promise<void> {
  await writeFileSafe(configPath(projectRoot), stringify(config));
}
