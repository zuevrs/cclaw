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

export interface StageAutoSubagentDispatch {
  agent:
    | "planner"
    | "reviewer"
    | "security-reviewer"
    | "test-author"
    | "doc-updater";
  /**
   * - `mandatory` — must be dispatched (or explicitly waived) before stage transition.
   * - `proactive` — should be dispatched automatically when context matches `when`.
   */
  mode: "mandatory" | "proactive";
  when: string;
  purpose: string;
  requiresUserGate: boolean;
  /** Optional skill folder the dispatched agent should load as additional context. */
  skill?: string;
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
  checklist: string[];
  requiredGates: StageGate[];
  requiredEvidence: string[];
  inputs: string[];
  requiredContext: string[];
  researchPlaybooks?: string[];
  blockers: string[];
  exitCriteria: string[];
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
  policyNeedles: string[];
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
  policyNeedles: string[];
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
}

export type StageSchemaInput = Omit<
  StageSchema,
  "schemaShape" |
  "philosophy" |
  "executionModel" |
  "artifactRules" |
  "reviewLens" |
  "mandatoryDelegations" |
  "complexityTier"
> & {
  complexityTier?: StageComplexityTier;
};
