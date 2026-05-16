import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";

/**
 * v8.46 — Spec section in plan.md.
 *
 * The four-bullet `## Spec` section (Objective / Success / Out of scope /
 * Boundaries) captures the requirement-side contract on every plan.md the
 * orchestrator produces. AC alone do double duty as both requirements AND
 * pass/fail conditions; Spec splits the requirement half out into an
 * explicit, structured place so reviewer / critic / future agents can
 * tell whether the build matched the intent without rereading the Frame
 * paragraph.
 *
 * Mandatory on both strict (large-risky) and soft (small-medium) plans.
 * Inline (trivial) path has no plan.md, so no Spec.
 *
 * v8.62 unified flow: a single `architect` specialist authors the Spec
 * regardless of path. Lite-posture runs (small-medium) fill it from the
 * Frame paragraph; standard / strict postures (large-risky) expand it
 * during the Frame phase. The legacy ac-author-vs-design split is gone.
 *
 * No new reviewer axis is introduced — the existing correctness /
 * architecture / complexity-budget axes implicitly cover Spec compliance
 * (build doesn't match Objective => correctness finding; scope creep past
 * Out of scope => architecture / complexity-budget finding).
 */

const PLAN_TEMPLATE_STRICT = (() => {
  const t = ARTIFACT_TEMPLATES.find((tt) => tt.id === "plan");
  if (!t) throw new Error("plan template not found");
  return t.body;
})();

const PLAN_TEMPLATE_SOFT = (() => {
  const t = ARTIFACT_TEMPLATES.find((tt) => tt.id === "plan-soft");
  if (!t) throw new Error("plan-soft template not found");
  return t.body;
})();

const ARCHITECT_PROMPT = SPECIALIST_PROMPTS["architect"];

describe("v8.46 Spec section — PLAN_TEMPLATE (strict) carries `## Spec`", () => {
  it("AC-1 — PLAN_TEMPLATE contains a `## Spec` heading", () => {
    expect(PLAN_TEMPLATE_STRICT).toMatch(/^## Spec$/m);
  });

  it("AC-1 — PLAN_TEMPLATE Spec section names all four canonical bullets (Objective / Success / Out of scope / Boundaries)", () => {
    // Each bullet is `- **<Name>**:` per the template
    expect(PLAN_TEMPLATE_STRICT).toMatch(/\*\*Objective\*\*/);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/\*\*Success\*\*/);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/\*\*Out of scope\*\*/);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/\*\*Boundaries\*\*/);
  });

  it("AC-1 — PLAN_TEMPLATE Spec section sits ABOVE `## Acceptance Criteria`", () => {
    const specIdx = PLAN_TEMPLATE_STRICT.indexOf("## Spec");
    const acIdx = PLAN_TEMPLATE_STRICT.indexOf("## Acceptance Criteria");
    expect(specIdx).toBeGreaterThan(-1);
    expect(acIdx).toBeGreaterThan(-1);
    expect(specIdx).toBeLessThan(acIdx);
  });

  it("AC-1 — PLAN_TEMPLATE prose calls Spec mandatory and forbids `<TBD>` / empty values", () => {
    // Section's introductory prose must self-describe as mandatory; `none` / `n/a` ok, `<TBD>` not.
    expect(PLAN_TEMPLATE_STRICT).toMatch(/mandatory/i);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/<TBD>|none|n\/a/);
  });

  it("AC-1 — PLAN_TEMPLATE Spec prose names the v8.46 origin and the requirement-side contract framing", () => {
    expect(PLAN_TEMPLATE_STRICT).toMatch(/v8\.46/);
    // The Spec is described as the requirement-side contract that AC alone don't carry.
    expect(PLAN_TEMPLATE_STRICT).toMatch(/requirement.side|requirement\b/i);
  });
});

describe("v8.46 Spec section — PLAN_TEMPLATE_SOFT also carries `## Spec`", () => {
  it("AC-2 — PLAN_TEMPLATE_SOFT contains a `## Spec` heading (mandatory on every path that produces plan.md)", () => {
    expect(PLAN_TEMPLATE_SOFT).toMatch(/^## Spec$/m);
  });

  it("AC-2 — PLAN_TEMPLATE_SOFT Spec section names all four canonical bullets", () => {
    expect(PLAN_TEMPLATE_SOFT).toMatch(/\*\*Objective\*\*/);
    expect(PLAN_TEMPLATE_SOFT).toMatch(/\*\*Success\*\*/);
    expect(PLAN_TEMPLATE_SOFT).toMatch(/\*\*Out of scope\*\*/);
    expect(PLAN_TEMPLATE_SOFT).toMatch(/\*\*Boundaries\*\*/);
  });

  it("AC-2 — PLAN_TEMPLATE_SOFT Spec section sits ABOVE `## Testable conditions`", () => {
    const specIdx = PLAN_TEMPLATE_SOFT.indexOf("## Spec");
    const conditionsIdx = PLAN_TEMPLATE_SOFT.indexOf("## Testable conditions");
    expect(specIdx).toBeGreaterThan(-1);
    expect(conditionsIdx).toBeGreaterThan(-1);
    expect(specIdx).toBeLessThan(conditionsIdx);
  });
});

describe("v8.46 Spec section — architect authors Spec on every path (v8.62 unified flow collapses the ac-author / design split)", () => {
  it("AC-3 — architect prompt mentions the `## Spec` section it must author", () => {
    expect(ARCHITECT_PROMPT).toContain("## Spec");
  });

  it("AC-3 — architect prompt names all four Spec bullets the section requires", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Objective/);
    expect(ARCHITECT_PROMPT).toMatch(/Success/);
    expect(ARCHITECT_PROMPT).toMatch(/Out of scope/);
    expect(ARCHITECT_PROMPT).toMatch(/Boundaries/);
  });

  it("AC-3 — architect prompt declares the Spec section mandatory and warns against empty / TBD values", () => {
    expect(ARCHITECT_PROMPT).toMatch(/mandatory/i);
    expect(ARCHITECT_PROMPT).toMatch(/<TBD>|empty|none|n\/a/i);
  });

  it("AC-3 — architect prompt explains the posture-driven Spec depth (lite fills from Frame, strict expands during the Frame phase)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/(lite|standard|strict|posture|Frame)[\s\S]{0,300}Spec/i);
  });

  it("AC-3 — architect self-review checklist gates on the Spec section being present and filled", () => {
    const matches = ARCHITECT_PROMPT.match(/## Spec/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("AC-4 — architect prompt frames Spec vs NFR as complementary, not duplicative (intent vs quality)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/(complementary|not duplicative|intent.*scope|quality attribute)/i);
  });
});

describe("v8.46 Spec section — invariants the v8.46 brief explicitly requires", () => {
  it("AC-5 — no new reviewer axis is introduced (7-axis count stable; nfr-compliance gated as the 8th)", () => {
    const REVIEWER_PROMPT = SPECIALIST_PROMPTS["reviewer"];
    // The seven mainstream axes from v8.13 + the gated nfr-compliance from v8.25
    // are all still in the prompt. v8.46 does NOT add a new axis.
    for (const axis of [
      "correctness",
      "test-quality",
      "readability",
      "architecture",
      "complexity-budget",
      "security",
      "perf",
      "nfr-compliance"
    ]) {
      expect(REVIEWER_PROMPT).toMatch(new RegExp(axis));
    }
    // Confirm there is no `spec-compliance` axis — Spec is implicitly covered
    // by correctness / architecture / complexity-budget findings.
    expect(REVIEWER_PROMPT).not.toMatch(/^\| ?`?spec-compliance/m);
  });

  it("AC-5 — Spec frontmatter is NOT added (Spec is a body section only; no new schema fields)", () => {
    // The Spec section lives in the body, not in the YAML frontmatter. Frontmatter
    // should still parse cleanly without any `spec:` / `objective:` / `success:` keys.
    expect(PLAN_TEMPLATE_STRICT).not.toMatch(/^spec:/m);
    expect(PLAN_TEMPLATE_STRICT).not.toMatch(/^objective:/m);
    expect(PLAN_TEMPLATE_STRICT).not.toMatch(/^success_criteria:/m);
    expect(PLAN_TEMPLATE_STRICT).not.toMatch(/^boundaries:/m);
  });
});
