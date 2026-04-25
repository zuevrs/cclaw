import { describe, expect, it } from "vitest";
import { usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("stage skill size budgets", () => {
  // Keep stage skills compact enough to scan while preserving the process map,
  // gate/evidence lists, artifact validation, and closeout instructions.
  it("keeps every stage skill under 360 lines", () => {
    for (const stage of FLOW_STAGES) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 360 lines (${lines})`
      ).toBeLessThanOrEqual(360);
    }
  });

  it("keeps the injected using-cclaw router concise", () => {
    const lines = usingCclawSkillMarkdown().split(/\r?\n/u).length;
    expect(lines, `using-cclaw exceeded 170 lines (${lines})`).toBeLessThanOrEqual(170);
  });
});
