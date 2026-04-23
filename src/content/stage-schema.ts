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
import { tddStageForTrack } from "./stages/tdd.js";
import type {
  ArtifactValidation,
  StageComplexityTier,
  StageExecutionModel,
  StagePhilosophy,
  StageArtifactRules,
  StageReviewLens,
  StageAutoSubagentDispatch,
  StageGate,
  StageSchema,
  StageSchemaInput
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
  StageReviewLens,
  StageAutoSubagentDispatch,
  StageGate,
  StageSchema,
  StageSchemaInput
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

const ARTIFACT_STAGE_BY_PATH: Partial<Record<string, FlowStage>> = {
  ".cclaw/artifacts/01-brainstorm.md": "brainstorm",
  ".cclaw/artifacts/02-scope.md": "scope",
  ".cclaw/artifacts/02a-research.md": "design",
  ".cclaw/artifacts/03-design.md": "design",
  ".cclaw/artifacts/04-spec.md": "spec",
  ".cclaw/artifacts/05-plan.md": "plan",
  ".cclaw/artifacts/06-tdd.md": "tdd",
  ".cclaw/artifacts/07-review.md": "review",
  ".cclaw/artifacts/08-ship.md": "ship"
};

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
    "spec_user_approved"
  ],
  plan: [
    "plan_tasks_sliced_2_5_min",
    "plan_dependency_batches_defined",
    "plan_acceptance_mapped",
    "plan_wait_for_confirm"
  ],
  tdd: (track) => [
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
  brainstorm: ["Context", "Problem", "Approaches", "Selected Direction"],
  scope: ["Scope Mode", "In Scope / Out of Scope", "Completion Dashboard", "Scope Summary"],
  design: [
    "Research Fleet Synthesis",
    "Architecture Boundaries",
    "Architecture Diagram",
    "Failure Mode Table",
    "Completion Dashboard"
  ],
  spec: ["Acceptance Criteria", "Edge Cases", "Testability Map", "Approval"],
  plan: ["Task List", "Dependency Batches", "Acceptance Mapping", "WAIT_FOR_CONFIRM"],
  tdd: ["RED Evidence", "GREEN Evidence", "REFACTOR Notes", "Traceability", "Verification Ladder"],
  review: ["Layer 1 Verdict", "Review Army Contract", "Severity Summary", "Final Verdict"],
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
    const stage = ARTIFACT_STAGE_BY_PATH[artifactPath];
    if (!stage) {
      return true;
    }
    return stageSet.has(stage);
  });
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
      when: "Always during TDD cycle (RED phase).",
      purpose: "Produce failing RED tests only; no production writes.",
      requiresUserGate: false,
      skill: "tdd-red-phase"
    },
    {
      agent: "test-author",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always during TDD cycle (GREEN phase).",
      purpose: "Implement minimum production changes to satisfy RED and prove full-suite GREEN.",
      requiresUserGate: false,
      skill: "tdd-green-phase"
    },
    {
      agent: "test-author",
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Always during TDD cycle (REFACTOR phase).",
      purpose: "Refactor only after GREEN proof, preserving behavior and test pass state.",
      requiresUserGate: false,
      skill: "tdd-refactor-phase"
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
      purpose: "Layer 1 spec compliance pass plus coordination of parallel Layer 2 fan-out (correctness, performance, architecture, external-safety) with source-tagged findings.",
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
      mode: "mandatory",
      requiredAtTier: "lightweight",
      when: "Mandatory when the diff exceeds 100 changed lines, touches more than 10 files, or modifies trust boundaries — dispatch a SECOND, independent reviewer with the adversarial-review skill loaded so the review army has at least two voices on a high-blast-radius change.",
      purpose: "Adversarial second-opinion review on large or trust-sensitive diffs. The second reviewer treats the implementation as hostile and tries to break it (hostile-user, future-maintainer, competitor lenses) instead of sympathetically explaining it.",
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
  const currentTierRank = COMPLEXITY_TIER_ORDER[complexityTier];
  return [...new Set(
    STAGE_AUTO_SUBAGENT_DISPATCH[stage]
      .filter((d) => d.mode === "mandatory")
      .filter((d) => {
        const requiredAt = d.requiredAtTier ?? "standard";
        return currentTierRank >= COMPLEXITY_TIER_ORDER[requiredAt];
      })
      .map((d) => d.agent)
  )];
}

export function stageSchema(stage: FlowStage, track: FlowTrack = "standard"): StageSchema {
  const base = stage === "tdd" ? tddStageForTrack(track) : STAGE_SCHEMA_MAP[stage];
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
    policyNeedles: base.policyNeedles
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
  return stageSchema(stage, track).policyNeedles;
}

export function stageAutoSubagentDispatch(stage: FlowStage): StageAutoSubagentDispatch[] {
  return STAGE_AUTO_SUBAGENT_DISPATCH[stage];
}
