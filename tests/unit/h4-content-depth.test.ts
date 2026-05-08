import { describe, expect, it } from "vitest";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BRAINSTORMER_PROMPT } from "../../src/content/specialist-prompts/brainstormer.js";
import { PLANNER_PROMPT } from "../../src/content/specialist-prompts/planner.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { templateBody } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

describe("v8 content depth — H4 + H5 trim", () => {
  it("registers a conversation-language always-on skill", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "conversation-language");
    expect(skill).toBeDefined();
    expect(skill?.triggers).toContain("always-on");
    expect(skill?.body).toContain("MUST stay in the user's language");
    expect(skill?.body).toContain("MUST NOT be translated");
    expect(skill?.body).toContain("AC ids");
  });

  it("review-loop skill defines Concern Ledger and convergence detector", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-loop");
    expect(skill?.body).toContain("Concern Ledger");
    expect(skill?.body).toContain("Convergence detector");
    expect(skill?.body).toContain("Two consecutive iterations");
    expect(skill?.body).toContain("F-N");
  });

  it("plan template is lean: Frame + Approaches + Not Doing + AC + Edge cases + Topology", () => {
    const body = templateBody("plan", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).toContain("## Frame");
    expect(body).toContain("## Approaches");
    expect(body).toContain("baseline");
    expect(body).toContain("challenger");
    expect(body).toContain("## Selected Direction");
    expect(body).toContain("## Not Doing");
    expect(body).toContain("## Acceptance Criteria");
    expect(body).toContain("parallelSafe");
    expect(body).toContain("touchSurface");
    expect(body).toContain("## Edge cases");
    expect(body).toContain("## Topology");
    expect(body).toContain("## Traceability block");
  });

  it("plan template has no v7-revival ceremony (Q&A Log, PDR schema, How Might We, Reproduction contract)", () => {
    const body = templateBody("plan", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).not.toContain("Q&A Log");
    expect(body).not.toContain("[topic:pain]");
    expect(body).not.toContain("Problem Decision Record");
    expect(body).not.toContain("How Might We");
    expect(body).not.toContain("Premise check");
    expect(body).not.toContain("Embedded Grill");
    expect(body).not.toContain("Acceptance Mapping");
    expect(body).not.toContain("Constraints and Assumptions");
    expect(body).not.toContain("Reproduction contract");
    expect(body).not.toContain("Self-Review Notes");
  });

  it("decisions template carries Architecture tier, Failure Mode Table, Pre-mortem, Escape Hatch, Blast-radius Diff", () => {
    const body = templateBody("decisions", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).toContain("Architecture tier");
    expect(body).toContain("minimum-viable");
    expect(body).toContain("product-grade");
    expect(body).toContain("ideal");
    expect(body).toContain("Trivial-Change Escape Hatch");
    expect(body).toContain("Blast-radius Diff");
    expect(body).toContain("Failure Mode Table");
    expect(body).toContain("Method");
    expect(body).toContain("Exception");
    expect(body).toContain("Rescue");
    expect(body).toContain("UserSees");
    expect(body).toContain("Pre-mortem");
  });

  it("ship template carries preflight, repo-mode, rollback triplet, finalization enum, Victory Detector", () => {
    const body = templateBody("ship", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).toContain("Preflight checks");
    expect(body).toContain("Repository mode detection");
    expect(body).toContain("Merge-base detection");
    expect(body).toContain("Rollback plan");
    expect(body).toContain("Trigger conditions");
    expect(body).toContain("Rollback steps");
    expect(body).toContain("Verification");
    expect(body).toContain("Monitoring checklist");
    expect(body).toContain("FINALIZE_MERGE_LOCAL");
    expect(body).toContain("FINALIZE_OPEN_PR");
    expect(body).toContain("FINALIZE_KEEP_BRANCH");
    expect(body).toContain("FINALIZE_DISCARD_BRANCH");
    expect(body).toContain("FINALIZE_NO_VCS");
    expect(body).toContain("Victory Detector");
  });

  it("brainstormer prompt is lean: Frame + optional Approaches + Selected Direction + Not Doing", () => {
    expect(BRAINSTORMER_PROMPT).toContain("## Frame");
    expect(BRAINSTORMER_PROMPT).toContain("## Approaches");
    expect(BRAINSTORMER_PROMPT).toContain("## Selected Direction");
    expect(BRAINSTORMER_PROMPT).toContain("## Not Doing");
    expect(BRAINSTORMER_PROMPT).toContain("baseline");
    expect(BRAINSTORMER_PROMPT).toContain("challenger");
    expect(BRAINSTORMER_PROMPT).toContain("at most three");
  });

  it("brainstormer prompt has no v7-revival ceremony (Q&A loop, forcing topics, PDR schema, Embedded Grill)", () => {
    expect(BRAINSTORMER_PROMPT).not.toContain("Q&A Log");
    expect(BRAINSTORMER_PROMPT).not.toContain("[topic:pain]");
    expect(BRAINSTORMER_PROMPT).not.toContain("[topic:direct-path]");
    expect(BRAINSTORMER_PROMPT).not.toContain("[topic:operator]");
    expect(BRAINSTORMER_PROMPT).not.toContain("[topic:no-go]");
    expect(BRAINSTORMER_PROMPT).not.toContain("forcing question");
    expect(BRAINSTORMER_PROMPT).not.toContain("Problem Decision Record");
    expect(BRAINSTORMER_PROMPT).not.toContain("How Might We");
    expect(BRAINSTORMER_PROMPT).not.toContain("Embedded Grill");
    expect(BRAINSTORMER_PROMPT).not.toContain("Self-Review Notes");
  });

  it("planner prompt is lean: AC + edge case per AC + topology with parallel cap", () => {
    expect(PLANNER_PROMPT).toContain("Acceptance Criteria");
    expect(PLANNER_PROMPT).toContain("parallelSafe");
    expect(PLANNER_PROMPT).toContain("touchSurface");
    expect(PLANNER_PROMPT).toContain("Edge cases");
    expect(PLANNER_PROMPT).toContain("5 parallel slices");
    expect(PLANNER_PROMPT).toContain("worktree");
  });

  it("planner prompt has no v7-revival ceremony (2-5 minute steps, Acceptance Mapping table, Reproduction contract)", () => {
    expect(PLANNER_PROMPT).not.toContain("2-5 minute");
    expect(PLANNER_PROMPT).not.toContain("2–5 minute");
    expect(PLANNER_PROMPT).not.toContain("five-minute");
    expect(PLANNER_PROMPT).not.toContain("Acceptance Mapping");
    expect(PLANNER_PROMPT).not.toContain("Reproduction contract");
    expect(PLANNER_PROMPT).not.toContain("Constraints and Assumptions");
  });

  it("architect prompt defines tier, Escape Hatch, Blast-radius Diff, Failure Mode Table, Pre-mortem", () => {
    expect(ARCHITECT_PROMPT).toContain("Architecture tier");
    expect(ARCHITECT_PROMPT).toContain("minimum-viable");
    expect(ARCHITECT_PROMPT).toContain("product-grade");
    expect(ARCHITECT_PROMPT).toContain("Trivial-Change Escape Hatch");
    expect(ARCHITECT_PROMPT).toContain("Blast-radius Diff");
    expect(ARCHITECT_PROMPT).toContain("Failure Mode Table");
    expect(ARCHITECT_PROMPT).toContain("Pre-mortem");
  });

  it("reviewer prompt enforces Concern Ledger + convergence detector + closing citation", () => {
    expect(REVIEWER_PROMPT).toContain("Concern Ledger");
    expect(REVIEWER_PROMPT).toContain("F-N ids are stable");
    expect(REVIEWER_PROMPT).toContain("Convergence detector");
    expect(REVIEWER_PROMPT).toContain("Closing a row requires a citation");
    expect(REVIEWER_PROMPT).toContain("zero_block_streak");
  });

  it("slice-builder + tdd-cycle skill forbid AC-id-named test files", () => {
    expect(SLICE_BUILDER_PROMPT).toContain("Test files follow project convention");
    expect(SLICE_BUILDER_PROMPT).toContain("Never name a test file after an AC id");
    const tddSkill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle");
    expect(tddSkill?.body).toContain("Test files are named by the unit under test, NOT by the AC id");
    expect(tddSkill?.body).toContain("AC-1.test.ts");
  });

  it("parallel-build skill enforces 5-slice cap, slice = 1+ AC sharing touchSurface, worktree dispatch", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "parallel-build");
    expect(skill?.body).toContain("5 parallel slices");
    expect(skill?.body).toContain("Slice = 1+ AC with shared touchSurface");
    expect(skill?.body).toContain("git worktree");
    expect(skill?.body).toContain("inline-sequential");
    expect(skill?.body).toContain(".cclaw/worktrees/");
  });
});
