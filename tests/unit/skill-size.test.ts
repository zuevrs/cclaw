import { describe, expect, it } from "vitest";
import { COMMAND_FILE_ORDER } from "../../src/constants.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";

describe("stage skill size budgets", () => {
  it("keeps every stage skill under 350 lines", () => {
    for (const stage of COMMAND_FILE_ORDER) {
      const markdown = stageSkillMarkdown(stage);
      const lines = markdown.split(/\r?\n/u).length;
      expect(
        lines,
        `stage "${stage}" exceeded 350 lines (${lines})`
      ).toBeLessThanOrEqual(350);
    }
  });
});
