import { FLOW_STAGES, FLOW_TRACKS, TRACK_STAGES } from "../types.js";
import type { FlowStage, FlowTrack, TransitionRule } from "../types.js";
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

export const SKILL_ENVELOPE_KINDS = [
  "stage-output",
  "gate-result",
  "delegation-record"
] as const;

export type SkillEnvelopeKind = (typeof SKILL_ENVELOPE_KINDS)[number];

export interface SkillEnvelope {
  version: "1";
  kind: SkillEnvelopeKind;
  stage: FlowStage;
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

export interface StageDelegationSummary {
  stage: FlowStage;
  mandatoryAgents: string[];
  proactiveAgents: string[];
  primaryAgents: string[];
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
  if (typeof record.stage !== "string" || !FLOW_STAGE_SET.has(record.stage as FlowStage)) {
    errors.push(`envelope.stage must be one of: ${FLOW_STAGES.join(", ")}.`);
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
    "design_data_flow_mapped",
    "design_failure_modes_mapped",
    "design_test_and_perf_defined"
  ],
  spec: [
    "spec_acceptance_measurable",
    "spec_testability_confirmed",
    "spec_assumptions_surfaced",
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
    "tdd_docs_drift_check",
    ...(track === "quick" ? [] : ["tdd_traceable_to_plan"])
  ],
  review: (track) => [
    "review_layer1_spec_compliance",
    "review_layer2_security",
    "review_criticals_resolved",
    "review_army_json_valid",
    ...(track === "quick" ? [] : ["review_trace_matrix_clean"])
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
    "Problem",
    "Approach Tier",
    "Approaches",
    "Approach Reaction",
    "Selected Direction"
  ],
  scope: ["Scope Mode", "In Scope / Out of Scope", "Completion Dashboard", "Scope Summary"],
  design: [
    "Research Fleet Synthesis",
    "Architecture Boundaries",
    "Architecture Diagram",
    "Failure Mode Table",
    "Security & Threat Model",
    "Observability & Debuggability",
    "Deployment & Rollout",
    "Completion Dashboard"
  ],
  spec: ["Acceptance Criteria", "Edge Cases", "Assumptions Before Finalization", "Testability Map", "Approval"],
  plan: ["Task List", "Dependency Batches", "Acceptance Mapping", "Execution Posture", "WAIT_FOR_CONFIRM"],
  tdd: ["Test Discovery", "System-Wide Impact Check", "RED Evidence", "GREEN Evidence", "REFACTOR Notes", "Traceability", "Verification Ladder"],
  review: ["Layer 1 Verdict", "Review Findings Contract", "Severity Summary", "Final Verdict"],
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

const STAGE_AUTO_SUBAGENT_DISPATCH: Record<FlowStage, StageAutoSubagentDispatch[]> = {
  brainstorm: [
    {
      agent: "planner",
      mode: "proactive",
      when: "When request is ambiguous, multi-surface, or spans multiple modules.",
      purpose: "Map scope and alternatives before direction lock.",
      requiresUserGate: false
    }
  ],
  scope: [
    {
      agent: "planner",
      mode: "mandatory",
      requiredAtTier: "standard",
      when: "Always during scope shaping.",
      purpose: "Challenge premise, map alternatives, and produce explicit in/out contract.",
      requiresUserGate: false
    }
  ],
  design: [
    {
      agent: "planner",
      mode: "mandatory",
      requiredAtTier: "standard",
      when: "Always during design lock.",
      purpose: "Stress architecture boundaries and dependency graph.",
      requiresUserGate: false
    },
    {
      agent: "security-reviewer",
      mode: "proactive",
      when: "When trust boundaries, auth, secrets, or external inputs are involved.",
      purpose: "Catch design-level security risks before implementation.",
      requiresUserGate: false
    }
  ],
  spec: [
    {
      agent: "planner",
      mode: "proactive",
      when: "When acceptance criteria are unclear or constraints conflict.",
      purpose: "Normalize measurable criteria and testability mapping.",
      requiresUserGate: false
    },
    {
      agent: "reviewer",
      mode: "proactive",
      when: "When acceptance criteria and edge cases are drafted and need independent validation before plan stage.",
      purpose: "Independent review of spec against measurability, testability, and completeness before locking the contract for plan.",
      requiresUserGate: false
    }
  ],
  plan: [
    {
      agent: "planner",
      mode: "mandatory",
      requiredAtTier: "standard",
      when: "Always when producing execution slices.",
      purpose: "Create dependency-aware task graph with verification steps.",
      requiresUserGate: false
    }
  ],
  tdd: [
    {
      agent: "test-author",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always during the TDD cycle.",
      purpose: "Own phase-specific RED/GREEN/REFACTOR evidence for each slice: failing tests before production writes, minimal GREEN implementation, then behavior-preserving refactor notes.",
      requiresUserGate: false,
      skill: "tdd-cycle-evidence"
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
      purpose: "Layer 1 spec compliance plus integrated Layer 2 review across correctness, performance, architecture, and external-safety tags with source-tagged findings.",
      requiresUserGate: false,
      skill: "review-spec-pass"
    },
    {
      agent: "security-reviewer",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always in review stage. Even when no trust boundaries changed, produce an explicit 'no-change' security attestation.",
      purpose: "Guarantee a dedicated security pass on every diff: auth, input validation, secrets, injection, privilege, and blast-radius review are never opt-in. MUST load the `security-audit` skill and run a pattern-based sweep across the diff scope and touched modules in addition to the per-diff Layer 2 security checklist.",
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
      purpose: "Run the receiving-code-review workflow so every incoming feedback item gets an explicit disposition with evidence, and the queue is mirrored into review artifacts.",
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
      agent: "doc-updater",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always in ship stage.",
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

export function stageSchema(stage: FlowStage, track: FlowTrack = "standard"): StageSchema {
  const rawInput = stage === "tdd" ? tddStageForTrack(track) : STAGE_SCHEMA_MAP[stage];
  const base = normalizeStageSchemaInput(rawInput);
  const tieredGates = tieredStageGates(stage, base.requiredGates, track);
  const tieredValidation = tieredArtifactValidation(stage, base.artifactValidation);
  const crossStageTrace = {
    ...base.crossStageTrace,
    readsFrom: readsFromForTrack(base.crossStageTrace.readsFrom, track)
  };
  const complexityTier: StageComplexityTier = base.complexityTier ?? "standard";
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

export function nextCclawCommand(stage: FlowStage): string {
  const next = stageSchema(stage).next;
  return next === "done" ? "none" : `/cc-${next}`;
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
  return STAGE_AUTO_SUBAGENT_DISPATCH[stage];
}
