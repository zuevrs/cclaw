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

export const FLOW_TRACKS = ["quick", "standard"] as const;
export type FlowTrack = (typeof FLOW_TRACKS)[number];

/**
 * Ordered stages that make up each flow track.
 *
 * - `standard` runs the full 8-stage pipeline (default — same as before tracks existed).
 * - `quick` skips the upstream product stages (brainstorm/scope/design/plan) for
 *   small bug fixes or single-purpose changes where the spec is already known.
 *   It still keeps the non-negotiable safety gates: spec → tdd → review → ship.
 */
export const TRACK_STAGES: Record<FlowTrack, readonly FlowStage[]> = {
  standard: FLOW_STAGES,
  quick: ["spec", "tdd", "review", "ship"]
} as const;

export const HARNESS_IDS = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * Init profiles pre-fill `cclaw init` flags for common install shapes.
 *
 * - `minimal` — single-harness (claude), quick track default, no git hook guards. For solo
 *   contributors or bugfix-heavy repos where most work is \`quick\` scope.
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

export interface VibyConfig {
  version: string;
  flowVersion: string;
  harnesses: HarnessId[];
  /** When true, stage skills instruct the agent to continue to the following stage after gates pass. */
  autoAdvance?: boolean;
  /** Prompt guard behavior for runtime write-risk detection hooks. */
  promptGuardMode?: "advisory" | "strict";
  /** When true, cclaw installs managed git pre-commit/pre-push wrappers. */
  gitHookGuards?: boolean;
  /** Default flow track for new runs (quick = shortened path, standard = full pipeline). */
  defaultTrack?: FlowTrack;
  /**
   * Opt-in language rule packs. Each enabled pack materializes a matching utility
   * skill under `.cclaw/skills/language-<id>/SKILL.md` on next `cclaw sync`. The
   * meta-skill router loads the pack during review/tdd when the diff touches the
   * language in question.
   */
  languageRulePacks?: LanguageRulePack[];
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
