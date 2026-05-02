import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INVESTIGATION_DISCIPLINE_BLOCK } from "../../src/content/templates.js";
import {
  INVESTIGATION_DISCIPLINE_STAGES,
  investigationDisciplineBlock,
  stageSkillMarkdown
} from "../../src/content/skills.js";
import type { FlowStage } from "../../src/types.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STAGES_DIR = join(REPO_ROOT, "src", "content", "stages");

describe("INVESTIGATION_DISCIPLINE_BLOCK constant", () => {
  it("exports a non-empty markdown block titled `## Investigation Discipline`", () => {
    expect(INVESTIGATION_DISCIPLINE_BLOCK.length).toBeGreaterThan(0);
    expect(INVESTIGATION_DISCIPLINE_BLOCK.startsWith("## Investigation Discipline")).toBe(true);
    expect(investigationDisciplineBlock()).toBe(INVESTIGATION_DISCIPLINE_BLOCK);
  });

  it("contains exactly 4 numbered ladder steps", () => {
    const ladderMatches = INVESTIGATION_DISCIPLINE_BLOCK.match(/^\d+\.\s+\*\*[^*]+\*\*/gmu) ?? [];
    expect(ladderMatches.length).toBe(4);
    expect(ladderMatches[0]).toMatch(/Search/u);
    expect(ladderMatches[1]).toMatch(/Graph/u);
    expect(ladderMatches[2]).toMatch(/Narrow read/u);
    expect(ladderMatches[3]).toMatch(/Draft/u);
  });

  it("contains exactly 3 stop triggers", () => {
    const stopSection = INVESTIGATION_DISCIPLINE_BLOCK.split(/\*\*Stop triggers\*\*/u)[1];
    expect(stopSection).toBeDefined();
    const bullets = (stopSection ?? "")
      .split(/\r?\n/u)
      .filter((line) => /^-\s+\S/u.test(line.trim()));
    expect(bullets.length).toBe(3);
  });

  it("calls out path-passing in delegations", () => {
    expect(INVESTIGATION_DISCIPLINE_BLOCK).toMatch(/Path-passing/u);
    expect(INVESTIGATION_DISCIPLINE_BLOCK).toMatch(/never the file body/u);
  });

  it("is not duplicated verbatim in any `src/content/stages/*.ts` (only referenced via shared block)", () => {
    const files = readdirSync(STAGES_DIR).filter((entry) => entry.endsWith(".ts"));
    const ladderSnippet = "Use this ladder before drafting or delegating";
    for (const file of files) {
      const body = readFileSync(join(STAGES_DIR, file), "utf8");
      expect(
        body.includes(ladderSnippet),
        `${file} should reference the shared block, not embed it`
      ).toBe(false);
    }
  });

  it("renders exactly once in each of the 7 investigation-stage skill files", () => {
    const ladderSnippet = "Use this ladder before drafting or delegating";
    const stages: FlowStage[] = [
      "brainstorm",
      "scope",
      "design",
      "spec",
      "plan",
      "tdd",
      "review"
    ];
    for (const stage of stages) {
      expect(INVESTIGATION_DISCIPLINE_STAGES.has(stage)).toBe(true);
      const md = stageSkillMarkdown(stage);
      const occurrences = md.split(ladderSnippet).length - 1;
      expect(occurrences, `${stage} skill should render the block exactly once`).toBe(1);
    }
  });

  it("does not render in the ship skill (ship consumes the upstream trace, does not produce one)", () => {
    expect(INVESTIGATION_DISCIPLINE_STAGES.has("ship")).toBe(false);
    const md = stageSkillMarkdown("ship");
    expect(md.includes("Use this ladder before drafting or delegating")).toBe(false);
  });
});
