import type { FlowStage } from "../../types.js";

export interface StageGate {
  id: string;
  description: string;
  tier?: "required" | "recommended";
}

export interface ReviewSection {
  title: string;
  evaluationPoints: string[];
  stopGate: boolean;
}

export interface CrossStageTrace {
  readsFrom: string[];
  writesTo: string[];
  traceabilityRule: string;
}

export interface ArtifactValidation {
  section: string;
  required: boolean;
  tier?: "required" | "recommended";
  validationRule: string;
}

export type StageSubagentName =
  | "researcher"
  | "architect"
  | "spec-validator"
  | "spec-document-reviewer"
  | "coherence-reviewer"
  | "scope-guardian-reviewer"
  | "feasibility-reviewer"
  | "slice-implementer"
  | "release-reviewer"
  | "planner"
  | "product-discovery"
  | "divergent-thinker"
  | "critic"
  | "reviewer"
  | "security-reviewer"
  | "integration-overseer"
  | "test-author"
  | "doc-updater"
  | "fixer";

export type StageSubagentDispatchClass =
  | "stage-specialist"
  | "worker"
  | "review-lens";

export type StageSubagentReturnSchema =
  | "planning-return"
  | "product-return"
  | "critic-return"
  | "review-return"
  | "security-return"
  | "tdd-return"
  | "docs-return"
  | "worker-return"
  | "fixer-return"
  | "research-return"
  | "architecture-return"
  | "spec-validation-return"
  | "release-return";

export interface StageAutoSubagentDispatch {
  agent: StageSubagentName;
  /**
   * - `mandatory` — must be dispatched (or explicitly waived) before stage transition.
   * - `proactive` — should be dispatched automatically when context matches `when`.
   */
  mode: "mandatory" | "proactive";
  /**
   * Minimum complexity tier where this dispatch policy applies.
   * Defaults to `standard` for mandatory/proactive dispatches when omitted.
   */
  requiredAtTier?: StageComplexityTier;
  when: string;
  purpose: string;
  requiresUserGate: boolean;
  /**
   * When this delegation may run relative to the adaptive elicitation Q&A loop.
   * - `pre-elicitation` — run before any user dialogue (rare; only for trivial info-gathering).
   * - `post-elicitation` — run only after the Q&A loop converges (default for brainstorm/scope/design
   *   so subagents do not preempt the user dialogue).
   * - `any` — no ordering constraint (default for stages that do not run elicitation:
   *   spec/plan/tdd/review/ship).
   */
  runPhase?: "pre-elicitation" | "post-elicitation" | "any";
  /** Role category used by generated routing tables and lifecycle checks. */
  dispatchClass?: StageSubagentDispatchClass;
  /** Strict status/evidence contract the dispatched agent must return. */
  returnSchema?: StageSubagentReturnSchema;
  /** Optional skill folder the dispatched agent should load as additional context. */
  skill?: string;
  /**
   * When true on a proactive dispatch row for brainstorm/scope/design, the trace
   * gate keeps this rule even when `discoveryMode` is `lean` or `guided`.
   */
  essentialAcrossModes?: boolean;
}

export type StageComplexityTier = "lightweight" | "standard" | "deep";

export interface StagePhilosophy {
  hardGate: string;
  ironLaw: string;
  purpose: string;
  whenToUse: string[];
  whenNotToUse: string[];
  commonRationalizations: string[];
}

export interface StageExecutionModel {
  interactionProtocol: string[];
  process: string[];
  /**
   * Optional custom mermaid `flowchart` body (without the fenced `mermaid`
   * code block) that overrides the auto-generated linear flowchart in the
   * rendered `## Process` section. Use for stages whose state machine is
   * non-linear (loops, conditional branches) — otherwise leave unset and
   * let the renderer derive a simple `A --> B --> C` chart from `process`.
   */
  processFlow?: string;
  checklist: string[];
  requiredGates: StageGate[];
  requiredEvidence: string[];
  inputs: string[];
  requiredContext: string[];
  researchPlaybooks?: string[];
  blockers: string[];
  exitCriteria: string[];
  /**
   * Optional platform-specific notes (Windows/macOS/Linux path separators,
   * PowerShell vs cmd, harness-specific tool names). Rendered under
   * "## Platform Notes" when present. Omit when the stage is
   * platform-agnostic.
   */
  platformNotes?: string[];
}

export interface StageArtifactRules {
  artifactFile: string;
  completionStatus: string[];
  crossStageTrace: CrossStageTrace;
  artifactValidation: ArtifactValidation[];
  trivialOverrideSections?: string[];
}

export interface StageReviewLens {
  outputs: string[];
  reviewSections: ReviewSection[];
  mandatoryDelegations: string[];
  reviewLoop?: StageReviewLoop;
}

export interface StageReviewLensInput {
  outputs: string[];
  reviewSections: ReviewSection[];
  reviewLoop?: StageReviewLoop;
}

export interface StageReviewLoop {
  stage: "scope" | "design";
  checklist: string[];
  maxIterations: number;
  targetScore: number;
}

export interface StageSchema {
  schemaShape: "v2";
  stage: FlowStage;
  skillFolder: string;
  skillName: string;
  skillDescription: string;
  complexityTier: StageComplexityTier;
  philosophy: StagePhilosophy;
  executionModel: StageExecutionModel;
  artifactRules: StageArtifactRules;
  reviewLens: StageReviewLens;
  hardGate: string;
  /**
   * One-line "Iron Law" punchcard — the single rule that, if broken,
   * invalidates the stage outright. Rendered in ALL-CAPS wrapped in
   * <EXTREMELY-IMPORTANT> XML markers at the very top of the skill body.
   * Reference: Superpowers (obra) "NO PRODUCTION CODE WITHOUT A FAILING
   * TEST FIRST".
   */
  ironLaw: string;
  purpose: string;
  whenToUse: string[];
  whenNotToUse: string[];
  interactionProtocol: string[];
  process: string[];
  /** See {@link StageExecutionModel.processFlow}. */
  processFlow?: string;
  /** See {@link StageExecutionModel.platformNotes}. */
  platformNotes?: string[];
  requiredGates: StageGate[];
  requiredEvidence: string[];
  inputs: string[];
  requiredContext: string[];
  /** In-thread research procedures for this stage (`.cclaw/skills/research/*.md`). */
  researchPlaybooks?: string[];
  outputs: string[];
  blockers: string[];
  exitCriteria: string[];
  /**
   * Consolidated "Common Rationalizations" list — things an agent is likely to
   * talk itself into that should stop the stage. Rendered under the
   * "Anti-Patterns & Red Flags" heading in the generated SKILL.md. Replaces
   * the former split between `antiPatterns` and `redFlags`, which produced
   * near-duplicate entries and forced downstream code to merge them anyway.
   */
  commonRationalizations: string[];
  artifactFile: string;
  next: FlowStage | "done";
  checklist: string[];
  reviewSections: ReviewSection[];
  completionStatus: string[];
  crossStageTrace: CrossStageTrace;
  artifactValidation: ArtifactValidation[];
  /** When true, stage skill includes batch auto-execute guidance (tdd). */
  batchExecutionAllowed?: boolean;
  /** Sections that remain required even when the trivial-change escape hatch is active (design only). */
  trivialOverrideSections?: string[];
  /** Agent names that MUST be dispatched (or waived) before stage transition — derived from mandatory auto-subagent rows. */
  mandatoryDelegations: string[];
  /** Optional shared outside-voice loop config for scope/design stages. */
  reviewLoop?: StageReviewLoop;
}

export type StageSchemaLegacyInput = Omit<
  StageSchema,
  "schemaShape" |
  "philosophy" |
  "executionModel" |
  "artifactRules" |
  "reviewLens" |
  "mandatoryDelegations" |
  "complexityTier"
> & {
  schemaShape?: "legacy";
  complexityTier?: StageComplexityTier;
};

export interface StageSchemaV2Input {
  schemaShape: "v2";
  stage: FlowStage;
  skillFolder: string;
  skillName: string;
  skillDescription: string;
  complexityTier?: StageComplexityTier;
  philosophy: StagePhilosophy;
  executionModel: StageExecutionModel;
  artifactRules: StageArtifactRules;
  reviewLens: StageReviewLensInput;
  next: FlowStage | "done";
  /** When true, stage skill includes batch auto-execute guidance (tdd). */
  batchExecutionAllowed?: boolean;
}

export type StageSchemaInput = StageSchemaLegacyInput | StageSchemaV2Input;
