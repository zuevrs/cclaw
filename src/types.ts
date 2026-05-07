export const FLOW_STAGES = ["plan", "build", "review", "ship"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

export const HARNESS_IDS = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const DISCOVERY_SPECIALISTS = ["brainstormer", "architect", "planner"] as const;
export type DiscoverySpecialistId = (typeof DISCOVERY_SPECIALISTS)[number];

export const SPECIALISTS = [
  ...DISCOVERY_SPECIALISTS,
  "reviewer",
  "security-reviewer",
  "slice-builder"
] as const;
export type SpecialistId = (typeof SPECIALISTS)[number];

export type ReviewerMode = "code" | "text-review" | "integration" | "release" | "adversarial";
export type SecurityReviewerMode = "threat-model" | "sensitive-change";
export type SliceBuilderMode = "build" | "fix-only";

export type ArtifactStatus = "active" | "shipped";
export type AcceptanceCriterionStatus = "pending" | "committed";

export type TddPhase = "red" | "green" | "refactor";

export interface TddPhaseRecord {
  sha?: string;
  skipped?: boolean;
  reason?: string;
}

export interface AcceptanceCriterionState {
  id: string;
  text: string;
  commit?: string;
  status: AcceptanceCriterionStatus;
  phases?: Partial<Record<TddPhase, TddPhaseRecord>>;
}

export type BuildProfile = "default" | "bootstrap";

export type RoutingClass = "trivial" | "small-medium" | "large-risky";

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
