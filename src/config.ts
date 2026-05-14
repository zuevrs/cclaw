import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { HARNESS_IDS, type HarnessId } from "./types.js";

/**
 * Per-specialist model preference (T3-2, v8.13). Maps each cclaw specialist
 * id to one of three logical model tiers; the harness translates the tier
 * to a concrete model name (some harnesses ignore the field entirely, in
 * which case the orchestrator falls back to the harness default).
 *
 * Tiers (deliberately abstract to avoid pinning to specific provider names):
 *   - "fast"      — short-context, fast turn-around (cheap models suit
 *                   slice-builder cycles, research helpers, slim summaries).
 *   - "balanced"  — default mid-tier (ac-author / reviewer for routine work).
 *   - "powerful"  — deep-context, slow but high-quality (design /
 *                   adversarial review / security-reviewer for ambiguous,
 *                   large-risky, or security-sensitive work).
 *
 * Harness mapping is documented in the harness-specific docs; cclaw itself
 * just plumbs the tier hint into the dispatch envelope.
 */
export type ModelTier = "fast" | "balanced" | "powerful";

export interface ModelPreferences {
  design?: ModelTier;
  "ac-author"?: ModelTier;
  "slice-builder"?: ModelTier;
  reviewer?: ModelTier;
  "security-reviewer"?: ModelTier;
  "learnings-research"?: ModelTier;
  "repo-research"?: ModelTier;
  /**
   * Legacy aliases (pre-v8.14). Retained so users with existing
   * `.cclaw/config.yaml` files don't see schema-validation errors after
   * upgrading. The orchestrator collapses both onto the `design` tier at
   * dispatch time (highest of the two wins when both are set).
   */
  brainstormer?: ModelTier;
  architect?: ModelTier;
  /**
   * Legacy alias from pre-v8.28 (`planner` was the v8.14–v8.27 spelling).
   * Retained so users with existing `.cclaw/config.yaml` files don't see
   * schema-validation errors after upgrading. Equivalent to `"ac-author"`
   * — the orchestrator reads either at dispatch time. Slated for removal
   * in v8.29+.
   */
  planner?: ModelTier;
}

/**
 * v8.53 — design phase tunables. Optional block in `.cclaw/config.yaml`;
 * every field is independently optional and falls back to a documented
 * default when absent. The block exists so the v8.53 ambiguity-threshold
 * knob has a typed home (we do NOT want orchestrator prompts reaching
 * for free-form `unknown` keys).
 */
export interface DesignConfig {
  /**
   * v8.53 — composite-ambiguity threshold for the Phase 7 warning prefix.
   *
   * The design specialist computes an `ambiguity_score` in Phase 6 across
   * 3 dimensions (greenfield: goal / constraints / success) or 4
   * dimensions (brownfield: + context). At Phase 7, if the composite
   * score exceeds this threshold, the picker is prefixed with a soft
   * warning ("⚠ Composite ambiguity X exceeds threshold Y —
   * request-changes recommended for: …"). The user can still approve;
   * this is informational, not a hard gate.
   *
   * Default `0.2`. Values outside `[0.0, 1.0]` fall back to `0.2` at
   * read-time and design Phase 6 surfaces a one-line note in
   * `plan.md > ## Open questions` so the misconfig is auditable.
   */
  ambiguity_threshold?: number;
}

export interface CclawConfig {
  version: string;
  flowVersion: "8";
  harnesses: HarnessId[];
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
  /**
   * v8.53 — design phase tunables. The only field today is
   * {@link DesignConfig.ambiguity_threshold}, but the block is shaped
   * to accept future design-phase knobs without churning the top-level
   * config schema.
   */
  design?: DesignConfig;
}

/**
 * v8.53 — default composite-ambiguity threshold used when
 * `.cclaw/config.yaml > design.ambiguity_threshold` is absent or
 * out-of-range. Exposed as a const so tests + orchestrator readers
 * share the canonical value.
 */
export const DEFAULT_AMBIGUITY_THRESHOLD = 0.2;

/**
 * v8.53 — read the configured ambiguity threshold with the documented
 * fallback. Returns {@link DEFAULT_AMBIGUITY_THRESHOLD} when the config
 * is absent, the `design` block is missing, the field is absent, or the
 * configured value is not a finite number in `[0.0, 1.0]`. Out-of-range
 * values fall back silently at read time (design Phase 6 emits a note
 * in `plan.md > ## Open questions` to keep the misconfig auditable).
 */
export function ambiguityThresholdOf(config: CclawConfig | null | undefined): number {
  const raw = config?.design?.ambiguity_threshold;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_AMBIGUITY_THRESHOLD;
  if (raw < 0 || raw > 1) return DEFAULT_AMBIGUITY_THRESHOLD;
  return raw;
}

export function createDefaultConfig(harnesses: HarnessId[] = ["cursor"]): CclawConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: "8",
    harnesses,
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
    const parsed = YAML.parse(raw) as CclawConfig & { hooks?: unknown };
    if (parsed && typeof parsed === "object" && "hooks" in parsed) delete parsed.hooks;
    return parsed as CclawConfig;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}
