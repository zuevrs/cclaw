import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * Slimmed in v8.101 test-slim-down A4 from 6 single-skill its() to 2
 * packed wiring tests (registry + frontmatter contract; per-skill
 * anchors). Per-skill verification is consolidated into one packed
 * test so the cross-cutting "every skill has frontmatter" invariant
 * is verified alongside the per-skill contracts.
 */

describe("auto-trigger skills — registry + frontmatter contract", () => {
  it("WIRING — AUTO_TRIGGER_SKILLS ships at least the six core skills (plan-authoring, ac-discipline, refinement, parallel-build, review-discipline, tdd-and-verification); every skill body starts with `---\\n` frontmatter and carries name: + trigger: headers; conversation-language + anti-slop are both `always-on`", () => {
    const ids = AUTO_TRIGGER_SKILLS.map((skill) => skill.id);
    for (const expected of [
      "plan-authoring",
      "ac-discipline",
      "refinement",
      "parallel-build",
      "review-discipline",
      "tdd-and-verification"
    ]) {
      expect(ids).toContain(expected);
    }
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(skill.body.startsWith("---\n")).toBe(true);
      expect(skill.body).toMatch(/name:/u);
      expect(skill.body).toMatch(/trigger:/u);
    }
    const alwaysOn = AUTO_TRIGGER_SKILLS.filter((entry) => entry.triggers.includes("always-on")).map((entry) => entry.id);
    expect(alwaysOn).toContain("conversation-language");
    expect(alwaysOn).toContain("anti-slop");
  });
});

describe("auto-trigger skills — per-skill canonical anchors (ac-discipline + review-discipline + anti-slop)", () => {
  it("BEHAVIOR — ac-discipline names the v8.63+ AC-side contract (`verify(AC-N): passing`, dual-grep with `(SL-N):` for slice work); review-discipline names the Five Failure Modes; anti-slop is always-on and bans redundant verification, env shims (@ts-ignore, eslint-disable, process.env.NODE_ENV), and declares its `What this skill does NOT prevent` carve-out", () => {
    const ac = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "ac-discipline");
    expect(ac).toBeDefined();
    expect(ac!.body).toContain('git log --grep="verify(AC-N):"');
    expect(ac!.body).toContain('git log --grep="(SL-N):"');
    expect(ac!.body).toContain("verify(AC-N): passing");

    const review = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "review-discipline");
    expect(review).toBeDefined();
    for (const mode of [
      "Hallucinated actions",
      "Scope creep",
      "Cascading errors",
      "Context loss",
      "Tool misuse"
    ]) {
      expect(review!.body).toContain(mode);
    }

    const anti = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "anti-slop");
    expect(anti).toBeDefined();
    expect(anti!.triggers).toContain("always-on");
    expect(anti!.body).toContain("No redundant verification");
    expect(anti!.body).toContain("No environment shims");
    expect(anti!.body).toContain("@ts-ignore");
    expect(anti!.body).toContain("eslint-disable");
    expect(anti!.body).toContain("process.env.NODE_ENV");
    expect(anti!.body).toContain("What this skill does NOT prevent");
  });
});
