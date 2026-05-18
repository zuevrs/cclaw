import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { HARNESS_IDS, type HarnessId, type SpecialistId } from "./types.js";

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
 * Canonical immutable list of model-tier literal values. Exposed as a
 * `const` array so tests can sweep the union without restating the
 * literal triple. Mirrors the {@link ModelTier} union exactly.
 */
export const MODEL_TIERS = ["fast", "balanced", "powerful"] as const;

/**
 * Per-specialist model-tier preferences. v8.87 ships defaults for every
 * live specialist id in {@link SPECIALISTS} plus the two read-only
 * research helpers (`learnings-research` / `repo-research`); a handful
 * of legacy keys (pre-v8.62 ids) are kept so existing user
 * `.cclaw/config.yaml` files don't fail validation after upgrade.
 *
 * Every field is optional; absent fields fall back to
 * {@link DEFAULT_MODEL_PREFERENCES} via {@link resolveModelPreferences}.
 */
export interface ModelPreferences {
  // --- v8.62+ live specialists (from `SPECIALISTS` in `types.ts`). ---
  triage?: ModelTier;
  investigator?: ModelTier;
  architect?: ModelTier;
  builder?: ModelTier;
  "plan-critic"?: ModelTier;
  "plan-design"?: ModelTier;
  "plan-devex"?: ModelTier;
  "qa-runner"?: ModelTier;
  reviewer?: ModelTier;
  critic?: ModelTier;

  // --- Read-only research helpers (not in `SPECIALISTS`, but dispatched). ---
  "learnings-research"?: ModelTier;
  "repo-research"?: ModelTier;

  /**
   * Legacy specialist ids retired by v8.62 — kept so users with existing
   * `.cclaw/config.yaml` files don't see schema-validation errors after
   * upgrading.
   *
   * - `slice-builder` → renamed to {@link ModelPreferences.builder} (v8.62).
   * - `design` / `ac-author` → absorbed into {@link ModelPreferences.architect}
   *   (v8.62 unified flow retired the discovery sub-phase).
   * - `security-reviewer` → absorbed into {@link ModelPreferences.reviewer}'s
   *   `security` axis (v8.62; full threat-model + sensitive-change protocol
   *   moved into the reviewer prompt).
   * - `brainstormer` → removed v8.14.
   * - `planner` → renamed to `ac-author` v8.14–v8.27, then absorbed into
   *   `architect` v8.62.
   *
   * The resolver does NOT collapse legacy keys onto live keys — if a user
   * config carries `slice-builder: powerful` and the upgrade renamed the
   * specialist to `builder`, the live-key default wins. To migrate, the
   * user re-types the value under the live key. The legacy fields exist
   * only so the YAML still parses.
   */
  "slice-builder"?: ModelTier;
  design?: ModelTier;
  "ac-author"?: ModelTier;
  "security-reviewer"?: ModelTier;
  brainstormer?: ModelTier;
  planner?: ModelTier;
}

/**
 * Specialist ids (live + research helpers) that {@link DEFAULT_MODEL_PREFERENCES}
 * carries an explicit tier for. Tighter than `keyof ModelPreferences` because
 * the legacy keys are not part of the default mapping.
 */
export type ModelPreferenceKey =
  | SpecialistId
  | "learnings-research"
  | "repo-research";

/**
 * Default model-tier policy shipped with v8.87. Reference: obra's
 * `subagent-driven-development` model-selection block — fast tiers run
 * the cheap, fast, high-throughput cycles (slice-builder cycles,
 * research helpers); powerful runs the deep adversarial work; everything
 * else runs at the balanced mid-tier.
 *
 * Specialists are identified by their v8.62 live ids (the v8.13-era
 * `slice-builder` alias is back-compat only — its tier intent is
 * inherited by `builder`).
 *
 * The mapping is FROZEN at construction so test mutations can't
 * silently corrupt the default at the module level.
 *
 * ## Two-source-of-truth pattern (v8.87 + v8.94)
 *
 * The cclaw orchestrator's LLM consumer reads this policy via a mirrored
 * markdown table in the on-demand `dispatch-envelope` runbook (see
 * `## Model-tier hint (v8.87)` in
 * {@link ../content/runbooks-on-demand.ts}). That runbook table is the
 * LLM-facing canonical source — when the orchestrator stamps the
 * `Model tier:` line on a dispatch envelope, it looks at the runbook
 * table, not at this TypeScript constant.
 *
 * This TS constant exists for FUTURE programmatic callers that need to
 * resolve a tier without going through the LLM — e.g. a CI harness that
 * pre-validates `.cclaw/config.yaml > modelPreferences`, or a future
 * non-LLM dispatcher. As of v8.94 no production module imports
 * {@link resolveModelPreferences} or {@link modelTierFor}; the helpers
 * are intentionally kept available so the next caller doesn't re-derive
 * the policy from scratch.
 *
 * The two surfaces (this constant + the runbook table) are pinned to
 * identical values by the `tests/unit/v894-model-tier-sync.test.ts`
 * tripwire. Editing one without the other fails the build.
 */
export const DEFAULT_MODEL_PREFERENCES: Readonly<
  Record<ModelPreferenceKey, ModelTier>
> = Object.freeze({
  // fast — short-context, high-throughput cycles.
  builder: "fast",
  "learnings-research": "fast",
  "repo-research": "fast",

  // balanced — routine mid-tier specialists.
  triage: "balanced",
  investigator: "balanced",
  architect: "balanced",
  "plan-critic": "balanced",
  "plan-design": "balanced",
  "plan-devex": "balanced",
  "qa-runner": "balanced",
  reviewer: "balanced",

  // powerful — adversarial / high-stakes review.
  critic: "powerful"
});

/**
 * Merge user-supplied {@link ModelPreferences} (from `.cclaw/config.yaml`)
 * onto {@link DEFAULT_MODEL_PREFERENCES}. User entries override defaults
 * field-by-field; absent fields keep their default. Values that don't
 * match {@link MODEL_TIERS} (typos, wrong types) are silently dropped so
 * the default tier survives — out-of-range tiers are a config error, not
 * a runtime crash.
 *
 * The result is always a `Required<Record<ModelPreferenceKey, ModelTier>>`
 * so downstream readers never have to handle the absent case.
 *
 * Audience: programmatic callers that need to resolve the merged tier
 * policy without prompting the LLM. The production orchestrator does NOT
 * call this — it reads the policy via the mirrored runbook table in
 * `runbooks-on-demand.ts` (see {@link DEFAULT_MODEL_PREFERENCES} for the
 * two-source-of-truth rationale). The two surfaces are pinned to
 * identical values by `tests/unit/v894-model-tier-sync.test.ts`, so this
 * helper stays usable for future callers (e.g. a CI validator that
 * pre-checks `.cclaw/config.yaml > modelPreferences` against the policy)
 * without diverging from what the LLM reads.
 */
export function resolveModelPreferences(
  config: CclawConfig | null | undefined
): Record<ModelPreferenceKey, ModelTier> {
  const merged: Record<ModelPreferenceKey, ModelTier> = {
    ...DEFAULT_MODEL_PREFERENCES
  };
  const user = config?.modelPreferences;
  if (!user || typeof user !== "object") return merged;
  for (const key of Object.keys(DEFAULT_MODEL_PREFERENCES) as ModelPreferenceKey[]) {
    const raw = (user as Record<string, unknown>)[key];
    if (typeof raw === "string" && (MODEL_TIERS as readonly string[]).includes(raw)) {
      merged[key] = raw as ModelTier;
    }
  }
  return merged;
}

/**
 * Resolve the tier for one specialist id, applying the v8.62 legacy-alias
 * collapse for `slice-builder` → `builder`. Returns `undefined` if the
 * specialist isn't covered by the default policy AND the user hasn't
 * overridden it (so dispatchers can omit the hint and fall back to the
 * harness default).
 *
 * The collapse rule: a user config that still uses the v8.13-era
 * `slice-builder` key is read as a `builder` override ONLY when no
 * explicit `builder` key is set. An explicit `builder` value always
 * wins, even when both are present.
 *
 * Audience: same as {@link resolveModelPreferences} — programmatic
 * callers that need a single specialist's tier without round-tripping
 * through the LLM. As of v8.94 the production orchestrator stamps the
 * tier via the runbook-table mirror in `runbooks-on-demand.ts`, not by
 * calling this helper. The TS surface and the runbook table are pinned
 * by `tests/unit/v894-model-tier-sync.test.ts`, so adopting this helper
 * later (e.g. for a non-LLM dispatcher) needs no policy re-derivation.
 */
export function modelTierFor(
  specialist: ModelPreferenceKey | "slice-builder",
  config: CclawConfig | null | undefined
): ModelTier | undefined {
  const resolved = resolveModelPreferences(config);
  if (specialist === "slice-builder") {
    const user = config?.modelPreferences as
      | Record<string, unknown>
      | undefined;
    const explicitBuilder = user?.["builder"];
    if (
      typeof explicitBuilder === "string" &&
      (MODEL_TIERS as readonly string[]).includes(explicitBuilder)
    ) {
      return explicitBuilder as ModelTier;
    }
    const legacy = user?.["slice-builder"];
    if (
      typeof legacy === "string" &&
      (MODEL_TIERS as readonly string[]).includes(legacy)
    ) {
      return legacy as ModelTier;
    }
    return resolved.builder;
  }
  return resolved[specialist as ModelPreferenceKey];
}

/**
 * design phase tunables. Optional block in `.cclaw/config.yaml`;
 * every field is independently optional and falls back to a documented
 * default when absent. The block exists so the ambiguity-threshold
 * knob has a typed home (we do NOT want orchestrator prompts reaching
 * for free-form `unknown` keys).
 */
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
}

export interface DesignConfig {
  /**
   * composite-ambiguity threshold for the Phase 7 warning prefix.
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
   * design phase tunables. The only field today is
   * {@link DesignConfig.ambiguity_threshold}, but the block is shaped
   * to accept future design-phase knobs without churning the top-level
   * config schema.
   */
  design?: DesignConfig;
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

/**
 * default composite-ambiguity threshold used when
 * `.cclaw/config.yaml > design.ambiguity_threshold` is absent or
 * out-of-range. Exposed as a const so tests + orchestrator readers
 * share the canonical value.
 */
export const DEFAULT_AMBIGUITY_THRESHOLD = 0.2;

/**
 * read the configured ambiguity threshold with the documented
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

/**
 * Default pre-plan clarify-threshold used when
 * `.cclaw/config.yaml > clarify.ambiguity_threshold` is absent or
 * out-of-range. Integer in `[0, 100]`; mirrors the v8.67 spec's
 * default of 60 (triage scores >= 60 open the architect's Clarify
 * phase on non-inline paths).
 */
export const DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD = 60;

/**
 * read the configured pre-plan clarify threshold with the documented
 * fallback. Returns {@link DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD} when
 * the config is absent, the `clarify` block is missing, the field is
 * absent, or the configured value is not a finite number in
 * `[0, 100]`. Out-of-range values fall back silently at read time;
 * downstream specialists may surface a one-line note when they
 * notice the misconfig.
 */
export function clarifyAmbiguityThresholdOf(
  config: CclawConfig | null | undefined
): number {
  const raw = config?.clarify?.ambiguity_threshold;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD;
  }
  if (raw < 0 || raw > 100) return DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD;
  return raw;
}

/**
 * Default for `critic.cross_model` when the knob is absent or not a
 * boolean. Exposed as a const so tests + orchestrator readers share the
 * canonical value. v8.72 ships the knob OFF — opt-in by design so a
 * harness without an MCP cross-model tool wired doesn't surface the
 * "Cross-model unavailable: skipped" fallback on every critic dispatch.
 */
export const DEFAULT_CRITIC_CROSS_MODEL = false;

/**
 * Read the configured `critic.cross_model` knob with the documented
 * fallback. Returns {@link DEFAULT_CRITIC_CROSS_MODEL} (`false`) when
 * the config is absent, the `critic` block is missing, the field is
 * absent, or the value is not a boolean. The orchestrator combines
 * this value with the high-stakes detection + the `--critic-cross-model`
 * CLI flag to decide whether to stamp `crossModelCritic: true` in the
 * critic dispatch envelope.
 */
export function criticCrossModelOf(config: CclawConfig | null | undefined): boolean {
  const raw = config?.critic?.cross_model;
  if (typeof raw !== "boolean") return DEFAULT_CRITIC_CROSS_MODEL;
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
