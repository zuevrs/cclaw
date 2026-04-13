import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { enhancedAgentBody } from "../../src/content/subagents.js";

describe("stage schema and subagent alignment", () => {
  it("plan stage reads spec, design, and scope artifacts", () => {
    const plan = stageSchema("plan");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/04-spec.md");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/03-design.md");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/02-scope.md");
    expect(plan.requiredGates.map((gate) => gate.id)).toContain("plan_dependency_waves_defined");
    expect(plan.policyNeedles).toContain("Dependency Waves");
  });

  it("test-author template distinguishes TEST and BUILD stage modes", () => {
    const template = enhancedAgentBody("test-author");
    expect(template).toContain("STAGE_MODE: {TEST_RED_ONLY | BUILD_GREEN_REFACTOR}");
    expect(template).toContain("Do NOT edit production code.");
    expect(template).toContain("GREEN — minimal production code");
  });

  it("review stage includes review-army structured reconciliation", () => {
    const review = stageSchema("review");
    expect(review.requiredEvidence).toContain("Artifact written to `.cclaw/artifacts/07-review-army.json`.");
    expect(review.policyNeedles).toContain("Review Army");
  });
});
