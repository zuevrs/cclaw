import { describe, expect, it } from "vitest";
import { extractForcingQuestions } from "../../src/artifact-linter/shared.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";

/**
 * Round 6 (v6.7.0) — counterfactual forcing-question pruning.
 *
 * Rationale: these forcing topics either duplicated information the
 * downstream artifact already captured (`do-nothing` ↔ brainstorm's
 * `Do-nothing consequence`, `failure-modes` ↔ design's Failure Mode
 * Table, `rollback` ↔ design's rollback plan) or raised recurring
 * user-reported false-positive friction on simple work. The topic IDs
 * must stay out of the elicitation contract so the `qa_log_unconverged`
 * linter rule doesn't re-ask them.
 *
 * Design's Failure Mode Table is UNTOUCHED — it remains mandatory for
 * design stage output.
 */
describe("no-counterfactual-forcing (Round 6 / v6.7.0)", () => {
  it("brainstorm forcing-question list no longer contains `do-nothing`", () => {
    const topics = extractForcingQuestions("brainstorm");
    const ids = topics.map((t) => t.id);
    expect(ids).not.toContain("do-nothing");
    expect(ids).toEqual(["pain", "direct-path", "operator", "no-go"]);
  });

  it("scope forcing-question list no longer contains `rollback` or `failure-modes`", () => {
    const topics = extractForcingQuestions("scope");
    const ids = topics.map((t) => t.id);
    expect(ids).not.toContain("rollback");
    expect(ids).not.toContain("failure-modes");
    expect(ids).toEqual(["in-out", "locked-upstream"]);
  });

  it("generated brainstorm skill does not emit the retired [topic:do-nothing] identifier", () => {
    const skill = stageSkillMarkdown("brainstorm");
    expect(skill).not.toContain("[topic:do-nothing]");
    expect(skill).not.toMatch(/\bdo-nothing:\s/u);
  });

  it("generated scope skill does not emit the retired [topic:rollback] or [topic:failure-modes] identifiers", () => {
    const skill = stageSkillMarkdown("scope");
    expect(skill).not.toContain("[topic:rollback]");
    expect(skill).not.toContain("[topic:failure-modes]");
    expect(skill).not.toMatch(/\brollback:\s/u);
    expect(skill).not.toMatch(/\bfailure-modes:\s/u);
  });

  it("generated brainstorm skill drops the counterfactual `What if we do nothing?` forcing line", () => {
    const skill = stageSkillMarkdown("brainstorm");
    expect(skill).not.toContain("What if we do nothing");
  });

  it("Design stage is unchanged — Failure Mode Table references still present", () => {
    const skill = stageSkillMarkdown("design");
    expect(skill.toLowerCase()).toMatch(/failure[- ]mode/u);
  });
});
