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

export const AGENTS_MD_MODES = ["minimal", "full"] as const;
export type AgentsMdMode = (typeof AGENTS_MD_MODES)[number];

export interface CclawConfig {
  version: string;
  flowVersion: string;
  harnesses: HarnessId[];
  agentsMdMode: AgentsMdMode;
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
