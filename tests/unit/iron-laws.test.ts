import { describe, expect, it } from "vitest";
import { IRON_LAWS, ironLawsMarkdown } from "../../src/content/iron-laws.js";

describe("iron-laws", () => {
  it("captures Karpathy's four principles plus the cclaw v8 TDD rule, in order", () => {
    expect(IRON_LAWS.map((law) => law.id)).toEqual([
      "think-before-coding",
      "simplicity-first",
      "surgical-changes",
      "goal-driven-execution",
      "red-before-green"
    ]);
  });

  it("renders a markdown section with every title", () => {
    const md = ironLawsMarkdown();
    expect(md).toContain("## Iron Laws (Karpathy)");
    for (const law of IRON_LAWS) {
      expect(md).toContain(law.title);
    }
  });

  it("includes the no-production-without-failing-test rule", () => {
    const law = IRON_LAWS.find((entry) => entry.id === "red-before-green");
    expect(law).toBeDefined();
    expect(law!.description).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(law!.description).toMatch(/failing test|RED failure is the spec/iu);
  });
});
