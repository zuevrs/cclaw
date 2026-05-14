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
 * - ac-author fills the Spec on small-medium (soft) plans.
 * - design Phase 2 (Frame) fills the Spec on large-risky (strict) plans.
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

const AC_AUTHOR_PROMPT = SPECIALIST_PROMPTS["ac-author"];
const DESIGN_PROMPT = SPECIALIST_PROMPTS["design"];

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

describe("v8.46 Spec section — ac-author authors Spec on small-medium path", () => {
  it("AC-3 — ac-author prompt mentions the `## Spec` section it must author", () => {
    expect(AC_AUTHOR_PROMPT).toContain("## Spec");
  });

  it("AC-3 — ac-author prompt names all four Spec bullets the section requires", () => {
    expect(AC_AUTHOR_PROMPT).toMatch(/Objective/);
    expect(AC_AUTHOR_PROMPT).toMatch(/Success/);
    expect(AC_AUTHOR_PROMPT).toMatch(/Out of scope/);
    expect(AC_AUTHOR_PROMPT).toMatch(/Boundaries/);
  });

  it("AC-3 — ac-author prompt declares the Spec section mandatory and warns against empty / TBD values", () => {
    // We look for the requirement language; the actual prose is the canonical reference.
    expect(AC_AUTHOR_PROMPT).toMatch(/mandatory/i);
    expect(AC_AUTHOR_PROMPT).toMatch(/<TBD>|empty|none|n\/a/i);
  });

  it("AC-3 — ac-author prompt explains the small-medium vs large-risky ownership split (ac-author vs design Phase 2)", () => {
    // The contract is: ac-author owns Spec on small-medium; design owns it on large-risky.
    expect(AC_AUTHOR_PROMPT).toMatch(/(small.medium|design Phase 2|large.risky)[\s\S]{0,200}Spec/i);
  });

  it("AC-3 — ac-author self-review checklist gates on the Spec section being present and filled", () => {
    // The checklist is the canonical authoring guard; finding the Spec inside it pins
    // the gate so a future refactor cannot silently drop the rule.
    const matches = AC_AUTHOR_PROMPT.match(/## Spec/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("v8.46 Spec section — design Phase 2 authors Spec on large-risky path", () => {
  it("AC-4 — design prompt mentions the `## Spec` section it must author in Phase 2", () => {
    expect(DESIGN_PROMPT).toContain("## Spec");
  });

  it("AC-4 — design prompt names all four Spec bullets the section requires", () => {
    expect(DESIGN_PROMPT).toMatch(/Objective/);
    expect(DESIGN_PROMPT).toMatch(/Success/);
    expect(DESIGN_PROMPT).toMatch(/Out of scope/);
    expect(DESIGN_PROMPT).toMatch(/Boundaries/);
  });

  it("AC-4 — design prompt declares the Spec section mandatory on large-risky plans", () => {
    expect(DESIGN_PROMPT).toMatch(/mandatory/i);
  });

  it("AC-4 — design prompt frames Spec vs NFR as complementary, not duplicative (intent vs quality)", () => {
    // The brief explicitly calls out that Spec captures intent + scope while NFR
    // captures quality attributes; they are NOT duplicates.
    expect(DESIGN_PROMPT).toMatch(/(complementary|not duplicative|intent.*scope|quality attribute)/i);
  });

  it("AC-4 — design self-review checklist gates on the Spec section being present and filled", () => {
    // The checklist is the canonical authoring guard; finding the Spec inside it pins
    // the gate so a future refactor cannot silently drop the rule.
    const matches = DESIGN_PROMPT.match(/## Spec/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
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
