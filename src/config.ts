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

/**
 * Per-specialist model-tier preferences. Optional typed home for the
 * `.cclaw/config.yaml > modelPreferences` block: each live specialist id
 * (plus the two read-only research helpers `learnings-research` /
 * `repo-research`) maps to a {@link ModelTier} hint. Every field is
 * optional; absent fields fall back to the harness default.
 *
 * The orchestrator (LLM) reads the default policy plus this override from
 * the mirrored `## Model-tier hint` table in the `dispatch-envelope`
 * runbook, not via a TypeScript reader.
 */
export interface ModelPreferences {
  // --- v8.62+ live specialists (from `SPECIALISTS` in `types.ts`). ---
  triage?: ModelTier;
  investigator?: ModelTier;
  architect?: ModelTier;
  builder?: ModelTier;
  "plan-critic"?: ModelTier;
  "qa-runner"?: ModelTier;
  reviewer?: ModelTier;
  critic?: ModelTier;

  // --- Read-only research helpers (not in `SPECIALISTS`, but dispatched). ---
  "learnings-research"?: ModelTier;
  "repo-research"?: ModelTier;
}

/**
 * Pre-plan clarify-phase tunables (v8.67). Optional block in
 * `.cclaw/config.yaml`; every field is independently optional and
 * falls back to a documented default when absent. The block exists
 * so the ambiguity-threshold knob has a typed home (we do NOT want
 * orchestrator prompts reaching for free-form `unknown` keys).
 */
export interface ClarifyConfig {
  /**
   * threshold the architect compares `triage.ambiguityScore` against
   * before opening the Clarify phase. `triage.ambiguityScore >= this`
   * AND `triage.ceremonyMode != "inline"` opens Clarify; otherwise
   * the architect skips straight to plan authoring.
   *
   * Default `60`. Integer in `[0, 100]`. Values outside the range
   * fall back to the default at read time (a separate config
   * misconfiguration note can land in `plan.md > ## Open questions`).
   */
  ambiguity_threshold?: number;
}

/**
 * critic phase tunables (v8.72). Optional block in `.cclaw/config.yaml`;
 * every field is independently optional and falls back to a documented
 * default when absent. The block exists so the cross-model-critic knob
 * has a typed home (we do NOT want orchestrator prompts reaching for
 * free-form `unknown` keys).
 */
export interface CriticConfig {
  /**
   * Whether the critic specialist may run a **second adversarial pass via
   * a different model** through an available MCP cross-model tool
   * (Codex / Gemini / etc.) on high-stakes slugs. The orchestrator stamps
   * `crossModelCritic: true` into the critic dispatch envelope when ANY
   * of the following hold:
   *   - this knob is `true` AND the slug is high-stakes (security_flag /
   *     critical-path / irreversible D-N) OR
   *   - the user explicitly invoked `/cc --critic-cross-model`.
   *
   * Default `false`. The critic gracefully falls back with a one-line
   * "Cross-model unavailable: skipped" note when the MCP tool is not
   * wired into the harness (no install-layer change required to opt in
   * later — the default-off knob keeps the surface inert until the MCP
   * is configured).
   */
  cross_model?: boolean;
  /**
   * Minimum context-window budget (in characters; the critic estimates
   * tokens as characters/4) the second-opinion model must support before
   * the cross-model dispatch fires without trimming (v8.108 — F-1).
   *
   * The critic estimates the assembled prompt size pre-dispatch
   * (`plan.md + review.md + critic.md + priorLearnings + researchExcerpts
   * + axisGate + skillsBlock`) and compares it against this budget:
   *
   *   - `estimate ≤ budget` → dispatch as-is, no disclosure note.
   *   - `estimate > budget` AND the minimum-set (critic.md body +
   *     axisGate + skillsBlock + slim plan) still fits → apply the
   *     priority-drop trim list (priorLearnings → researchExcerpts →
   *     plan.md → review.md), stamp a disclosure note in critic.md
   *     frontmatter.
   *   - Min-set overflow → refuse-and-skip the dispatch, record
   *     `cross_model_skipped_reason: budget` in critic.md frontmatter
   *     (does NOT block ship — the cross-model pass is graceful).
   *
   * Default `16000` characters (≈ 4k tokens at the 4-chars-per-token
   * estimate). Sized around the smallest second-opinion model context
   * window currently seen in the wild (Gemini Nano variants, local
   * 7B-class Codex stand-ins). The default is conservative — projects
   * pointing the cross-model dispatch at a larger model (Codex
   * 200k-context / Gemini 1.5 Pro) raise this knob to suppress
   * unnecessary trim ceremony.
   *
   * Pattern: gsd-v1 #3081 / `6a5fa591` (review.max_prompt_tokens with
   * priority-drop ordering + minSet refuse-and-skip). cclaw's surface
   * is single-knob because the second-opinion model is one slot, not
   * a fan-out of N reviewers.
   */
  cross_model_min_context?: number;
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
   * default behaviour:
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
   * Pre-plan clarify-phase tunables (v8.67). The only field today is
   * {@link ClarifyConfig.ambiguity_threshold}; the block is shaped so
   * future clarify-mode knobs (max-question count, ack-window phrases)
   * can land here without churning the top-level schema.
   */
  clarify?: ClarifyConfig;
  /**
   * critic phase tunables (v8.72). The only field today is
   * {@link CriticConfig.cross_model}; the block is shaped so future
   * critic knobs (token-budget overrides, escalation-trigger tunables)
   * can land here without churning the top-level schema.
   */
  critic?: CriticConfig;
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
