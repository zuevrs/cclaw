import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

describe("auto-trigger skills", () => {
  it("ships at least the six core skills", () => {
    const ids = AUTO_TRIGGER_SKILLS.map((skill) => skill.id);
    for (const expected of ["plan-authoring", "ac-traceability", "refinement", "parallel-build", "security-review", "review-loop"]) {
      expect(ids).toContain(expected);
    }
  });

  it("every skill body contains a frontmatter-style trigger header", () => {
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(skill.body.startsWith("---\n")).toBe(true);
      expect(skill.body).toMatch(/name:/u);
      expect(skill.body).toMatch(/trigger:/u);
    }
  });

  it("ac-traceability mentions commit-helper.mjs explicitly", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "ac-traceability");
    expect(skill?.body).toContain("commit-helper.mjs");
  });

  it("review-loop names the Five Failure Modes", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-loop");
    for (const mode of ["Hallucinated actions", "Scope creep", "Cascading errors", "Context loss", "Tool misuse"]) {
      expect(skill?.body).toContain(mode);
    }
  });
});
