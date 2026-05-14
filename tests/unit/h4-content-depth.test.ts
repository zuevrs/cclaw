import { describe, expect, it } from "vitest";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { AC_AUTHOR_PROMPT } from "../../src/content/specialist-prompts/ac-author.js";
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

  it("review-loop skill defines Findings table and convergence detector", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-discipline");
    expect(skill?.body).toContain("Findings");
    expect(skill?.body).toContain("Convergence detector");
    expect(skill?.body).toContain("Two consecutive iterations");
    expect(skill?.body).toContain("F-N");
  });

  it("plan template is lean: Frame + Spec (v8.46) + Approaches + Not Doing + AC + Edge cases + Topology", () => {
    const body = templateBody("plan", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).toContain("## Frame");
    expect(body).toContain("## Spec");
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

  it("design prompt names all 7 collaborative phases (v8.14 strong design)", () => {
    expect(DESIGN_PROMPT).toContain("Phase 0 — Bootstrap");
    expect(DESIGN_PROMPT).toContain("Phase 1 — Clarify");
    expect(DESIGN_PROMPT).toContain("Phase 2 — Frame");
    expect(DESIGN_PROMPT).toContain("Phase 3 — Approaches");
    expect(DESIGN_PROMPT).toContain("Phase 4 — Decisions");
    expect(DESIGN_PROMPT).toContain("Phase 5 — Pre-mortem");
    expect(DESIGN_PROMPT).toContain("Phase 6 — Compose + self-review");
    expect(DESIGN_PROMPT).toContain("Phase 7 — Sign-off");
  });

  it("design prompt runs in main context (v8.47 two-turn-max pacing) with guided/deep postures", () => {
    expect(DESIGN_PROMPT).toContain("MAIN ORCHESTRATOR CONTEXT");
    expect(DESIGN_PROMPT).toContain("guided");
    expect(DESIGN_PROMPT).toContain("deep");
    // v8.47: replaced "ALWAYS step" with two-turn-max pacing (Phase 1 conditional
    // + Phase 7 mandatory) while keeping the 7-phase structure.
    expect(DESIGN_PROMPT).toMatch(/two-turn-at-most|at MOST twice|two-turn-max/i);
  });

  it("design prompt forbids writing code, AC, pseudocode (those are ac-author / slice-builder jobs)", () => {
    expect(DESIGN_PROMPT).toContain("do NOT write code");
    expect(DESIGN_PROMPT).toContain("No code, no AC, no pseudocode");
  });

  it("design prompt enumerates the rationalization table (8 excuse->reality rows)", () => {
    expect(DESIGN_PROMPT).toContain("Anti-rationalization table");
    expect(DESIGN_PROMPT).toContain("Excuse");
    expect(DESIGN_PROMPT).toContain("Reality");
  });

  it("design prompt records D-N decisions inline in plan.md (no separate decisions.md)", () => {
    expect(DESIGN_PROMPT).toContain("## Decisions");
    expect(DESIGN_PROMPT).toContain("inline in plan.md");
    expect(DESIGN_PROMPT).not.toContain("flows/<slug>/decisions.md");
  });

  it("design prompt has no pre-v8.14 ceremony (brainstormer Q&A topics, architect tier vocabulary)", () => {
    expect(DESIGN_PROMPT).not.toContain("Q&A Log");
    expect(DESIGN_PROMPT).not.toContain("[topic:pain]");
    expect(DESIGN_PROMPT).not.toContain("forcing question");
    expect(DESIGN_PROMPT).not.toContain("Problem Decision Record");
  });

  it("ac-author prompt is lean: AC + edge case per AC + topology with parallel cap", () => {
    expect(AC_AUTHOR_PROMPT).toContain("Acceptance Criteria");
    expect(AC_AUTHOR_PROMPT).toContain("parallelSafe");
    expect(AC_AUTHOR_PROMPT).toContain("touchSurface");
    expect(AC_AUTHOR_PROMPT).toContain("Edge cases");
    expect(AC_AUTHOR_PROMPT).toContain("5 parallel slices");
    expect(AC_AUTHOR_PROMPT).toContain("worktree");
  });

  it("ac-author prompt has no v7-revival ceremony (2-5 minute steps, Acceptance Mapping table, Reproduction contract)", () => {
    expect(AC_AUTHOR_PROMPT).not.toContain("2-5 minute");
    expect(AC_AUTHOR_PROMPT).not.toContain("2–5 minute");
    expect(AC_AUTHOR_PROMPT).not.toContain("five-minute");
    expect(AC_AUTHOR_PROMPT).not.toContain("Acceptance Mapping");
    expect(AC_AUTHOR_PROMPT).not.toContain("Reproduction contract");
    expect(AC_AUTHOR_PROMPT).not.toContain("Constraints and Assumptions");
  });

  it("design prompt covers what architect used to: failure modes, alternatives considered, pre-mortem", () => {
    // v8.14: architect's vocabulary (tier, escape hatch, blast-radius diff) was
    // dropped because design + ac-author together produce the same coverage with
    // a lighter ceremony. The remaining structural-decision discipline lives
    // inside Phase 4 (D-N records with failure modes + alternatives) and
    // Phase 5 (pre-mortem, deep posture).
    expect(DESIGN_PROMPT).toContain("Failure modes");
    expect(DESIGN_PROMPT).toContain("Alternatives considered");
    expect(DESIGN_PROMPT).toContain("Blast-radius");
    expect(DESIGN_PROMPT).toContain("Pre-mortem");
  });

  it("reviewer prompt enforces Findings table + convergence detector + closing citation", () => {
    expect(REVIEWER_PROMPT).toContain("Findings");
    expect(REVIEWER_PROMPT).toContain("F-N ids are stable");
    expect(REVIEWER_PROMPT).toContain("Convergence detector");
    expect(REVIEWER_PROMPT).toContain("Closing a row requires a citation");
    expect(REVIEWER_PROMPT).toContain("zero_block_streak");
  });

  it("slice-builder + tdd-cycle skill forbid AC-id-named test files", () => {
    expect(SLICE_BUILDER_PROMPT).toContain("Test files follow project convention");
    expect(SLICE_BUILDER_PROMPT).toContain("Never name a test file after an AC id");
    const tddSkill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-and-verification");
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
