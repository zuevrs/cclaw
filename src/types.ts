export const FLOW_STAGES = [
  "brainstorm",
  "scope",
  "design",
  "spec",
  "plan",
  "tdd",
  "review",
  "ship"
] as const;

export type FlowStage = (typeof FLOW_STAGES)[number];

export const FLOW_TRACKS = ["quick", "medium", "standard"] as const;
export type FlowTrack = (typeof FLOW_TRACKS)[number];

/**
 * Ordered stages that make up each flow track.
 *
 * - `standard` runs the full 8-stage pipeline (default — same as before tracks existed).
 * - `medium` keeps product framing but skips heavy scope/design lock-in:
 *   brainstorm -> spec -> plan -> tdd -> review -> ship.
 * - `quick` skips the upstream product stages (brainstorm/scope/design/plan) for
 *   small bug fixes or single-purpose changes where the spec is already known.
 *   It still keeps the non-negotiable safety gates: spec → tdd → review → ship.
 */
export const TRACK_STAGES: Record<FlowTrack, readonly FlowStage[]> = {
  standard: FLOW_STAGES,
  medium: ["brainstorm", "spec", "plan", "tdd", "review", "ship"],
  quick: ["spec", "tdd", "review", "ship"]
} as const;

export const HARNESS_IDS = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * Opt-in language rule packs. When enabled in config, `cclaw sync` installs the
 * corresponding utility skill so the meta-skill router can load language-specific
 * anti-patterns, idioms, and review heuristics during review/tdd stages.
 *
 * Opt-in intentional: cclaw stays language-agnostic by default; rule packs are
 * additive context that the user must explicitly enable.
 */
export const LANGUAGE_RULE_PACKS = ["typescript", "python", "go"] as const;
export type LanguageRulePack = (typeof LANGUAGE_RULE_PACKS)[number];

/**
 * Per-track vocabulary hints the LLM applies when classifying a /cc prompt.
 *
 * Intentionally minimal:
 * - `triggers`: additional substrings that push a prompt toward this track.
 * - `veto`:     substrings that forbid this track even if a trigger matches.
 *
 * Removed in v0.38.0:
 * - `patterns` (regex): no runtime ever consumed them; kept authors honest
 *   about what cclaw actually enforces.
 */
export interface TrackHeuristicRule {
  triggers?: string[];
  veto?: string[];
}

/**
 * Optional prompt-to-track overrides for /cc classification.
 *
 * Honesty note: this config is **advisory**. cclaw surfaces these lists in
 * the /cc skill and contract prose so the LLM can apply them when picking a
 * track. There is no Node-level routing layer that mechanically enforces the
 * result — which is why we only ship `triggers`, `veto`, and `fallback`, not
 * regex patterns or priority overrides.
 *
 * Removed in v0.38.0:
 * - `priority`: track evaluation order is always `standard -> medium -> quick`
 *   (narrow-to-broad matching). Overriding it was never wired.
 */
export interface TrackHeuristicsConfig {
  /** Track used when no trigger matches. Defaults to `standard`. */
  fallback?: FlowTrack;
  /** Per-track vocabulary hints. */
  tracks?: Partial<Record<FlowTrack, TrackHeuristicRule>>;
}

/**
 * Opt-in plan-slice review heuristic.
 *
 * When enabled, the TDD stage skill is instructed to insert a
 * `## Per-Slice Review` section into `06-tdd.md` for every plan slice
 * whose estimated `touchCount` meets `filesChangedThreshold`, whose
 * `touchPaths` match any `touchTriggers` glob, or whose plan row is
 * flagged `highRisk: true`. The section records a short spec-compliance
 * pass plus a short quality pass (delegated to the `reviewer` subagent
 * when the harness supports native dispatch, otherwise fulfilled via
 * an explicit in-session role switch with evidence).
 *
 * Track gating: `enforceOnTracks` lists the tracks where the doctor
 * check escalates to a warning. Tracks outside this list still see
 * the skill prose but leave the decision to the user.
 *
 * All fields optional; sensible defaults: disabled, threshold 5, no
 * touch triggers, `enforceOnTracks: ["standard"]`.
 */
export interface SliceReviewConfig {
  /** Turn the heuristic on (disabled by default). */
  enabled?: boolean;
  /** Minimum estimated touchCount for a slice to be eligible. */
  filesChangedThreshold?: number;
  /** Glob hints; any plan-task touchPath match triggers review. */
  touchTriggers?: string[];
  /** Tracks on which missed reviews escalate to a doctor warning. */
  enforceOnTracks?: FlowTrack[];
}

/**
 * File-path routing hints used by workflow-guard during `tdd` stage.
 *
 * - `testPathPatterns`: paths considered test-side changes (RED writes).
 * - `productionPathPatterns`: optional allowlist for production paths that
 *   participate in GREEN/REFACTOR checks. When omitted, workflow-guard treats
 *   non-test code files as production writes.
 */
export interface TddPathConfig {
  testPathPatterns?: string[];
  productionPathPatterns?: string[];
}

/**
 * Compound-stage clustering policy.
 *
 * `recurrenceThreshold` is the base minimum repeat count for a trigger/action
 * cluster before it is eligible for promotion into durable rules/skills.
 */
export interface CompoundConfig {
  recurrenceThreshold?: number;
}

export interface VibyConfig {
  version: string;
  flowVersion: string;
  harnesses: HarnessId[];
  /**
   * Single-knob strictness for both guard families. When set, cclaw derives
   * `promptGuardMode` and `tddEnforcement` from this value unless the legacy
   * fields are explicitly provided. Default: "advisory".
   *
   * Added in v0.43.0 to collapse two fields that always moved together for
   * ~99% of users. Power users who want asymmetric strictness (e.g. strict
   * prompt guard, advisory TDD) can still set the legacy fields directly —
   * explicit per-axis values override the derived strictness.
   */
  strictness?: "advisory" | "strict";
  /**
   * Prompt guard behavior for runtime write-risk detection hooks.
   *
   * Since v0.43.0 this is an advanced override. Prefer `strictness` in new
   * configs; set this explicitly only when you need strict prompt guarding
   * while keeping TDD advisory, or vice versa.
   */
  promptGuardMode?: "advisory" | "strict";
  /**
   * TDD RED -> GREEN -> REFACTOR enforcement mode used by workflow guard hooks.
   *
   * Since v0.43.0 this is an advanced override — see `strictness`.
   */
  tddEnforcement?: "advisory" | "strict";
  /**
   * Legacy alias for test-side path detection in workflow-guard.
   * Prefer `tdd.testPathPatterns` in new configs.
   */
  tddTestGlobs?: string[];
  /** Path-pattern routing for TDD test/production write classification. */
  tdd?: TddPathConfig;
  /** Compound-stage recurrence policy overrides. */
  compound?: CompoundConfig;
  /** When true, cclaw installs managed git pre-commit/pre-push wrappers. */
  gitHookGuards?: boolean;
  /** Default flow track for new runs (quick = shortened path, standard = full pipeline). */
  defaultTrack?: FlowTrack;
  /**
   * Opt-in language rule packs. Each enabled pack materializes a matching rule
   * file under `.cclaw/rules/lang/<id>.md` on the next `cclaw sync`. The
   * meta-skill router loads the pack during review/tdd when the diff touches
   * the language in question. Disabled packs have no on-disk footprint.
   */
  languageRulePacks?: LanguageRulePack[];
  /**
   * Optional prompt-to-track vocabulary overrides for /cc classification.
   * Advisory (surfaced in the /cc skill prose), not machine-enforced.
   * If omitted, cclaw uses built-in defaults.
   */
  trackHeuristics?: TrackHeuristicsConfig;
  /**
   * Opt-in per-slice review heuristic. When enabled, the TDD skill
   * requires a `## Per-Slice Review` section in `06-tdd.md` for slices
   * that exceed `filesChangedThreshold` or match `touchTriggers`.
   * Keeps obra's "fresh subagent + spec-then-quality review per task"
   * discipline tractable without forcing it on tiny quick-track fixes.
   */
  sliceReview?: SliceReviewConfig;
}

export interface TransitionRule {
  from: FlowStage;
  to: FlowStage;
  guards: string[];
}

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
