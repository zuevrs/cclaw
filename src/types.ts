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
