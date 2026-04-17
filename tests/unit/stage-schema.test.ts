import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { lintArtifact } from "../../src/artifact-linter.js";
import { CCLAW_AGENTS } from "../../src/content/core-agents.js";
import { stageExamples, stageExamplesReferenceMarkdown } from "../../src/content/examples.js";
import { stageSchema } from "../../src/content/stage-schema.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { enhancedAgentBody } from "../../src/content/subagents.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/templates.js";
import { createTempProject } from "../helpers/index.js";

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

  it("review stage mandates reviewer and security-reviewer", () => {
    const review = stageSchema("review");
    expect(review.mandatoryDelegations).toContain("reviewer");
    expect(review.mandatoryDelegations).toContain("security-reviewer");
  });

  it("security-reviewer agent registry entry is mandatory", () => {
    const agent = CCLAW_AGENTS.find((a) => a.name === "security-reviewer");
    expect(agent).toBeDefined();
    expect(agent?.activation).toBe("mandatory");
    expect(agent?.description.toLowerCase()).toMatch(/mandatory|no-change/);
  });

  it("agent registry uses the core-5 roster", () => {
    expect(CCLAW_AGENTS.map((agent) => agent.name).sort()).toEqual([
      "doc-updater",
      "planner",
      "reviewer",
      "security-reviewer",
      "test-author"
    ]);
  });

  it("design skill renders research playbooks instead of research personas", () => {
    const design = stageSchema("design");
    expect(design.researchPlaybooks).toEqual([
      "research/framework-docs-lookup.md",
      "research/best-practices-lookup.md"
    ]);
    const markdown = stageSkillMarkdown("design");
    expect(markdown).toContain("## Research Playbooks");
    expect(markdown).toContain(".cclaw/skills/research/framework-docs-lookup.md");
    expect(markdown).toContain(".cclaw/skills/research/best-practices-lookup.md");
    expect(markdown).not.toContain("framework-docs-researcher");
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

  it("brainstorm example is a valid artifact when copy-pasted verbatim", async () => {
    const inlinePointer = stageExamples("brainstorm");
    expect(inlinePointer).toContain(".cclaw/references/stages/brainstorm-examples.md");

    const reference = stageExamplesReferenceMarkdown("brainstorm");
    expect(reference, "stage examples reference should exist").toBeTruthy();
    const fenceMatch = /```markdown\n([\s\S]+?)\n```/u.exec(reference!);
    expect(fenceMatch, "example should be wrapped in a markdown fence").toBeTruthy();
    const body = fenceMatch![1]!;
    expect(body).toMatch(/^## Context/);

    const root = await createTempProject("examples-brainstorm");
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      `# Brainstorm Artifact\n\n${body}\n`,
      "utf8"
    );
    const result = await lintArtifact(root, "brainstorm");
    const failed = result.findings.filter((f) => f.required && !f.found);
    expect(failed.map((f) => f.section)).toEqual([]);
  });
});
