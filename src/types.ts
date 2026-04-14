export const FLOW_STAGES = [
  "brainstorm",
  "scope",
  "design",
  "spec",
  "plan",
  "test",
  "build",
  "review",
  "ship"
] as const;

export type FlowStage = (typeof FLOW_STAGES)[number];

export const HARNESS_IDS = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export interface VibyConfig {
  version: string;
  flowVersion: string;
  harnesses: HarnessId[];
  /** When true, stage skills instruct the agent to continue to the following stage after gates pass. */
  autoAdvance?: boolean;
  /** Merge project bootstrap learnings with a global learnings file. */
  globalLearnings?: boolean;
  /** Optional absolute or project-relative path to global learnings JSONL. */
  globalLearningsPath?: string;
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
