import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

/**
 * v8.83-token-axes — gated reviewer axes lifted to companion skills.
 * Slimmed in v8.99 test-slim-down A2 to one WIRING + one BEHAVIOR + one
 * SECTION CONTRACT test.
 */

const REVIEWER_AXIS_SKILL_IDS = [
  "reviewer-axis-qa-evidence",
  "reviewer-axis-design-quality",
  "reviewer-axis-security",
  "reviewer-axis-nfr-compliance",
  "reviewer-axis-edit-discipline"
] as const;

describe("v8.83-token-axes — companion-skill wiring", () => {
  it("WIRING — all five reviewer-axis-* skills are registered with stages=['review'] + gate predicate + non-trivial body + fileName matches id, and each gate predicate fires on its canonical envelope flag and stays closed on empty / false envelopes", () => {
    const find = (id: (typeof REVIEWER_AXIS_SKILL_IDS)[number]) =>
      AUTO_TRIGGER_SKILLS.find((s) => s.id === id)!;

    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === id);
      expect(skill, `expected AUTO_TRIGGER_SKILLS to register \`${id}\``).toBeDefined();
      expect(skill!.stages).toEqual(["review"]);
      expect(typeof skill!.gate).toBe("function");
      expect(skill!.body.length).toBeGreaterThan(500);
      expect(skill!.fileName).toBe(`${id}.md`);
      expect(skill!.body).toContain(`# Skill: ${id}`);
    }

    // canonical envelope flag wiring per axis
    expect(find("reviewer-axis-qa-evidence").gate!({ walkQaEvidenceAxis: true })).toBe(true);
    expect(find("reviewer-axis-qa-evidence").gate!({})).toBe(false);
    expect(find("reviewer-axis-design-quality").gate!({ walkDesignQualityAxis: true })).toBe(true);
    expect(find("reviewer-axis-design-quality").gate!({})).toBe(false);
    expect(find("reviewer-axis-security").gate!({ securityFlag: true })).toBe(true);
    expect(find("reviewer-axis-security").gate!({})).toBe(false);
    expect(find("reviewer-axis-nfr-compliance").gate!({ planHasNonFunctional: true })).toBe(true);
    expect(find("reviewer-axis-nfr-compliance").gate!({})).toBe(false);
    expect(find("reviewer-axis-edit-discipline").gate!({ editDisciplineActive: true })).toBe(true);
    expect(find("reviewer-axis-edit-discipline").gate!({})).toBe(false);
  });
});

describe("v8.83-token-axes — buildAutoTriggerBlock gate-filters the five reviewer-axis skills", () => {
  it("BEHAVIOR — buildAutoTriggerBlock('review') (no envelope) is legacy-bypass and emits all 5 axes, ('review', {}) emits ZERO of them, ('review', {all flags set}) emits all 5, and ('review', {one flag set}) emits ONLY that one — non-gated review-stage skills (review-discipline, anti-slop default-on) are unaffected", () => {
    // legacy (no envelope) — all 5 emitted
    const legacy = buildAutoTriggerBlock("review");
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      expect(legacy, `legacy bypass must emit ${id}`).toContain(id);
    }

    // empty envelope — zero
    const empty = buildAutoTriggerBlock("review", {});
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      expect(empty, `empty envelope must filter ${id} out`).not.toContain(id);
    }

    // all flags set — all 5 emitted
    const allFlags: GateEnvelope = {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true
    };
    const allBlock = buildAutoTriggerBlock("review", allFlags);
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      expect(allBlock).toContain(id);
    }

    // selective: only qa-evidence
    const onlyQa = buildAutoTriggerBlock("review", { walkQaEvidenceAxis: true });
    expect(onlyQa).toContain("reviewer-axis-qa-evidence");
    expect(onlyQa).not.toContain("reviewer-axis-design-quality");
    expect(onlyQa).not.toContain("reviewer-axis-security");
    expect(onlyQa).not.toContain("reviewer-axis-nfr-compliance");
    expect(onlyQa).not.toContain("reviewer-axis-edit-discipline");

    // non-gated stage skills are unaffected
    expect(legacy).toContain("review-discipline");
    expect(empty).toContain("review-discipline");
    expect(empty).toContain("anti-slop"); // default-on v8.86 axis still rides
  });
});

describe("v8.83-token-axes — reviewer.ts carries 5-line stubs (heavy body lifted) + stub pointers", () => {
  it("SECTION CONTRACT — reviewer.ts carries an axis-stub heading for each of the 5 axes pointing at the companion skill id, and the lifted axis body phrases NO LONGER appear in reviewer.ts (no silent re-inline)", () => {
    const stubs: Array<{ heading: RegExp; pointerSkillId: string }> = [
      { heading: /^###\s+Edit-discipline axis/m, pointerSkillId: "reviewer-axis-edit-discipline" },
      { heading: /^###\s+qa-evidence axis/m, pointerSkillId: "reviewer-axis-qa-evidence" },
      { heading: /^###\s+Security axis/m, pointerSkillId: "reviewer-axis-security" },
      { heading: /^###\s+nfr-compliance axis/m, pointerSkillId: "reviewer-axis-nfr-compliance" },
      { heading: /^###\s+Design-quality axis/m, pointerSkillId: "reviewer-axis-design-quality" }
    ];
    for (const { heading, pointerSkillId } of stubs) {
      expect(heading.test(REVIEWER_PROMPT), `missing stub heading for ${pointerSkillId}`).toBe(true);
      expect(REVIEWER_PROMPT).toContain(pointerSkillId);
    }

    // Lifted body phrases must NOT live in reviewer.ts (no re-inline)
    const liftedPhrases: string[] = [
      "But the new file was just a helper, doesn't count toward the slice's Surface.",
      "But the AC was so small, a Playwright spec is overkill — manual was fine.",
      "Mark all five threat-model items as `n/a` with one-line justification each",
      "NFR authoring is an architect Frame-phase decision, not a reviewer responsibility",
      "It's a small diff — design quality doesn't matter at this scale."
    ];
    for (const phrase of liftedPhrases) {
      expect(
        REVIEWER_PROMPT,
        `lifted axis body re-inlined into reviewer.ts: "${phrase.slice(0, 60)}"`
      ).not.toContain(phrase);
    }
  });
});
