import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { HARNESS_IDS, type HarnessId } from "./types.js";

export type HookProfile = "minimal" | "strict";

export interface CclawConfig {
  version: string;
  flowVersion: "8";
  harnesses: HarnessId[];
  hooks: { profile: HookProfile };
}

export function createDefaultConfig(harnesses: HarnessId[] = ["cursor"]): CclawConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: "8",
    harnesses,
    hooks: { profile: "minimal" }
  };
}

export function validateHarnesses(value: string[]): HarnessId[] {
  if (value.length === 0) {
    throw new Error("At least one harness must be selected.");
  }
  const invalid = value.filter((item) => !HARNESS_IDS.includes(item as HarnessId));
  if (invalid.length > 0) {
    throw new Error(`Unknown harnesses: ${invalid.join(", ")}. Supported: ${HARNESS_IDS.join(", ")}`);
  }
  return value as HarnessId[];
}

export function renderConfig(config: CclawConfig): string {
  return YAML.stringify(config);
}

export async function readConfig(projectRoot: string): Promise<CclawConfig | null> {
  const configPath = path.join(projectRoot, RUNTIME_ROOT, "config.yaml");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return YAML.parse(raw) as CclawConfig;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}
