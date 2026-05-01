import { SHIP_FINALIZATION_MODES } from "../../../constants.js";
import type { FlowStage, FlowTrack } from "../../../types.js";
import { renderTrackTerminology, trackRenderContext } from "../../track-render-context.js";
import { referencePatternPolicyNeedles } from "../../reference-patterns.js";

const STAGE_POLICY_NEEDLES: Record<FlowStage, string[]> = {
  brainstorm: [
    "Explore project context",
    "One question at a time",
    "2-3 architecturally distinct approaches",
    "Embedded Grill",
    "Victory Detector",
    "Critic Pass",
    "State what is being approved",
    "Self-review before handoff",
    "Do NOT implement, scaffold, or modify behavior"
  ],
  scope: [
    "Scope mode",
    "In Scope",
    "Out of Scope",
    "Discretion Areas",
    "Premise Drift",
    "Locked Decisions",
    "Victory Detector",
    "Critic Pass"
  ],
  design: [
    "Parallel Research Fleet",
    "Architecture",
    "Data Flow",
    "Failure Modes and Mitigation",
    "Performance Budget",
    "Long-Term Trajectory",
    "Victory Detector",
    "Critic Pass",
    "One issue at a time"
  ],
  spec: [
    "Acceptance Criteria",
    "Constraints",
    "Assumptions Before Finalization",
    "Testability",
    "Spec Self-Review",
    "single subsystem",
    "approved spec",
    "Edge Cases"
  ],
  plan: [
    "WAIT_FOR_CONFIRM",
    "Task Graph",
    "Dependency Batches",
    "Acceptance Mapping",
    "verification steps",
    "Execution Posture",
    "Calibrated Findings",
    "Regression Iron Rule",
    "Locked Decision Coverage"
  ],
  tdd: [
    "RED",
    "GREEN",
    "REFACTOR",
    "failing test",
    "Iron Law Acknowledgement",
    "Watched-RED Proof",
    "Vertical Slice Cycle",
    "Test Discovery",
    "System-Wide Impact Check",
    "TDD Blocker Taxonomy",
    "Per-Slice Review",
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
  const needles = [...STAGE_POLICY_NEEDLES[stage], ...referencePatternPolicyNeedles(stage)];
  const renderContext = trackRenderContext(track);
  if (stage === "tdd" && !renderContext.usesPlanTerminology) {
    return needles.map((needle) => renderTrackTerminology(needle, renderContext));
  }
  return needles;
}

