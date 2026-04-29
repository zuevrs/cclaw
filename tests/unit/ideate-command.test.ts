import { describe, expect, it } from "vitest";
import { ideateCommandContract, ideateCommandSkillMarkdown, minimumDistinctIdeateFrames } from "../../src/content/ideate-command.js";
import { resolveIdeateFrames } from "../../src/content/ideate-frames.js";

describe("ideate command surfaces", () => {
  it("uses current knowledge schema terms in repo-grounded guidance", () => {
    const skill = ideateCommandSkillMarkdown();
    expect(skill).toContain("rule | pattern | lesson | compound");
    expect(skill).toContain("origin_run");
    expect(skill).toContain("trigger/action");
    expect(skill).not.toContain("type: \"heuristic\"");
    expect(skill).not.toContain("subject:");
  });

  it("renders default frame registry in command contract and skill", () => {
    const contract = ideateCommandContract();
    const skill = ideateCommandSkillMarkdown();
    for (const frame of resolveIdeateFrames()) {
      expect(contract).toContain(`${frame.label} (\`${frame.id}\`)`);
      expect(skill).toContain(`${frame.label} (\`${frame.id}\`)`);
    }
    expect(contract).toContain("Keep at least 4 distinct frame outputs");
    expect(skill).toContain("Require at least 4 distinct frames");
    expect(skill).toContain("repo-grounded scans require 4 distinct frames");
    expect(skill).toContain("Why now");
    expect(skill).toContain("Expected impact");
    expect(skill).toContain("Risk");
    expect(skill).toContain("Next /cc prompt");
  });

  it("supports frame overrides for narrower ideation passes", () => {
    const contract = ideateCommandContract({
      frameIds: ["pain-friction", "leverage", "pain-friction"]
    });
    const skill = ideateCommandSkillMarkdown({
      frameIds: ["pain-friction", "leverage"]
    });
    expect(contract).toContain("configured frames (2 total)");
    expect(contract).toContain("pain/friction (`pain-friction`)");
    expect(contract).toContain("leverage (`leverage`)");
    expect(contract).not.toContain("constraint-flip (`constraint-flip`)");
    expect(skill).toContain("Require at least 2 distinct frames");
    expect(skill).toContain("pain/friction, leverage");
  });

  it("uses a deterministic smaller frame minimum for narrow and non-repo modes", () => {
    expect(minimumDistinctIdeateFrames(6, "repo-grounded")).toBe(4);
    expect(minimumDistinctIdeateFrames(6, "narrow")).toBe(2);
    expect(minimumDistinctIdeateFrames(6, "elsewhere-software")).toBe(2);
    expect(minimumDistinctIdeateFrames(1, "elsewhere-non-software")).toBe(1);

    const contract = ideateCommandContract({ mode: "narrow" });
    const skill = ideateCommandSkillMarkdown({ mode: "elsewhere-software" });
    expect(contract).toContain("Keep at least 2 distinct frame outputs");
    expect(contract).toContain("narrow/non-repo = 2");
    expect(skill).toContain("Require at least 2 distinct frames");
    expect(skill).toContain("narrow, elsewhere-software, and elsewhere-non-software runs require 2");
  });
});
