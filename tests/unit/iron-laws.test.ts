import { describe, expect, it } from "vitest";
import { IRON_LAWS, ironLawsMarkdown } from "../../src/content/iron-laws.js";

describe("iron-laws", () => {
  it("captures Karpathy's four principles in order", () => {
    expect(IRON_LAWS.map((law) => law.id)).toEqual([
      "think-before-coding",
      "simplicity-first",
      "surgical-changes",
      "goal-driven-execution"
    ]);
  });

  it("renders a markdown section with all four titles", () => {
    const md = ironLawsMarkdown();
    expect(md).toContain("## Iron Laws (Karpathy)");
    for (const law of IRON_LAWS) {
      expect(md).toContain(law.title);
    }
  });
});
