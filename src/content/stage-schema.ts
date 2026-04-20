import { FLOW_STAGES, FLOW_TRACKS, TRACK_STAGES } from "../types.js";
import type { FlowStage, FlowTrack, TransitionRule } from "../types.js";
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

/**
 * Gate tiers:
 * - required: blocking for stage completion.
 * - recommended: quality signal; unmet -> DONE_WITH_CONCERNS, not BLOCKED.
 */
type RequiredGateSet = string[] | ((track: FlowTrack) => string[]);

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
      when: "Always during scope shaping.",
      purpose: "Challenge premise, map alternatives, and produce explicit in/out contract.",
      requiresUserGate: false
    }
  ],
  design: [
    {
      agent: "planner",
      mode: "mandatory",
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
      when: "Always when producing execution slices.",
      purpose: "Create dependency-aware task graph with verification steps.",
      requiresUserGate: false
    }
  ],
  tdd: [
    {
      agent: "test-author",
      mode: "mandatory",
      when: "Always during TDD cycle (RED → GREEN → REFACTOR).",
      purpose: "Guarantee failing tests, traceable implementation, and full-suite verification.",
      requiresUserGate: false
    },
    {
      agent: "doc-updater",
      mode: "proactive",
      when: "When public behavior, APIs, or config surfaces change.",
      purpose: "Prevent code/docs drift before review and ship.",
      requiresUserGate: false
    }
  ],
  review: [
    {
      agent: "reviewer",
      mode: "mandatory",
      when: "Always in review stage.",
      purpose: "Run spec compliance and code-quality passes with file evidence.",
      requiresUserGate: false
    },
    {
      agent: "security-reviewer",
      mode: "mandatory",
      when: "Always in review stage. Even when no trust boundaries changed, produce an explicit 'no-change' security attestation.",
      purpose: "Guarantee a dedicated security pass on every diff: auth, input validation, secrets, injection, privilege, and blast-radius review are never opt-in. MUST load the `security-audit` skill and run a pattern-based sweep across the diff scope and touched modules in addition to the per-diff Layer 2 security checklist.",
      requiresUserGate: false,
      skill: "security-audit"
    },
    {
      agent: "reviewer",
      mode: "proactive",
      when: "When the diff exceeds 100 changed lines, touches more than 10 files, or modifies trust boundaries — dispatch a SECOND, independent reviewer with the adversarial-review skill loaded so the review army has at least two voices on a high-blast-radius change.",
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
export function mandatoryDelegationsForStage(stage: FlowStage): string[] {
  return STAGE_AUTO_SUBAGENT_DISPATCH[stage]
    .filter((d) => d.mode === "mandatory")
    .map((d) => d.agent);
}

export function stageSchema(stage: FlowStage, track: FlowTrack = "standard"): StageSchema {
  const base = stage === "tdd" ? tddStageForTrack(track) : STAGE_SCHEMA_MAP[stage];
  const tieredGates = tieredStageGates(stage, base.requiredGates, track);
  const tieredValidation = tieredArtifactValidation(stage, base.artifactValidation);
  return {
    ...base,
    requiredGates: tieredGates,
    artifactValidation: tieredValidation,
    mandatoryDelegations: mandatoryDelegationsForStage(stage)
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
