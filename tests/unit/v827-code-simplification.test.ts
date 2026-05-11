import { describe, expect, it } from "vitest";

import { AUTO_TRIGGER_SKILLS, buildAutoTriggerBlock } from "../../src/content/skills.js";

/**
 * v8.27 — `code-simplification` skill import.
 *
 * Adapts addy osmani's `code-simplification` skill into cclaw conventions:
 * stage-windowed on `["build", "review"]`, integrated with
 * `tdd-and-verification`'s REFACTOR step, anti-rationalization table in
 * cclaw style, cross-references to existing cclaw skills, attribution
 * footnote preserved. The skill is registered in `AUTO_TRIGGER_SKILLS`
 * (bringing the count from 17 to 18 — the second additive skill since
 * the v8.16 merge collapsed 24 → 17, after the `cclaw-meta.md` on-disk
 * sidecar but before any other auto-trigger additions).
 *
 * These tripwires lock the v8.27 surface so a future refactor that
 * accidentally drops the skill, mis-stages it, or breaks the REFACTOR
 * cross-reference fails loudly.
 */

const findSkill = (id: string) => AUTO_TRIGGER_SKILLS.find((s) => s.id === id);

describe("v8.27 — code-simplification skill registered in AUTO_TRIGGER_SKILLS", () => {
  it("AC-1: AUTO_TRIGGER_SKILLS length is 20 (v8.26 baseline 17 + code-simplification in v8.27 + context-engineering + performance-optimization in v8.32)", () => {
    expect(AUTO_TRIGGER_SKILLS.length).toBe(20);
  });

  it("AC-1: a skill with id `code-simplification` exists in AUTO_TRIGGER_SKILLS", () => {
    const skill = findSkill("code-simplification");
    expect(skill).toBeDefined();
    expect(skill?.fileName).toBe("code-simplification.md");
  });

  it("AC-2: stages are exactly `[\"build\", \"review\"]` (no `always`, no other stages)", () => {
    const skill = findSkill("code-simplification");
    expect(skill?.stages).toEqual(["build", "review"]);
  });

  it("AC-2: triggers include the canonical refactor/review hooks", () => {
    const skill = findSkill("code-simplification");
    expect(skill?.triggers).toEqual(
      expect.arrayContaining([
        "stage:build",
        "specialist:slice-builder",
        "specialist:reviewer",
        "phase:refactor",
        "finding:complexity-budget",
        "finding:readability"
      ])
    );
  });

  it("AC-2: description names the addy-osmani provenance and the slot it fills", () => {
    const skill = findSkill("code-simplification");
    expect(skill?.description).toMatch(/addy|osmani/iu);
    expect(skill?.description).toMatch(/simplification/iu);
    expect(skill?.description).toMatch(/REFACTOR|refactor/u);
  });
});

describe("v8.27 — code-simplification body adapted to cclaw conventions (not verbatim copy)", () => {
  const body = findSkill("code-simplification")?.body ?? "";

  it("AC-3: frontmatter declares `name: code-simplification` and a cclaw-style `trigger:` line", () => {
    expect(body).toMatch(/^---\nname: code-simplification\n/u);
    expect(body).toMatch(/^trigger: .*REFACTOR/mu);
    expect(body).toMatch(/^trigger: .*fix-only/mu);
  });

  it("AC-3: body references `tdd-and-verification` (the parent skill it integrates with)", () => {
    expect(body).toMatch(/tdd-and-verification/u);
    expect(body).toMatch(/REFACTOR/u);
  });

  it("AC-3: body references `review-discipline` and the `complexity-budget` / `readability` axes", () => {
    expect(body).toMatch(/review-discipline/u);
    expect(body).toMatch(/complexity-budget/u);
    expect(body).toMatch(/readability/u);
  });

  it("AC-3: body references cclaw-specific concepts (touchSurfaces, fix-only, F-N findings)", () => {
    expect(body).toMatch(/touchSurfaces/u);
    expect(body).toMatch(/fix-only/u);
  });

  it("AC-3: body carries the five-principles structure (Preserve / Conventions / Clarity / Balance / Scope)", () => {
    expect(body).toMatch(/preserve behaviour/iu);
    expect(body).toMatch(/conventions/iu);
    expect(body).toMatch(/clarity/iu);
    expect(body).toMatch(/balance/iu);
    expect(body).toMatch(/scope/iu);
  });

  it("AC-3: body carries the four-step process (Chesterton → identify → incrementally → verify)", () => {
    expect(body).toMatch(/chesterton/iu);
    expect(body).toMatch(/incrementally|step 3/iu);
    expect(body).toMatch(/verify|step 4/iu);
  });

  it("AC-4: body carries cclaw-style sections (## When to use, ## Common rationalizations, ## Red flags, ## Verification)", () => {
    expect(body).toMatch(/^## When to use/mu);
    expect(body).toMatch(/^## Common rationalizations/mu);
    expect(body).toMatch(/^## Red flags/mu);
    expect(body).toMatch(/^## Verification/mu);
  });

  it("AC-4: attribution footnote preserves addy osmani provenance", () => {
    expect(body).toMatch(/addy/iu);
    expect(body).toMatch(/osmani|claude-plugins-official/iu);
    expect(body).toMatch(/Inspired by|adaptation/iu);
  });

  it("AC-4: body is NOT a verbatim copy of addy's source — cclaw adaptation markers present", () => {
    expect(body).toMatch(/cclaw/u);
    expect(body).toMatch(/--phase=refactor/u);
    expect(body).not.toMatch(/CLAUDE\.md/u);
  });
});

describe("v8.27 — tdd-and-verification REFACTOR step cross-references code-simplification", () => {
  const tddBody = findSkill("tdd-and-verification")?.body ?? "";

  it("AC-5: tdd-and-verification REFACTOR section names `code-simplification.md`", () => {
    expect(tddBody).toMatch(/code-simplification/u);
  });

  it("AC-5: the reference sits inside the REFACTOR step body (not buried at file end)", () => {
    const refactorIdx = tddBody.indexOf("### REFACTOR");
    const simpIdx = tddBody.indexOf("code-simplification");
    expect(refactorIdx).toBeGreaterThan(-1);
    expect(simpIdx).toBeGreaterThan(refactorIdx);
    expect(simpIdx - refactorIdx).toBeLessThan(2000);
  });
});

describe("v8.27 — install layer and stage-windowing wire the new skill correctly", () => {
  it("AC-6: code-simplification renders in the `build` stage block", () => {
    const block = buildAutoTriggerBlock("build");
    expect(block).toMatch(/code-simplification/u);
  });

  it("AC-6: code-simplification renders in the `review` stage block", () => {
    const block = buildAutoTriggerBlock("review");
    expect(block).toMatch(/code-simplification/u);
  });

  it("AC-6: code-simplification does NOT render in the `triage` stage block", () => {
    const block = buildAutoTriggerBlock("triage");
    expect(block).not.toMatch(/code-simplification/u);
  });

  it("AC-6: code-simplification does NOT render in the `plan` stage block", () => {
    const block = buildAutoTriggerBlock("plan");
    expect(block).not.toMatch(/code-simplification/u);
  });

  it("AC-6: code-simplification does NOT render in the `ship` stage block", () => {
    const block = buildAutoTriggerBlock("ship");
    expect(block).not.toMatch(/code-simplification/u);
  });

  it("AC-6: full block (no stage filter) includes code-simplification", () => {
    const block = buildAutoTriggerBlock();
    expect(block).toMatch(/code-simplification/u);
    // v8.32 grew the set from 18 to 20 (context-engineering + performance-optimization).
    expect(block).toMatch(/20 skills total/u);
  });
});

describe("v8.27 — anti-rationalization table follows cclaw shape (not addy's verbatim)", () => {
  const body = findSkill("code-simplification")?.body ?? "";

  it("AC-7: the rationalizations table uses cclaw's two-column `| rationalization | truth |` shape", () => {
    expect(body).toMatch(/\|\s*rationalization\s*\|\s*truth\s*\|/iu);
  });

  it("AC-7: rationalizations explicitly reference cclaw mechanics (--phase=refactor / touchSurfaces / fix-only / TDD cycle)", () => {
    const rationalSection = body.split("## Common rationalizations")[1]?.split("## Red flags")[0] ?? "";
    expect(rationalSection).toMatch(/--phase=refactor|TDD cycle|fix-only|touchSurfaces|REFACTOR/u);
  });
});
