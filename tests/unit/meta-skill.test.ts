import { describe, expect, it } from "vitest";
import { META_SKILL_GENERATED_HELPER_SKILLS, usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";

describe("using-cclaw meta-skill", () => {
  it("keeps generated helper inventory sourced from existing helper names", () => {
    const markdown = usingCclawSkillMarkdown();
    for (const helperName of META_SKILL_GENERATED_HELPER_SKILLS) {
      expect(markdown).toContain(`\`${helperName}\``);
    }
  });
});
