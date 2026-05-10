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
  /**
   * Opt-in flag (default `false`) that preserves the v8.11-and-earlier
   * 9-artefact layout: a separate `manifest.md`, `pre-mortem.md`, and
   * `research-learnings.md` per shipped slug, plus the deleted
   * recovery / research / examples library.
   *
   * v8.12 default behaviour:
   *   - `manifest.md` collapses into `ship.md` frontmatter.
   *   - `pre-mortem.md` collapses into a `## Pre-mortem (adversarial)` section
   *     appended to `review.md`.
   *   - `research-learnings.md` is replaced by an inline `lessons={...}` blob
   *     in the learnings-research slim-summary, copied verbatim into
   *     `plan.md`'s "Prior lessons" section.
   *
   * Set `legacyArtifacts: true` in `.cclaw/config.yaml` to keep the old
   * 9-artefact layout for downstream tooling that still expects those files.
   */
  legacyArtifacts?: boolean;
}

export function createDefaultConfig(harnesses: HarnessId[] = ["cursor"]): CclawConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: "8",
    harnesses,
    hooks: { profile: "minimal" },
    legacyArtifacts: false
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
