import { describe, expect, it } from "vitest";
import { usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("stage skill size budgets", () => {
  // Budget bumped from 350 → 400 to accommodate the mermaid `## Process`
  // state-machine diagram and platform-notes block introduced by the
  // stage-flow consolidation (fix #2 / #7). The extra ~15–25 lines per
  // stage replace a flat duplicated top-5 list with a structured graph
  // that the model reads as a map — net readability gain.
  it("keeps every stage skill under 400 lines", () => {
    for (const stage of FLOW_STAGES) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 400 lines (${lines})`
      ).toBeLessThanOrEqual(400);
    }
  });

  it("keeps the injected using-cclaw router concise", () => {
    const lines = usingCclawSkillMarkdown().split(/\r?\n/u).length;
    expect(lines, `using-cclaw exceeded 170 lines (${lines})`).toBeLessThanOrEqual(170);
  });
});
