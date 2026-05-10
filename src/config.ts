import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { HARNESS_IDS, type HarnessId } from "./types.js";

export type HookProfile = "minimal" | "strict";

/**
 * Per-specialist model preference (T3-2, v8.13). Maps each cclaw specialist
 * id to one of three logical model tiers; the harness translates the tier
 * to a concrete model name (some harnesses ignore the field entirely, in
 * which case the orchestrator falls back to the harness default).
 *
 * Tiers (deliberately abstract to avoid pinning to specific provider names):
 *   - "fast"      — short-context, fast turn-around (cheap models suit
 *                   slice-builder cycles, research helpers, slim summaries).
 *   - "balanced"  — default mid-tier (planner / reviewer for routine work).
 *   - "powerful"  — deep-context, slow but high-quality (architect /
 *                   adversarial review / security-reviewer / brainstormer
 *                   for ambiguous large-risky work).
 *
 * Harness mapping is documented in the harness-specific docs; cclaw itself
 * just plumbs the tier hint into the dispatch envelope.
 */
export type ModelTier = "fast" | "balanced" | "powerful";

export interface ModelPreferences {
  brainstormer?: ModelTier;
  architect?: ModelTier;
  planner?: ModelTier;
  "slice-builder"?: ModelTier;
  reviewer?: ModelTier;
  "security-reviewer"?: ModelTier;
  "learnings-research"?: ModelTier;
  "repo-research"?: ModelTier;
}

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
  /**
   * Per-specialist model preference hints (T3-2, v8.13). Optional; absent
   * fields fall back to the harness default. The orchestrator includes the
   * tier hint in dispatch envelopes; harnesses that support model routing
   * (e.g., custom OpenCode profiles, Claude Code agent.toml) honour it.
   */
  modelPreferences?: ModelPreferences;
  /**
   * How often the compound-refresh sub-step (T2-4, v8.13) runs. The pass
   * applies dedup / keep / update / consolidate / replace actions over
   * `.cclaw/knowledge.jsonl` to keep signal-to-noise high as the catalogue
   * grows. Defaults: every 5th capture, gated by floor of 10 entries.
   *
   * Set `compoundRefreshEvery: 0` to disable.
   */
  compoundRefreshEvery?: number;
  compoundRefreshFloor?: number;
  /**
   * CI-friendly opt-out for the learnings hard-stop ask (T1-13). When true,
   * the orchestrator silently skips the learnings-capture prompt on slugs
   * whose compound quality gate doesn't fire — useful for autonomous
   * pipelines that don't want a structured-ask interruption.
   */
  captureLearningsBypass?: boolean;
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
