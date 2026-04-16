import { describe, expect, it } from "vitest";
import { CCLAW_AGENTS } from "../../src/content/agents.js";
import { stageSchema } from "../../src/content/stage-schema.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { enhancedAgentBody } from "../../src/content/subagents.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/templates.js";

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

  it("07-review-army.json template matches validator schema shape", () => {
    const template = ARTIFACT_TEMPLATES["07-review-army.json"];
    const parsed = JSON.parse(template) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(typeof parsed.generatedAt).toBe("string");
    expect((parsed.generatedAt as string).length).toBeGreaterThan(0);
    expect(parsed.scope).toMatchObject({ base: expect.any(String), head: expect.any(String), files: [] });
    expect(parsed.findings).toEqual([]);
    expect(parsed.reconciliation).toEqual({
      duplicatesCollapsed: 0,
      conflicts: [],
      multiSpecialistConfirmed: [],
      shipBlockers: []
    });
    expect(JSON.stringify(parsed)).not.toMatch(/"title"|"category"/);
  });

  it("review stage mandates security-reviewer alongside spec- and code-reviewer", () => {
    const review = stageSchema("review");
    expect(review.mandatoryDelegations).toContain("spec-reviewer");
    expect(review.mandatoryDelegations).toContain("code-reviewer");
    expect(review.mandatoryDelegations).toContain("security-reviewer");
  });

  it("security-reviewer agent registry entry is mandatory", () => {
    const agent = CCLAW_AGENTS.find((a) => a.name === "security-reviewer");
    expect(agent).toBeDefined();
    expect(agent?.activation).toBe("mandatory");
    expect(agent?.description.toLowerCase()).toMatch(/mandatory|no-change/);
  });

  it("design template renders architecture diagram with clean triple-backtick fences", () => {
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(design).toContain("## Architecture Diagram");
    expect(design).not.toMatch(/\\`\\`\\`/);
    const diagramBlock = design.split("## Architecture Diagram")[1];
    expect(diagramBlock).toMatch(/\n```\n[\s\S]*?\n```\n/);
  });

  it("stage skills render explicit when-not-to-use guidance", () => {
    const review = stageSchema("review");
    expect(review.whenNotToUse.length).toBeGreaterThan(0);
    const markdown = stageSkillMarkdown("review");
    expect(markdown).toContain("## When Not to Use");
  });
});
