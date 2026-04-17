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
 * Init profiles pre-fill `cclaw init` flags for common install shapes.
 *
 * - `minimal` — single-harness (claude), medium track default, no git hook guards. For solo
 *   contributors who still want brainstorm/spec/plan rigor without full scope+design overhead.
 * - `standard` — default harness set, standard track, no git hook guards, advisory guards.
 *   Matches the pre-profile default behavior.
 * - `full` — default harness set, standard track, git hook guards on, strict prompt guards.
 *   For teams that want every safety rail on.
 */
export const INIT_PROFILES = ["minimal", "standard", "full"] as const;
export type InitProfile = (typeof INIT_PROFILES)[number];

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

export interface TrackHeuristicRule {
  triggers?: string[];
  patterns?: string[];
  veto?: string[];
}

export interface TrackHeuristicsConfig {
  /** Track used when no trigger/pattern matches. */
  fallback?: FlowTrack;
  /**
   * Track evaluation order. First matching track wins.
   * Example: ["standard", "medium", "quick"].
   */
  priority?: FlowTrack[];
  /** Per-track matching rules. */
  tracks?: Partial<Record<FlowTrack, TrackHeuristicRule>>;
}

export interface VibyConfig {
  version: string;
  flowVersion: string;
  harnesses: HarnessId[];
  /** When true, stage skills instruct the agent to continue to the following stage after gates pass. */
  autoAdvance?: boolean;
  /** Prompt guard behavior for runtime write-risk detection hooks. */
  promptGuardMode?: "advisory" | "strict";
  /** TDD red->green->refactor enforcement mode used by workflow guard hooks. */
  tddEnforcement?: "advisory" | "strict";
  /** Optional test file globs used by guard guidance and /cc-tdd-log docs. */
  tddTestGlobs?: string[];
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
   * Optional prompt-to-track mapping overrides for /cc classification.
   * If omitted, cclaw uses built-in defaults.
   */
  trackHeuristics?: TrackHeuristicsConfig;
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
