import { describe, expect, it } from "vitest";
import { startCommandContract, startCommandSkillMarkdown } from "../../src/content/start-command.js";

describe("start command contract", () => {
  it("requires discoveryMode normalization and vague-prompt empty-repo guardrail", () => {
    const contract = startCommandContract();
    expect(contract).toContain("Normalize the user's answer before calling the start helper");
    expect(contract).toContain("re-ask the same question once");
    expect(contract).toContain("at most 12 words");
    expect(contract).toContain("explicit confirmation before defaulting to");
    expect(contract).toContain("repoSignals");

    const skill = startCommandSkillMarkdown();
    expect(skill).toContain("Normalize the answer");
    expect(skill).toContain("at most 12 words");
  });
});
