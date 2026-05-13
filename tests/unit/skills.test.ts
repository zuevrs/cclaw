import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

describe("auto-trigger skills", () => {
  it("ships at least the six core skills", () => {
    const ids = AUTO_TRIGGER_SKILLS.map((skill) => skill.id);
    for (const expected of ["plan-authoring", "ac-discipline", "refinement", "parallel-build", "review-discipline", "tdd-and-verification"]) {
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

  it("ac-traceability names the v8.40 prompt-only commit-prefix contract (no commit-helper)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "ac-discipline");
    expect(skill?.body).toContain('git log --grep="(AC-N):"');
    expect(skill?.body).toContain("red(AC-");
    expect(skill?.body).toContain("green(AC-");
    expect(skill?.body).not.toContain("commit-helper");
  });

  it("review-loop names the Five Failure Modes", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-discipline");
    for (const mode of ["Hallucinated actions", "Scope creep", "Cascading errors", "Context loss", "Tool misuse"]) {
      expect(skill?.body).toContain(mode);
    }
  });

  it("anti-slop skill is shipped, always-on, and bans redundant verification + env shims", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "anti-slop");
    expect(skill).toBeDefined();
    expect(skill?.triggers).toContain("always-on");
    expect(skill?.body).toContain("No redundant verification");
    expect(skill?.body).toContain("No environment shims");
    expect(skill?.body).toContain("@ts-ignore");
    expect(skill?.body).toContain("eslint-disable");
    expect(skill?.body).toContain("process.env.NODE_ENV");
    expect(skill?.body).toContain("What this skill does NOT prevent");
  });

  it("conversation-language and anti-slop are both always-on", () => {
    const alwaysOn = AUTO_TRIGGER_SKILLS.filter((entry) => entry.triggers.includes("always-on")).map((entry) => entry.id);
    expect(alwaysOn).toContain("conversation-language");
    expect(alwaysOn).toContain("anti-slop");
  });
});
