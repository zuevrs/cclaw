import { describe, expect, it } from "vitest";
import { usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("stage skill size budgets", () => {
  it("keeps every stage skill under 350 lines", () => {
    for (const stage of FLOW_STAGES) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 350 lines (${lines})`
      ).toBeLessThanOrEqual(350);
    }
  });

  it("keeps the injected using-cclaw router concise", () => {
    const lines = usingCclawSkillMarkdown().split(/\r?\n/u).length;
    expect(lines, `using-cclaw exceeded 170 lines (${lines})`).toBeLessThanOrEqual(170);
  });
});
