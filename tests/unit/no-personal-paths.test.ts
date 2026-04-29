import { describe, expect, it } from "vitest";
import { harnessIntegrationDocMarkdown } from "../../src/content/harness-doc.js";
import { usingCclawSkillMarkdown } from "../../src/content/meta-skill.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { FLOW_STAGES } from "../../src/types.js";

const PERSONAL_PATH_MARKER = "/Users/";

describe("generated markdown is path-neutral", () => {
  it("keeps scope and design skills free of personal absolute paths", () => {
    expect(stageSkillMarkdown("scope")).not.toContain(PERSONAL_PATH_MARKER);
    expect(stageSkillMarkdown("design")).not.toContain(PERSONAL_PATH_MARKER);
  });

  it("keeps every stage skill free of personal absolute paths", () => {
    for (const stage of FLOW_STAGES) {
      expect(
        stageSkillMarkdown(stage),
        `stage "${stage}" leaked a personal absolute path`
      ).not.toContain(PERSONAL_PATH_MARKER);
    }
  });

  it("keeps the meta skill and harness integration doc path-neutral", () => {
    expect(usingCclawSkillMarkdown()).not.toContain(PERSONAL_PATH_MARKER);
    expect(harnessIntegrationDocMarkdown()).not.toContain(PERSONAL_PATH_MARKER);
  });
});
