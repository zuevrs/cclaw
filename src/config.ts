import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT, CCLAW_VERSION } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { AGENTS_MD_MODES, HARNESS_IDS } from "./types.js";
import type { AgentsMdMode, HarnessId, CclawConfig } from "./types.js";

const CONFIG_PATH = `${RUNTIME_ROOT}/config.yaml`;
const HARNESS_ID_SET = new Set<string>(HARNESS_IDS);
const SUPPORTED_HARNESSES_TEXT = HARNESS_IDS.join(", ");
const AGENTS_MD_MODE_SET = new Set<string>(AGENTS_MD_MODES);
const SUPPORTED_AGENTS_MD_MODES_TEXT = AGENTS_MD_MODES.join(", ");

function configFixExample(): string {
  return `harnesses:
  - claude
  - cursor
agentsMdMode: minimal`;
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

export function createDefaultConfig(
  harnesses: HarnessId[] = DEFAULT_HARNESSES,
  agentsMdMode: AgentsMdMode = "minimal"
): CclawConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION,
    harnesses,
    agentsMdMode
  };
}

export async function readConfig(projectRoot: string): Promise<CclawConfig> {
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
    : {}) as Partial<CclawConfig>;
  const hasHarnessesField = Object.prototype.hasOwnProperty.call(parsed, "harnesses");
  if (hasHarnessesField && !Array.isArray(parsed.harnesses)) {
    throw configValidationError(fullPath, `"harnesses" must be an array`);
  }

  const hasAgentsMdModeField = Object.prototype.hasOwnProperty.call(parsed, "agentsMdMode");
  if (hasAgentsMdModeField && typeof parsed.agentsMdMode !== "string") {
    throw configValidationError(fullPath, `"agentsMdMode" must be a string`);
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

  const configuredAgentsMdMode = parsed.agentsMdMode;
  if (typeof configuredAgentsMdMode === "string" && !AGENTS_MD_MODE_SET.has(configuredAgentsMdMode)) {
    throw configValidationError(
      fullPath,
      `unknown agentsMdMode "${configuredAgentsMdMode}". Supported values: ${SUPPORTED_AGENTS_MD_MODES_TEXT}`
    );
  }

  const agentsMdMode = (configuredAgentsMdMode as AgentsMdMode | undefined) ?? "minimal";

  return {
    version: parsed.version ?? CCLAW_VERSION,
    flowVersion: parsed.flowVersion ?? FLOW_VERSION,
    harnesses,
    agentsMdMode
  };
}

export async function writeConfig(projectRoot: string, config: CclawConfig): Promise<void> {
  await writeFileSafe(configPath(projectRoot), stringify(config));
}
