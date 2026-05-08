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

export const ROUTING_CLASSES = ["trivial", "small-medium", "large-risky"] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

/**
 * AC traceability and TDD enforcement modes (v8.2+).
 *
 * - `inline`: trivial change. No AC table, no commit hook, optional tests.
 * - `soft`: small/medium feature work. Bullet-list testable conditions in
 *   `plan.md` (no AC IDs); commit-helper does not block; one TDD cycle per
 *   feature is enough. Default for small/medium routing.
 * - `strict`: large/risky / security-flagged. AC IDs with commit trace,
 *   ship gate, RED → GREEN → REFACTOR per AC. Same as v8.1 behaviour.
 *
 * Selected at the triage gate; user can override.
 */
export const AC_MODES = ["inline", "soft", "strict"] as const;
export type AcMode = (typeof AC_MODES)[number];

/**
 * Decision recorded at the triage gate that opens every new flow.
 * Persisted in flow-state.json so resumes never re-trigger triage.
 */
export interface TriageDecision {
  complexity: RoutingClass;
  acMode: AcMode;
  /** Stages the orchestrator promised to run, in order. Empty for trivial. */
  path: FlowStage[];
  /** Why this complexity was chosen. One short sentence. */
  rationale: string;
  /** ISO timestamp when triage was recorded. */
  decidedAt: string;
  /** Did the user override the orchestrator's recommendation? */
  userOverrode: boolean;
}

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
