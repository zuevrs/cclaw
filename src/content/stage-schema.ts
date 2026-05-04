import { FLOW_STAGES, FLOW_TRACKS, TRACK_STAGES } from "../types.js";
import type { DiscoveryMode, FlowStage, FlowTrack, TransitionRule } from "../types.js";
import { STAGE_TO_SKILL_FOLDER } from "../constants.js";
import {
  BRAINSTORM,
  SCOPE,
  DESIGN,
  SPEC,
  PLAN,
  TDD,
  REVIEW,
  SHIP
} from "./stages/index.js";
import { stagePolicyNeedlesFromMetadata } from "./stages/_lint-metadata/index.js";
import { tddStageForTrack } from "./stages/tdd.js";
import { trackRenderContext } from "./track-render-context.js";
import type {
  ArtifactValidation,
  StageComplexityTier,
  StageExecutionModel,
  StagePhilosophy,
  StageArtifactRules,
  StageReviewLoop,
  StageReviewLens,
  StageAutoSubagentDispatch,
  StageGate,
  StageSchemaLegacyInput,
  StageSchema,
  StageSchemaInput,
  StageSchemaV2Input
} from "./stages/schema-types.js";

// Re-export the canonical type surface so downstream callers keep their existing
// `import { StageSchema, ... } from "./stage-schema.js"` paths.
export type {
  ArtifactValidation,
  CrossStageTrace,
  ReviewSection,
  StageComplexityTier,
  StageExecutionModel,
  StagePhilosophy,
  StageArtifactRules,
  StageReviewLoop,
  StageReviewLens,
  StageAutoSubagentDispatch,
  StageGate,
  StageSchemaLegacyInput,
  StageSchema,
  StageSchemaInput,
  StageSchemaV2Input
} from "./stages/schema-types.js";

// ---------------------------------------------------------------------------
// NOTE: The former QUESTION_FORMAT_SPEC / ERROR_BUDGET_SPEC exports were
// hoisted into `src/content/meta-skill.ts` (Shared Decision + Tool-Use
// Protocol). They are no longer re-exported from here to avoid duplication
// and drift. Stage skills cite the meta-skill by path instead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Optional artifact appendix (documentation-only — not a tiered gate)
//
// `## Amendments` — after a stage is closed, substantive edits SHOULD append dated
// bullets (ISO timestamp + reason) here instead of silently rewriting history. The
// linter surfaces advisory `stage_artifact_post_closure_mutation` findings when mtimes
// move without this trail (`completedStageMeta` must exist).
// ---------------------------------------------------------------------------

export const SKILL_ENVELOPE_KINDS = [
  "stage-output",
  "gate-result",
  "delegation-record"
] as const;

export type SkillEnvelopeKind = (typeof SKILL_ENVELOPE_KINDS)[number];
export const NON_FLOW_ENVELOPE_STAGE = "non-flow" as const;
export type SkillEnvelopeStage = FlowStage | typeof NON_FLOW_ENVELOPE_STAGE;

export interface SkillEnvelope {
  version: "1";
  kind: SkillEnvelopeKind;
  stage: SkillEnvelopeStage;
  payload: unknown;
  emittedAt: string;
  agent?: string;
}

export interface SkillEnvelopeValidation {
  ok: boolean;
  errors: string[];
}

const FLOW_STAGE_SET = new Set<FlowStage>(FLOW_STAGES);
const SKILL_ENVELOPE_KIND_SET = new Set<string>(SKILL_ENVELOPE_KINDS);
const COMPLEXITY_TIER_ORDER: Record<StageComplexityTier, number> = {
  lightweight: 0,
  standard: 1,
  deep: 2
};

export interface StageStackAwareReviewRoute {
  stack: string;
  agent: "reviewer";
  signals: string[];
  focus: string;
}

export interface StageDelegationDispatchRule {
  agent: string;
  mode: "mandatory" | "proactive";
  when: string;
  purpose: string;
  requiresUserGate: boolean;
  requiredAtTier?: StageComplexityTier;
  dispatchClass: NonNullable<StageAutoSubagentDispatch["dispatchClass"]>;
  returnSchema: NonNullable<StageAutoSubagentDispatch["returnSchema"]>;
  skill?: string;
}

export interface StageDelegationSummary {
  stage: FlowStage;
  mandatoryAgents: string[];
  proactiveAgents: string[];
  primaryAgents: string[];
  dispatchRules: StageDelegationDispatchRule[];
  stackAwareRoutes: StageStackAwareReviewRoute[];
}

const REVIEW_STACK_AWARE_ROUTES: StageStackAwareReviewRoute[] = [
  {
    stack: "TypeScript/JavaScript",
    agent: "reviewer",
    signals: ["package.json", "tsconfig.json"],
    focus: "type safety, package scripts, build/test config, dependency boundaries"
  },
  {
    stack: "Python",
    agent: "reviewer",
    signals: ["pyproject.toml", "requirements.txt"],
    focus: "packaging, virtualenv assumptions, typing, pytest or unittest evidence"
  },
  {
    stack: "Ruby/Rails",
    agent: "reviewer",
    signals: ["Gemfile", "config/"],
    focus: "Rails conventions, migrations, routes/controllers, RSpec or Minitest evidence"
  },
  {
    stack: "Go",
    agent: "reviewer",
    signals: ["go.mod"],
    focus: "interfaces, concurrency, error handling, go test coverage"
  },
  {
    stack: "Rust",
    agent: "reviewer",
    signals: ["Cargo.toml"],
    focus: "ownership, error/result handling, feature flags, cargo test coverage"
  }
];

function stackAwareRoutesForStage(stage: FlowStage): StageStackAwareReviewRoute[] {
  return stage === "review" ? reviewStackAwareRoutes() : [];
}

export function reviewStackAwareRoutes(): StageStackAwareReviewRoute[] {
  return REVIEW_STACK_AWARE_ROUTES.map((route) => ({
    ...route,
    signals: [...route.signals]
  }));
}

export function reviewStackAwareRoutingSummary(): string {
  const routeList = REVIEW_STACK_AWARE_ROUTES
    .map((route) => `${route.stack} via ${route.signals.join("/")}`)
    .join("; ");
  return `Stack-aware review routing: keep the default reviewer and security-reviewer passes, then proactively route matching reviewer lenses when repo signals or review context match (${routeList}). Do not run every stack lens unconditionally.`;
}

function dedupeAgentsInOrder(agents: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    if (seen.has(agent)) continue;
    seen.add(agent);
    out.push(agent);
  }
  return out;
}

function discoveryModeTier(mode: DiscoveryMode | undefined): StageComplexityTier {
  if (mode === "lean") return "lightweight";
  if (mode === "deep") return "deep";
  return "standard";
}

function resolvedStageComplexityTier(params: {
  stage: FlowStage;
  defaultTier?: StageComplexityTier;
  discoveryMode?: DiscoveryMode;
}): StageComplexityTier {
  const base = params.defaultTier ?? "standard";
  const earlyStage = params.stage === "brainstorm" || params.stage === "scope" || params.stage === "design";
  if (!earlyStage || params.discoveryMode === undefined) return base;
  return discoveryModeTier(params.discoveryMode);
}

function defaultReturnSchemaForAgent(
  agent: StageAutoSubagentDispatch["agent"]
): NonNullable<StageAutoSubagentDispatch["returnSchema"]> {
  switch (agent) {
    case "researcher":
      return "research-return";
    case "architect":
      return "architecture-return";
    case "spec-validator":
      return "spec-validation-return";
    case "spec-document-reviewer":
    case "coherence-reviewer":
    case "scope-guardian-reviewer":
    case "feasibility-reviewer":
      return "review-return";
    case "slice-implementer":
    case "slice-documenter":
      return "worker-return";
    case "release-reviewer":
      return "release-return";
    case "planner":
      return "planning-return";
    case "product-discovery":
      return "product-return";
    case "divergent-thinker":
    case "critic":
      return "critic-return";
    case "reviewer":
    case "integration-overseer":
      return "review-return";
    case "security-reviewer":
      return "security-return";
    case "test-author":
      return "tdd-return";
    case "doc-updater":
      return "docs-return";
    case "fixer":
      return "fixer-return";
  }
}

function dispatchClassForRow(
  row: StageAutoSubagentDispatch
): NonNullable<StageAutoSubagentDispatch["dispatchClass"]> {
  if (row.dispatchClass) return row.dispatchClass;
  if (row.agent === "fixer" || row.agent === "slice-implementer" || row.agent === "slice-documenter") return "worker";
  return row.skill?.includes("review") || row.agent === "reviewer" || row.agent === "security-reviewer" || row.agent.endsWith("-reviewer")
    ? "review-lens"
    : "stage-specialist";
}

function delegationDispatchRule(row: StageAutoSubagentDispatch): StageDelegationDispatchRule {
  return {
    agent: row.agent,
    mode: row.mode,
    when: row.when,
    purpose: row.purpose,
    requiresUserGate: row.requiresUserGate,
    requiredAtTier: row.requiredAtTier,
    dispatchClass: dispatchClassForRow(row),
    returnSchema: row.returnSchema ?? defaultReturnSchemaForAgent(row.agent),
    skill: row.skill
  };
}

/**
 * Canonical delegation summary derived from STAGE_AUTO_SUBAGENT_DISPATCH.
 *
 * Keep all generated routing surfaces (skills, AGENTS.md) on this helper so
 * stage->agent defaults are maintained in one place.
 */
export function stageDelegationSummary(
  complexityTier: StageComplexityTier = "standard"
): StageDelegationSummary[] {
  const currentTierRank = COMPLEXITY_TIER_ORDER[complexityTier];
  return FLOW_STAGES.map((stage) => {
    const eligibleRows = STAGE_AUTO_SUBAGENT_DISPATCH[stage].filter((row) => {
      const requiredAt = row.requiredAtTier ?? "standard";
      return currentTierRank >= COMPLEXITY_TIER_ORDER[requiredAt];
    });
    const mandatoryAgents = dedupeAgentsInOrder(
      eligibleRows
        .filter((row) => row.mode === "mandatory")
        .map((row) => row.agent)
    );
    const proactiveAgents = dedupeAgentsInOrder(
      eligibleRows
        .filter((row) => row.mode === "proactive")
        .map((row) => row.agent)
    );
    const primaryAgents = dedupeAgentsInOrder([...mandatoryAgents, ...proactiveAgents]);
    return {
      stage,
      mandatoryAgents,
      proactiveAgents,
      primaryAgents,
      dispatchRules: eligibleRows.map(delegationDispatchRule),
      stackAwareRoutes: stackAwareRoutesForStage(stage)
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function validateSkillEnvelope(value: unknown): SkillEnvelopeValidation {
  const errors: string[] = [];
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["envelope must be a JSON object"] };
  }
  if (record.version !== "1") {
    errors.push('envelope.version must equal "1".');
  }
  if (typeof record.kind !== "string" || !SKILL_ENVELOPE_KIND_SET.has(record.kind)) {
    errors.push(`envelope.kind must be one of: ${SKILL_ENVELOPE_KINDS.join(", ")}.`);
  }
  if (
    typeof record.stage !== "string" ||
    (record.stage !== NON_FLOW_ENVELOPE_STAGE && !FLOW_STAGE_SET.has(record.stage as FlowStage))
  ) {
    errors.push(
      `envelope.stage must be one of: ${FLOW_STAGES.join(", ")} or ${NON_FLOW_ENVELOPE_STAGE}.`
    );
  }
  if (!Object.prototype.hasOwnProperty.call(record, "payload")) {
    errors.push("envelope.payload is required.");
  }
  if (typeof record.emittedAt !== "string" || Number.isNaN(Date.parse(record.emittedAt))) {
    errors.push("envelope.emittedAt must be an ISO-8601 timestamp string.");
  }
  if (record.agent !== undefined && typeof record.agent !== "string") {
    errors.push("envelope.agent must be a string when present.");
  }
  return { ok: errors.length === 0, errors };
}

export function parseSkillEnvelope(raw: string): SkillEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const validation = validateSkillEnvelope(parsed);
  if (!validation.ok) {
    return null;
  }
  return parsed as SkillEnvelope;
}

/**
 * Gate tiers:
 * - required: blocking for stage completion.
 * - recommended: quality signal; unmet -> DONE_WITH_CONCERNS, not BLOCKED.
 */
type RequiredGateSet = string[] | ((track: FlowTrack) => string[]);

const ARTIFACT_STAGE_BY_PREFIX: Record<string, FlowStage> = {
  "01": "brainstorm",
  "02": "scope",
  "03": "design",
  "04": "spec",
  "05": "plan",
  "06": "tdd",
  "07": "review",
  "08": "ship"
};

const ARTIFACT_STAGE_BY_SPECIAL_FILE: Partial<Record<string, FlowStage>> = {
  "02a-research.md": "design"
};

function stageFromArtifactPath(artifactPath: string): FlowStage | null {
  const normalized = artifactPath.replace(/\\/gu, "/");
  const fileName = normalized.split("/").pop() ?? normalized;
  const special = ARTIFACT_STAGE_BY_SPECIAL_FILE[fileName];
  if (special) {
    return special;
  }
  const match = /^(\d{2})(?:[a-z])?-/u.exec(fileName);
  if (!match) {
    return null;
  }
  return ARTIFACT_STAGE_BY_PREFIX[match[1]!] ?? null;
}

const REQUIRED_GATE_IDS: Record<FlowStage, RequiredGateSet> = {
  brainstorm: [
    "brainstorm_approaches_compared",
    "brainstorm_direction_approved",
    "brainstorm_artifact_reviewed"
  ],
  scope: [
    "scope_mode_selected",
    "scope_contract_written",
    "scope_user_approved"
  ],
  design: [
    "design_research_complete",
    "design_architecture_locked",
    "design_diagram_freshness",
    "design_data_flow_mapped",
    "design_failure_modes_mapped",
    "design_test_and_perf_defined"
  ],
  spec: [
    "spec_acceptance_measurable",
    "spec_testability_confirmed",
    "spec_assumptions_surfaced",
    "spec_self_review_complete",
    "spec_user_approved"
  ],
  plan: [
    "plan_tasks_sliced_2_5_min",
    "plan_dependency_batches_defined",
    "plan_acceptance_mapped",
    "plan_execution_posture_recorded",
    "plan_wait_for_confirm"
  ],
  tdd: (track) => [
    "tdd_test_discovery_complete",
    "tdd_impact_check_complete",
    "tdd_red_test_written",
    "tdd_green_full_suite",
    "tdd_refactor_completed",
    "tdd_verified_before_complete",
    "tdd_iron_law_acknowledged",
    "tdd_watched_red_observed",
    "tdd_slice_cycle_complete",
    "tdd_docs_drift_check",
    ...(track === "quick" ? [] : ["tdd_traceable_to_plan"])
  ],
  review: (track) => [
    "review_layer1_spec_compliance",
    "review_layer2_security",
    "review_layer_coverage_complete",
    "review_criticals_resolved",
    "review_army_json_valid"
  ],
  ship: [
    "ship_review_verdict_valid",
    "ship_preflight_passed",
    "ship_rollback_plan_ready",
    "ship_finalization_executed"
  ]
};

const REQUIRED_ARTIFACT_SECTIONS: Record<FlowStage, string[]> = {
  brainstorm: [
    "Context",
    "Problem Decision Record",
    "Approach Tier",
    "Approaches",
    "Approach Reaction",
    "Selected Direction"
  ],
  scope: ["Scope Contract", "Scope Mode", "In Scope / Out of Scope", "Completion Dashboard", "Scope Summary"],
  design: [
    "Research Fleet Synthesis",
    "Engineering Lock",
    "Architecture Boundaries",
    "Architecture Diagram",
    "Failure Mode Table",
    "Security & Threat Model",
    "Observability & Debuggability",
    "Deployment & Rollout",
    "Spec Handoff",
    "Completion Dashboard"
  ],
  spec: [
    "Acceptance Criteria",
    "Edge Cases",
    "Assumptions Before Finalization",
    "Acceptance Mapping",
    "Spec Self-Review",
    "Approval"
  ],
  plan: ["Task List", "Dependency Batches", "Acceptance Mapping", "Execution Posture", "WAIT_FOR_CONFIRM"],
  tdd: [
    "System-Wide Impact Check",
    "RED Evidence",
    "GREEN Evidence",
    "REFACTOR Notes",
    "Traceability",
    "Iron Law Acknowledgement",
    "Verification Ladder"
  ],
  review: ["Review Evidence Scope", "Changed-File Coverage", "Layer 1 Verdict", "Review Findings Contract", "Severity Summary", "Final Verdict"],
  ship: ["Preflight Results", "Release Notes", "Rollback Plan", "Finalization"]
};

function resolveRequiredGateIds(stage: FlowStage, track: FlowTrack): string[] {
  const raw = REQUIRED_GATE_IDS[stage];
  return typeof raw === "function" ? raw(track) : raw;
}

function tieredStageGates(stage: FlowStage, gates: StageGate[], track: FlowTrack): StageGate[] {
  const requiredSet = new Set(resolveRequiredGateIds(stage, track));
  return gates.map((gate) => {
    return {
      ...gate,
      tier: requiredSet.has(gate.id) ? "required" : "recommended"
    };
  });
}

function tieredArtifactValidation(stage: FlowStage, rows: ArtifactValidation[]): ArtifactValidation[] {
  const requiredSections = new Set(REQUIRED_ARTIFACT_SECTIONS[stage]);
  return rows.map((row) => {
    const required = requiredSections.has(row.section);
    return {
      ...row,
      tier: required ? "required" : "recommended",
      required
    };
  });
}

function readsFromForTrack(readsFrom: string[], track: FlowTrack): string[] {
  const stageSet = new Set(TRACK_STAGES[track]);
  return readsFrom.filter((artifactPath) => {
    const stage = stageFromArtifactPath(artifactPath);
    if (!stage) {
      return true;
    }
    return stageSet.has(stage);
  });
}

function isStageSchemaV2Input(value: StageSchemaInput): value is StageSchemaV2Input {
  return value.schemaShape === "v2";
}

function normalizeStageSchemaInput(value: StageSchemaInput): StageSchemaLegacyInput {
  if (!isStageSchemaV2Input(value)) {
    return value;
  }
  return {
    stage: value.stage,
    skillFolder: value.skillFolder,
    skillName: value.skillName,
    skillDescription: value.skillDescription,
    complexityTier: value.complexityTier,
    hardGate: value.philosophy.hardGate,
    ironLaw: value.philosophy.ironLaw,
    purpose: value.philosophy.purpose,
    whenToUse: value.philosophy.whenToUse,
    whenNotToUse: value.philosophy.whenNotToUse,
    interactionProtocol: value.executionModel.interactionProtocol,
    process: value.executionModel.process,
    processFlow: value.executionModel.processFlow,
    platformNotes: value.executionModel.platformNotes,
    requiredGates: value.executionModel.requiredGates,
    requiredEvidence: value.executionModel.requiredEvidence,
    inputs: value.executionModel.inputs,
    requiredContext: value.executionModel.requiredContext,
    researchPlaybooks: value.executionModel.researchPlaybooks,
    outputs: value.reviewLens.outputs,
    blockers: value.executionModel.blockers,
    exitCriteria: value.executionModel.exitCriteria,
    commonRationalizations: value.philosophy.commonRationalizations,
    artifactFile: value.artifactRules.artifactFile,
    next: value.next,
    checklist: value.executionModel.checklist,
    reviewSections: value.reviewLens.reviewSections,
    reviewLoop: value.reviewLens.reviewLoop,
    completionStatus: value.artifactRules.completionStatus,
    crossStageTrace: value.artifactRules.crossStageTrace,
    artifactValidation: value.artifactRules.artifactValidation,
    batchExecutionAllowed: value.batchExecutionAllowed,
    trivialOverrideSections: value.artifactRules.trivialOverrideSections
  };
}

// ---------------------------------------------------------------------------
// Stage map and accessors
// ---------------------------------------------------------------------------

const STAGE_SCHEMA_MAP: Record<FlowStage, StageSchemaInput> = {
  brainstorm: BRAINSTORM,
  scope: SCOPE,
  design: DESIGN,
  spec: SPEC,
  plan: PLAN,
  tdd: TDD,
  review: REVIEW,
  ship: SHIP
};

/**
 * Stage-level subagent dispatch matrix.
 *
 * NOTE on `fixer`: the `fixer` agent is intentionally NOT listed in any stage
 * row. It is dispatched on-demand by the SDD `subagent-dev` skill (and by
 * reviewer flows) when a review surfaces a concrete failing criterion that
 * needs a fresh worker. Adding `fixer` to the static matrix would create
 * proactive-waiver theatre because it can only run after a specific review
 * finding exists. See `core-agents.ts` `fixer` definition for the contract.
 */
const STAGE_AUTO_SUBAGENT_DISPATCH: Record<FlowStage, StageAutoSubagentDispatch[]> = {
  brainstorm: [
    {
      agent: "product-discovery",
      mode: "mandatory",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "Always for standard/deep brainstorm to validate value, persona/JTBD, success metric, and why-now framing. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Run product-discovery mode to pressure-test problem/value fit and produce product evidence for the Problem Decision Record.",
      requiresUserGate: false
    },
    {
      agent: "divergent-thinker",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When brainstorm has >1 candidate direction or user signals openness to alternatives. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Expand option-space with alternative framings and approaches before planner/critic convergence.",
      requiresUserGate: false
    },
    {
      agent: "critic",
      mode: "mandatory",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "Always for standard/deep brainstorm to challenge the premise, do-nothing path, and higher-upside alternatives. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Attack assumptions and surface non-goals before direction approval, with pre-commitment predictions validated against evidence.",
      requiresUserGate: false,
      skill: "critic-multi-perspective"
    },
    {
      agent: "researcher",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When repository, market, docs, or prior-art context changes the approach set. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Provide search-before-read summaries and context-readiness evidence before large reads or decisions.",
      requiresUserGate: false,
      essentialAcrossModes: true
    }
  ],
  scope: [
    {
      agent: "planner",
      mode: "mandatory",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "Always during scope shaping. Runs only after the adaptive elicitation Q&A loop converges and the user has approved the scope contract draft.",
      purpose: "Challenge premise, map alternatives, and produce explicit in/out contract.",
      requiresUserGate: false
    },
    {
      agent: "divergent-thinker",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When scope mode is SCOPE EXPANSION or SELECTIVE EXPANSION, or scope contract has fewer than 3 alternatives considered. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Generate additional framings and approach variants before scope convergence hardens.",
      requiresUserGate: false
    },
    {
      agent: "critic",
      mode: "mandatory",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "Always during scope shaping for standard/deep work. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Test whether the selected scope mode is too timid, too broad, or hiding a smaller useful slice, using pre-commitment predictions and validation.",
      requiresUserGate: false,
      skill: "critic-multi-perspective"
    },
    {
      agent: "researcher",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When churn, prior attempts, reference patterns, or external constraints may change scope boundaries. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Summarize search/context findings before the scope contract locks accepted/rejected/deferred ideas.",
      requiresUserGate: false,
      essentialAcrossModes: true
    },
    {
      agent: "product-discovery",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When scope choices change user value, success metrics, or product positioning (Mode: discovery). Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Keep accepted/deferred reference ideas tied to user value and measurable success under product-discovery mode.",
      requiresUserGate: false
    },
    {
      agent: "product-discovery",
      mode: "proactive",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "When scope mode resolves to SCOPE EXPANSION or SELECTIVE EXPANSION (Mode: strategist). Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Drive 10x vision and concrete expansion proposals before locking the scope contract via product-discovery strategist mode.",
      requiresUserGate: false
    },
    {
      agent: "scope-guardian-reviewer",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When scope mode is SCOPE EXPANSION or SELECTIVE EXPANSION, or scope contract has many accepted ideas. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Challenge complexity growth and enforce minimum-change scope discipline before scope lock.",
      requiresUserGate: false,
      skill: "document-scope-guard"
    }
  ],
  design: [
    {
      agent: "architect",
      mode: "mandatory",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "Always during design lock. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Stress architecture boundaries, dependency graph, critical path, and spec handoff.",
      requiresUserGate: false
    },
    {
      agent: "test-author",
      mode: "mandatory",
      requiredAtTier: "standard",
      runPhase: "post-elicitation",
      when: "Always during design lock. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Check test diagram mapping, RED expressibility, assertion quality, and verification routes before implementation.",
      requiresUserGate: false
    },
    {
      agent: "critic",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When architecture alternatives, coupling, cost, or rollback risk remain debatable, or when security/auth/authz trust boundaries are involved. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Produce a shadow alternative, switch trigger, and cheaper-path challenge for the engineering lock with pre-commitment predictions and validation.",
      requiresUserGate: false,
      skill: "critic-multi-perspective"
    },
    {
      agent: "researcher",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When framework/library docs, repo graph context, or reference contracts may change the design. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Run search-before-read context synthesis before architecture locks.",
      requiresUserGate: false,
      essentialAcrossModes: true
    },
    {
      agent: "security-reviewer",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When trust boundaries, auth, secrets, sensitive data, or external inputs are involved. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Catch design-level security risks before implementation.",
      requiresUserGate: false
    },
    {
      agent: "coherence-reviewer",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When design touches multiple subsystems or includes multiple alternatives sections. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Detect internal contradictions, terminology drift, and broken cross-section references in design docs.",
      requiresUserGate: false,
      skill: "document-coherence-pass"
    },
    {
      agent: "feasibility-reviewer",
      mode: "proactive",
      runPhase: "post-elicitation",
      when: "When design assumes runtime conditions, scaling behavior, or external service availability. Runs only after the adaptive elicitation Q&A loop converges.",
      purpose: "Validate that design assumptions remain feasible in real runtime and rollout constraints.",
      requiresUserGate: false,
      skill: "document-feasibility-pass"
    }
  ],
  spec: [
    {
      agent: "spec-validator",
      mode: "mandatory",
      requiredAtTier: "standard",
      when: "Always for standard/deep specs before plan handoff.",
      purpose: "Validate measurability, edge cases, assumptions, and AC-to-testability mapping.",
      requiresUserGate: false
    },
    {
      agent: "test-author",
      mode: "proactive",
      when: "When acceptance criteria need testability review or RED expressibility is uncertain.",
      purpose: "Confirm likely test levels, commands/manual evidence, and assertion surfaces are concrete.",
      requiresUserGate: false
    },
    {
      agent: "spec-document-reviewer",
      mode: "proactive",
      requiredAtTier: "standard",
      when: "When Spec Self-Review reports gaps (Status: Issues Found) or subsystem boundaries drift beyond one coherent plan slice.",
      purpose: "Run a final document-level quality pass for completeness, consistency, clarity, and scope fit before handoff to plan.",
      requiresUserGate: false
    },
    {
      agent: "coherence-reviewer",
      mode: "proactive",
      when: "When spec has more than five acceptance criteria or multiple assumptions sections.",
      purpose: "Check cross-section coherence, terminology consistency, and internal references before plan handoff.",
      requiresUserGate: false,
      skill: "document-coherence-pass"
    }
  ],
  plan: [
    {
      agent: "planner",
      mode: "mandatory",
      requiredAtTier: "standard",
      when: "Always when producing execution slices.",
      purpose: "Create dependency-aware executable packets with expected failing test, passing command, stop condition, and verification evidence.",
      requiresUserGate: false
    },
    {
      agent: "researcher",
      mode: "proactive",
      when: "When plan tasks touch unfamiliar areas or reference-pattern adoption needs source verification.",
      purpose: "Confirm context/search evidence before plan packets rely on discovered patterns.",
      requiresUserGate: false
    },
    {
      agent: "coherence-reviewer",
      mode: "proactive",
      when: "When plan packets touch more than one subsystem or map more than five dependency edges.",
      purpose: "Verify internal consistency across batches, dependencies, and handoff narratives.",
      requiresUserGate: false,
      skill: "document-coherence-pass"
    },
    {
      agent: "scope-guardian-reviewer",
      mode: "proactive",
      when: "When plan introduces new abstractions or generic utility layers.",
      purpose: "Challenge unnecessary abstraction and enforce minimum viable implementation scope.",
      requiresUserGate: false,
      skill: "document-scope-guard"
    },
    {
      agent: "feasibility-reviewer",
      mode: "proactive",
      when: "When plan carries runtime, environment, dependency, or resource assumptions.",
      purpose: "Validate execution and rollout feasibility before implementation starts.",
      requiresUserGate: false,
      skill: "document-feasibility-pass"
    }
  ],
  tdd: [
    {
      agent: "test-author",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always during the TDD cycle.",
      purpose: "Own RED quality and per-slice RED/GREEN/REFACTOR evidence: failing tests before production writes, minimal GREEN implementation, then behavior-preserving refactor notes.",
      requiresUserGate: false,
      skill: "tdd-cycle-evidence"
    },
    {
      agent: "slice-implementer",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always for GREEN and REFACTOR phases. Controller MUST NOT write production code itself.",
      purpose: "Implement the minimal passing slice inside explicit file boundaries and return strict worker evidence. v6.12.0 Phase M makes this dispatch mandatory; the linter rule `tdd_slice_implementer_missing` blocks the gate when GREEN was authored by anyone other than `slice-implementer`.",
      requiresUserGate: false
    },
    {
      agent: "slice-documenter",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always in PARALLEL with `slice-implementer --phase green` for the same slice.",
      purpose: "Write per-slice prose into `<artifacts-dir>/tdd-slices/S-<id>.md` while production code is being implemented. v6.12.0 Phase R makes this mandatory regardless of `discoveryMode`; the linter rule `tdd_slice_documenter_missing` blocks the gate when a `phase=doc` event is missing.",
      requiresUserGate: false
    },
    {
      agent: "integration-overseer",
      mode: "proactive",
      when: "When TDD fan-out used 2+ parallel slice-implementers, or when slices touch shared interfaces.",
      purpose: "Verify cohesion-contract integrity across shared types, touchpoints, invariants, and integration test outcomes after fan-in.",
      requiresUserGate: false
    },
    {
      agent: "reviewer",
      mode: "proactive",
      when: "When per-slice review triggers fire or assertion quality needs an independent read-only overseer.",
      purpose: "Read-only overseer pass for slice spec fit, assertion quality, and simpler alternatives.",
      requiresUserGate: false
    },
    {
      agent: "doc-updater",
      mode: "proactive",
      when: "Proactive in tdd when public behavior, APIs, or config surfaces change.",
      purpose: "Prevent code/docs drift before review and ship.",
      requiresUserGate: false
    }
  ],
  review: [
    {
      agent: "reviewer",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always in review stage.",
      purpose: "Layer 1 spec compliance plus integrated Layer 2 review across correctness, architecture, and inline performance/compatibility/observability lens coverage with source-tagged findings. Escalate to optional dedicated lens skills only when diff scope/risk justifies a deeper pass.",
      requiresUserGate: false,
      skill: "review-spec-pass"
    },
    {
      agent: "security-reviewer",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always in review stage. Even when no trust boundaries changed, produce an explicit no-change/no-impact security attestation.",
      purpose: "Guarantee a dedicated security pass on every diff: auth, input validation, secrets, injection, privilege, and blast-radius review are never opt-in.",
      requiresUserGate: false,
      skill: "security-audit"
    },
    {
      agent: "reviewer",
      mode: "proactive",
      when: "When trust boundaries changed, Critical/Important ambiguity remains, or the diff is both large and high-risk.",
      purpose: "Adversarial second-opinion review for genuinely high-blast-radius changes. Treat the implementation as hostile and try to break it before ship.",
      requiresUserGate: false,
      skill: "adversarial-review"
    },
    {
      agent: "reviewer",
      mode: "proactive",
      when: "When external reviewer comments, bot findings, or CI annotations are present after the initial review pass.",
      purpose: "Run the receiving-code-review workflow so every incoming feedback item gets an explicit disposition with evidence.",
      requiresUserGate: false,
      skill: "receiving-code-review"
    },
    {
      agent: "reviewer",
      mode: "proactive",
      when: "When repo signals or review context indicate TypeScript/JavaScript, Python, Ruby/Rails, Go, or Rust coverage is relevant.",
      purpose: "Route a matching stack-aware reviewer lens while keeping the default general review pass intact; do not run every stack lens unconditionally.",
      requiresUserGate: false,
      skill: "stack-aware-review"
    }
  ],
  ship: [
    {
      agent: "architect",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always before final ship — verify cross-stage cohesion across scope/design/spec/plan/code.",
      purpose: "Final cross-stage cohesion gate before release finalization.",
      requiresUserGate: false,
      skill: "architect-cross-stage-verification"
    },
    {
      agent: "release-reviewer",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always in ship stage.",
      purpose: "Run release readiness, finalization mode, rollback, evidence freshness, and victory-detector checks before archive/ship.",
      requiresUserGate: false
    },
    {
      agent: "doc-updater",
      mode: "proactive",
      when: "When release notes, migrations, public behavior, CLI/config, or docs changed.",
      purpose: "Ensure release notes and docs reflect actual shipped behavior.",
      requiresUserGate: false
    },
    {
      agent: "security-reviewer",
      mode: "proactive",
      when: "When release involves broad blast radius, trust-boundary movement, or unresolved security concerns.",
      purpose: "Provide final exploitability check before release finalization.",
      requiresUserGate: false
    }
  ]
};

/** Transition guard: agents with `mode: "mandatory"` in auto-subagent dispatch for this stage. */
export function mandatoryDelegationsForStage(
  stage: FlowStage,
  complexityTier: StageComplexityTier = "standard"
): string[] {
  const summary = stageDelegationSummary(complexityTier)
    .find((row) => row.stage === stage);
  return summary ? summary.mandatoryAgents : [];
}

/**
 * Wave 24 (v6.0.0) — track-aware mandatory delegation lookup.
 *
 * Returns `[]` (skip the gate entirely) when the run is on a small-fix
 * track or classified as a software bugfix:
 *
 *   - `track === "quick"` — the quick track is for trivial single-purpose
 *     fixes (landing-page copy, doc edits, config tweaks). Mandatory
 *     subagent dispatch is theatre on that surface area.
 *   - `taskClass === "software-bugfix"` — bugfixes carry a RED-first
 *     repro contract; the test author + reviewer in the tdd/review
 *     stages already cover the safety surface, so mandatory upstream
 *     delegation only burns tokens.
 *
 * Otherwise returns the registered mandatory list for the stage at the
 * given tier. Callers (gate-evidence, advance-stage validator,
 * subagents.ts table generator) MUST go through this helper instead of
 * `mandatoryDelegationsForStage` so the track-aware drop applies
 * uniformly.
 *
 * NOTE: the user query also calls this `lite/quick`. There is no `lite`
 * FlowTrack — the closest concept in cclaw is the `quick` track plus the
 * brainstorm `lightweight` complexity tier. We key on the FlowTrack
 * because the run-level decision is what matters at gate time;
 * complexity tier is a per-stage knob that doesn't survive the dispatch
 * boundary.
 */
export type MandatoryDelegationTaskClass =
  | "software-standard"
  | "software-trivial"
  | "software-bugfix";

export function mandatoryAgentsFor(
  stage: FlowStage,
  track: FlowTrack,
  taskClass?: MandatoryDelegationTaskClass | null,
  complexityTier: StageComplexityTier = "standard",
  discoveryMode?: DiscoveryMode
): string[] {
  if (track === "quick") return [];
  if (taskClass === "software-bugfix") return [];
  const effectiveTier = resolvedStageComplexityTier({
    stage,
    defaultTier: complexityTier,
    discoveryMode
  });
  return mandatoryDelegationsForStage(stage, effectiveTier);
}

/**
 * Wave 25 (v6.1.0) — track-aware artifact validation demotion.
 *
 * Mirrors `mandatoryAgentsFor`'s skip logic for the small-fix lanes.
 * Returns `true` when artifact-level "advanced" validation rules
 * (architecture-diagram async/failure edges, interaction edge-case
 * mandatory rows, stale-diagram drift check, expansion-strategist
 * delegation) should be DEMOTED from required → advisory.
 *
 *   - `track === "quick"` — quick-tier runs (single-purpose
 *     landing-page edits, doc tweaks, config nudges). The advanced
 *     checks fire on architecture surfaces a quick-track artifact
 *     usually doesn't have. Same trigger as Wave 24 Phase B.
 *   - `taskClass === "software-bugfix"` — bugfixes carry RED-first
 *     repro coverage; tdd/review own the safety surface.
 *
 * When this returns `true`, the linter still runs the rules and prints
 * their findings (so authors see them as advisory info), but does NOT
 * block stage advance. An audit event of type
 * `artifact_validation_demoted_by_track` is appended to
 * `delegation-events.jsonl` once per stage advance for traceability.
 */
export function shouldDemoteArtifactValidationByTrack(
  track: FlowTrack,
  taskClass?: MandatoryDelegationTaskClass | null
): boolean {
  if (track === "quick") return true;
  if (taskClass === "software-bugfix") return true;
  return false;
}

export function stageSchema(stage: FlowStage, track: FlowTrack = "standard", discoveryMode?: DiscoveryMode, taskClass?: MandatoryDelegationTaskClass | null): StageSchema {
  const rawInput = stage === "tdd" ? tddStageForTrack(track) : STAGE_SCHEMA_MAP[stage];
  const base = normalizeStageSchemaInput(rawInput);
  const tieredGates = tieredStageGates(stage, base.requiredGates, track);
  const tieredValidation = tieredArtifactValidation(stage, base.artifactValidation);
  const crossStageTrace = {
    ...base.crossStageTrace,
    readsFrom: readsFromForTrack(base.crossStageTrace.readsFrom, track)
  };
  const complexityTier: StageComplexityTier = resolvedStageComplexityTier({
    stage,
    defaultTier: base.complexityTier ?? "standard",
    discoveryMode
  });
  const mandatoryDelegations = mandatoryDelegationsForStage(stage, complexityTier);
  const philosophy: StagePhilosophy = {
    hardGate: base.hardGate,
    ironLaw: base.ironLaw,
    purpose: base.purpose,
    whenToUse: base.whenToUse,
    whenNotToUse: base.whenNotToUse,
    commonRationalizations: base.commonRationalizations
  };
  const executionModel: StageExecutionModel = {
    interactionProtocol: base.interactionProtocol,
    process: base.process,
    processFlow: base.processFlow,
    platformNotes: base.platformNotes,
    checklist: base.checklist,
    requiredGates: tieredGates,
    requiredEvidence: base.requiredEvidence,
    inputs: base.inputs,
    requiredContext: base.requiredContext,
    researchPlaybooks: base.researchPlaybooks,
    blockers: base.blockers,
    exitCriteria: base.exitCriteria
  };
  const artifactRules: StageArtifactRules = {
    artifactFile: base.artifactFile,
    completionStatus: base.completionStatus,
    crossStageTrace,
    artifactValidation: tieredValidation,
    trivialOverrideSections: base.trivialOverrideSections
  };
  const reviewLens: StageReviewLens = {
    outputs: base.outputs,
    reviewSections: base.reviewSections,
    mandatoryDelegations,
    reviewLoop: base.reviewLoop
  };
  return {
    ...base,
    schemaShape: "v2",
    complexityTier,
    philosophy,
    executionModel,
    artifactRules,
    reviewLens,
    skillFolder: STAGE_TO_SKILL_FOLDER[stage],
    crossStageTrace,
    requiredGates: tieredGates,
    artifactValidation: tieredValidation,
    mandatoryDelegations
  };
}

export function orderedStageSchemas(track: FlowTrack = "standard"): StageSchema[] {
  return FLOW_STAGES.map((stage) => stageSchema(stage, track));
}

export function stageGateIds(stage: FlowStage, track: FlowTrack = "standard"): string[] {
  return stageSchema(stage, track).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
}

export function stageRecommendedGateIds(stage: FlowStage, track: FlowTrack = "standard"): string[] {
  return stageSchema(stage, track).requiredGates
    .filter((gate) => gate.tier === "recommended")
    .map((gate) => gate.id);
}

export function buildTransitionRules(): TransitionRule[] {
  const rules: TransitionRule[] = [];
  const seen = new Set<string>();
  // Derive transitions from every track so medium/quick (which skip stages)
  // get their neighbour edges registered alongside the standard chain.
  // Previously only the standard track produced rules, so `canTransition`
  // returned false for legitimate medium/quick transitions (e.g. brainstorm
  // -> spec on medium) even though `nextStage` correctly advanced them.
  for (const track of FLOW_TRACKS) {
    const ordered = TRACK_STAGES[track];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const from = ordered[i];
      const to = ordered[i + 1];
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({
        from,
        to,
        guards: stageGateIds(from, track)
      });
    }
  }
  // Review can explicitly route back to TDD when the verdict is BLOCKED.
  rules.push({
    from: "review",
    to: "tdd",
    guards: ["review_verdict_blocked"]
  });
  return rules;
}

export function stagePolicyNeedles(stage: FlowStage, track: FlowTrack = "standard"): string[] {
  return stagePolicyNeedlesFromMetadata(stage, track);
}

export function stageTrackRenderContext(track: FlowTrack = "standard") {
  return trackRenderContext(track);
}

export function stageAutoSubagentDispatch(stage: FlowStage): StageAutoSubagentDispatch[] {
  return STAGE_AUTO_SUBAGENT_DISPATCH[stage].map((row) => {
    const normalized = delegationDispatchRule(row);
    return {
      ...row,
      dispatchClass: normalized.dispatchClass,
      returnSchema: normalized.returnSchema
    };
  });
}
