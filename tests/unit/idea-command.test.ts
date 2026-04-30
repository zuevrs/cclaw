import { describe, expect, it } from "vitest";
import { ideaCommandContract, ideaCommandSkillMarkdown, minimumDistinctIdeaFrames, resolveIdeaFrames } from "../../src/content/idea.js";

describe("idea command surfaces", () => {
  it("uses current knowledge schema terms in repo-grounded guidance", () => {
    const skill = ideaCommandSkillMarkdown();
    expect(skill).toContain("rule | pattern | lesson | compound");
    expect(skill).toContain("trigger/action");
    expect(skill).not.toContain("type: \"heuristic\"");
    expect(skill).not.toContain("subject:");
  });

  it("renders default frame registry in command contract and skill", () => {
    const contract = ideaCommandContract();
    const skill = ideaCommandSkillMarkdown();
    for (const frame of resolveIdeaFrames()) {
      expect(contract).toContain(`${frame.label} (\`${frame.id}\`)`);
      expect(skill).toContain(`${frame.label} (\`${frame.id}\`)`);
    }
    expect(contract).toContain("Keep at least 3 distinct frame outputs");
    expect(skill).toContain("Require at least 3 distinct frames");
    expect(skill).toContain("repo-grounded scans require 3 distinct frames");
    expect(skill).toContain("Why now");
    expect(skill).toContain("Expected impact");
    expect(skill).toContain("Risk");
    expect(skill).toContain("Next /cc prompt");
  });

  it("supports frame overrides for narrower ideation passes", () => {
    const contract = ideaCommandContract({
      frameIds: ["pain-friction", "assumption-break", "pain-friction"]
    });
    const skill = ideaCommandSkillMarkdown({
      frameIds: ["pain-friction", "assumption-break"]
    });
    expect(contract).toContain("configured frames (2 total)");
    expect(contract).toContain("pain/friction (`pain-friction`)");
    expect(contract).toContain("assumption-break (`assumption-break`)");
    expect(contract).not.toContain("cross-domain-analogy (`cross-domain-analogy`)");
    expect(skill).toContain("Require at least 2 distinct frames");
    expect(skill).toContain("pain/friction, assumption-break");
  });

  it("uses a deterministic smaller frame minimum for narrow and non-repo modes", () => {
    expect(minimumDistinctIdeaFrames(6, "repo-grounded")).toBe(3);
    expect(minimumDistinctIdeaFrames(6, "narrow")).toBe(2);
    expect(minimumDistinctIdeaFrames(6, "elsewhere-software")).toBe(2);
    expect(minimumDistinctIdeaFrames(1, "elsewhere-non-software")).toBe(1);

    const contract = ideaCommandContract({ mode: "narrow" });
    const skill = ideaCommandSkillMarkdown({ mode: "elsewhere-software" });
    expect(contract).toContain("Keep at least 2 distinct frame outputs");
    expect(contract).toContain("narrow/non-repo = 2");
    expect(skill).toContain("Require at least 2 distinct frames");
    expect(skill).toContain("narrow, elsewhere-software, and elsewhere-non-software runs require 2");
  });
});
