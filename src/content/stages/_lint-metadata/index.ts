import { SHIP_FINALIZATION_MODES } from "../../../constants.js";
import type { FlowStage, FlowTrack } from "../../../types.js";
import { renderTrackTerminology, trackRenderContext } from "../../track-render-context.js";

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
  spec: ["Acceptance Criteria", "Constraints", "Assumptions Before Finalization", "Testability", "approved spec", "Edge Cases"],
  plan: [
    "WAIT_FOR_CONFIRM",
    "Task Graph",
    "Dependency Batches",
    "Acceptance Mapping",
    "verification steps",
    "Execution Posture",
    "Locked Decision Coverage"
  ],
  tdd: [
    "RED",
    "GREEN",
    "REFACTOR",
    "failing test",
    "Test Discovery",
    "System-Wide Impact Check",
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

export function stagePolicyNeedlesFromMetadata(stage: FlowStage, track: FlowTrack = "standard"): string[] {
  const needles = STAGE_POLICY_NEEDLES[stage];
  const renderContext = trackRenderContext(track);
  if (stage === "tdd" && !renderContext.usesPlanTerminology) {
    return needles.map((needle) => renderTrackTerminology(needle, renderContext));
  }
  return [...needles];
}

