import { describe, expect, it } from "vitest";
import { adaptiveElicitationSkillMarkdown } from "../../src/content/skills-elicitation.js";

/**
 * Wave 22 (Phase A1): adaptive-elicitation SKILL.md must enforce a hard
 * floor, document anti-patterns, and remove the soft "never as hard stop"
 * language from earlier waves. This test pins those properties so future
 * edits cannot silently revert the tone change.
 */

describe("adaptive-elicitation SKILL.md (Wave 22 hardening)", () => {
  const skill = adaptiveElicitationSkillMarkdown();

  it("declares a HARD-GATE block", () => {
    expect(skill).toMatch(/##\s*HARD-GATE/u);
  });

  it("contains an explicit Hard floor instruction", () => {
    expect(skill).toMatch(/Hard floor/iu);
    expect(skill).toContain("stage-complete.mjs");
    expect(skill).toContain("Q&A Log");
  });

  it("includes a one-question-at-a-time mandate", () => {
    expect(skill).toMatch(/one[-\s]?at[-\s]?a[-\s]?time|one\s+question\s+per\s+turn|do\s+NOT\s+batch/iu);
  });

  it("documents BAD anti-patterns explicitly", () => {
    expect(skill).toMatch(/##\s*Anti-pattern/iu);
    expect(skill).toMatch(/BAD/u);
  });

  it("forbids running shell hash commands and pasting cclaw command lines", () => {
    expect(skill).toMatch(/shasum|sha256sum/iu);
    expect(skill).toMatch(/never\s+(?:run|paste|echo)/iu);
  });

  it("does NOT carry forward the old soft-stop language", () => {
    expect(skill).not.toMatch(/never\s+as\s+a?\s*hard\s*stop/iu);
    expect(skill).not.toMatch(/orientation,?\s+never\s+as\s+a?\s*hard\s*stop/iu);
  });

  it("references stop-signal escape hatch (RU/EN)", () => {
    expect(skill).toMatch(/stop[-\s]?signal/iu);
    expect(skill).toMatch(/достаточно|хватит|давай\s+драфт/iu);
  });
});
