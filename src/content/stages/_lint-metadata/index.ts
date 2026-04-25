import { SHIP_FINALIZATION_MODES } from "../../../constants.js";
import type { FlowStage, FlowTrack } from "../../../types.js";

const STAGE_POLICY_NEEDLES: Record<FlowStage, string[]> = {
  brainstorm: [
    "Explore project context",
    "One question at a time",
    "2-3 architecturally distinct approaches",
    "State what is being approved",
    "Self-review before handoff",
    "Do NOT implement, scaffold, or modify behavior"
  ],
  scope: [
    "Scope mode",
    "In Scope",
    "Out of Scope",
    "Discretion Areas",
    "NOT in scope",
    "Premise Challenge",
    "Locked Decisions"
  ],
  design: [
    "Parallel Research Fleet",
    "Architecture",
    "Data Flow",
    "Failure Modes and Mitigation",
    "Performance Budget",
    "One issue at a time"
  ],
  spec: ["Acceptance Criteria", "Constraints", "Testability", "approved spec", "Edge Cases"],
  plan: [
    "WAIT_FOR_CONFIRM",
    "Task Graph",
    "Dependency Batches",
    "Acceptance Mapping",
    "verification steps",
    "Locked Decision Coverage"
  ],
  tdd: [
    "RED",
    "GREEN",
    "REFACTOR",
    "failing test",
    "full test suite",
    "acceptance criteria",
    "traceable to plan slice"
  ],
  review: [
    "Layer 1",
    "Layer 2",
    "Critical",
    "Review Findings",
    "Ready to Ship",
    "ROUTE_BACK_TO_TDD",
    "One issue at a time"
  ],
  ship: [
    "Pre-Ship Checks",
    "Release Notes",
    "Rollback Plan",
    ...SHIP_FINALIZATION_MODES
  ]
};

function quickTrackText(value: string): string {
  return value
    .replace(/\btask from the plan\b/giu, "acceptance criterion from the spec")
    .replace(/\bplan task ID\b/giu, "acceptance criterion ID")
    .replace(/\bplan task\b/giu, "acceptance criterion")
    .replace(/\bplan row\b/giu, "acceptance row")
    .replace(/\bplan slice\b/giu, "acceptance slice")
    .replace(/\bplan artifact\b/giu, "spec artifact")
    .replace(/\btraceable to plan slice\b/giu, "traceable to acceptance criterion")
    .replace(/05-plan\.md/gu, "04-spec.md");
}

export function stagePolicyNeedlesFromMetadata(stage: FlowStage, track: FlowTrack = "standard"): string[] {
  const needles = STAGE_POLICY_NEEDLES[stage];
  if (stage === "tdd" && track === "quick") {
    return needles.map(quickTrackText);
  }
  return [...needles];
}

