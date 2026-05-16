import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";

/**
 * v8.25 — NFRs first-class in plan.md.
 *
 * Pre-v8.25 plan.md covered Frame / Approaches / Decisions / Pre-mortem /
 * Not Doing / AC table but had no structural slot for non-functional
 * requirements (performance budgets, compatibility, accessibility, security
 * baseline). They lived implicitly in Decisions and surfaced inconsistently
 * in review.
 *
 * v8.25 adds `## Non-functional` to PLAN_TEMPLATE (strict only — soft-mode
 * does not run design Phase 2 so NFRs do not apply there). The `design`
 * specialist's Phase 2 (Frame) learns to author the section when the slug
 * is product-grade or has irreversibility. The `reviewer` specialist gains
 * an eighth axis `nfr-compliance` that emits findings only when the
 * `## Non-functional` section in plan.md is non-empty (gated; backward
 * compat for legacy plan.md without the section).
 *
 * Each tripwire pins one invariant so a future refactor cannot silently
 * drop the NFR slot or weaken the gating rule.
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
const REVIEWER_PROMPT = SPECIALIST_PROMPTS["reviewer"];

describe("v8.25 NFRs first-class — PLAN_TEMPLATE (strict) gains `## Non-functional`", () => {
  it("AC-1 — PLAN_TEMPLATE contains a `## Non-functional` heading", () => {
    expect(PLAN_TEMPLATE_STRICT).toMatch(/^## Non-functional$/m);
  });

  it("AC-1 — PLAN_TEMPLATE NFR section names the four canonical NFR axes (performance / compatibility / accessibility / security)", () => {
    expect(PLAN_TEMPLATE_STRICT).toMatch(/performance:/);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/compatibility:/);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/accessibility:/);
    expect(PLAN_TEMPLATE_STRICT).toMatch(/security:/);
  });

  it("AC-1 — PLAN_TEMPLATE NFR section is explicitly optional / architect-Frame-authored (v8.62 — `design` Phase 2 absorbed into `architect`'s Frame phase)", () => {
    expect(
      PLAN_TEMPLATE_STRICT,
      "the section should be self-describing: when to fill (architect Frame / product-grade / irreversibility) and that 'none specified' is acceptable"
    ).toMatch(/optional|when.*tier|product-grade|irreversibility/i);
  });

  it("AC-1 — PLAN_TEMPLATE NFR section lives between Frame and Approaches (the conceptual home for NFRs)", () => {
    const frameIdx = PLAN_TEMPLATE_STRICT.indexOf("## Frame");
    const nfrIdx = PLAN_TEMPLATE_STRICT.indexOf("## Non-functional");
    const approachesIdx = PLAN_TEMPLATE_STRICT.indexOf("## Approaches");
    expect(frameIdx).toBeGreaterThan(-1);
    expect(nfrIdx).toBeGreaterThan(frameIdx);
    expect(approachesIdx).toBeGreaterThan(nfrIdx);
  });

  it("AC-1 — `none specified` (or equivalent) is a valid value per the template prose", () => {
    expect(PLAN_TEMPLATE_STRICT).toMatch(/none specified|none\b/);
  });
});

describe("v8.25 NFRs first-class — architect Frame phase authors NFR section (v8.62 unified flow absorbed `design`'s Phase 2 work into `architect`)", () => {
  it("AC-2 — architect.ts mentions NFR / Non-functional in its Frame-phase instructions", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Non-functional|NFR/);
  });

  it("AC-2 — architect.ts names the gating condition (product-grade tier or irreversibility)", () => {
    expect(
      ARCHITECT_PROMPT,
      "the architect needs a documented trigger so it knows when to fill the NFR section"
    ).toMatch(/product-grade|irreversibility|irreversible|tier/i);
  });

  it("AC-2 — architect.ts names `## Non-functional` as a section it writes to plan.md (Frame phase is the canonical author of the NFR section per the v8.25 contract; v8.62 absorbed the dead `design` specialist's Phase 2 ownership)", () => {
    expect(ARCHITECT_PROMPT).toContain("Non-functional");
  });
});

describe("v8.25 NFRs first-class — reviewer specialist gains `nfr-compliance` axis (gated)", () => {
  it("AC-3 — reviewer prompt lists `nfr-compliance` in its axis table / multi-axis review", () => {
    expect(REVIEWER_PROMPT).toMatch(/nfr-compliance|nfr.compliance/);
  });

  it("AC-3 — reviewer prompt names the gating rule: no findings when `## Non-functional` is empty / absent", () => {
    expect(
      REVIEWER_PROMPT,
      "the gating must be explicit so a reviewer reading this prompt knows not to fabricate NFR findings on legacy plans"
    ).toMatch(/(non-functional|nfr)[\s\S]{0,200}(empty|absent|missing|skip|gated|no.findings)/i);
  });

  it("AC-3 — reviewer prompt names what the `nfr-compliance` axis checks (AC vs NFR consistency)", () => {
    expect(
      REVIEWER_PROMPT,
      "the axis description should name what the reviewer looks for (NFR budgets vs AC behaviour, NFR coverage gaps)"
    ).toMatch(/(nfr|non-functional)[\s\S]{0,200}(budget|baseline|cover|comply|consist|compl)/i);
  });

  it("AC-3 — the v8.13 seven-axis preamble is preserved (no regression), with NFR added as an explicit eighth", () => {
    expect(REVIEWER_PROMPT).toMatch(/correctness/);
    expect(REVIEWER_PROMPT).toMatch(/test-quality/);
    expect(REVIEWER_PROMPT).toMatch(/readability/);
    expect(REVIEWER_PROMPT).toMatch(/architecture/);
    expect(REVIEWER_PROMPT).toMatch(/complexity-budget/);
    expect(REVIEWER_PROMPT).toMatch(/security/);
    expect(REVIEWER_PROMPT).toMatch(/perf/);
  });

  it("AC-3 — reviewer prompt names eighth axis count or eight-axis review explicitly (signals the upgrade)", () => {
    expect(
      REVIEWER_PROMPT,
      "the prompt should self-describe as eight-axis (or seven + optional eighth) so a reader can see the v8.25 evolution"
    ).toMatch(/eight|8.axis|v8\.25/i);
  });
});

describe("v8.25 NFRs first-class — backward compatibility", () => {
  it("AC-4 — PLAN_TEMPLATE_SOFT does NOT add `## Non-functional` (soft mode skips the architect's Frame-phase NFR authoring; v8.62 unified flow keeps the strict-only gating)", () => {
    expect(
      PLAN_TEMPLATE_SOFT,
      "NFRs are large-risky only — the architect's Frame phase is the canonical author and runs the NFR sub-step only on strict-mode flows"
    ).not.toMatch(/^## Non-functional$/m);
  });

  it("AC-4 — legacy plan.md without `## Non-functional` is acceptable: the section is documented as optional", () => {
    expect(
      PLAN_TEMPLATE_STRICT,
      "the section's introductory prose must call out that an empty / absent section is the default and acceptable"
    ).toMatch(/optional|empty.*ok|empty.*acceptable|when.*invoked|leave.*blank/i);
  });

  it("AC-4 — reviewer prompt explicitly tolerates legacy plan.md (no NFR section) without fabricating findings", () => {
    expect(
      REVIEWER_PROMPT,
      "legacy backward compat is part of the v8.25 contract — the reviewer must not synthesize NFR findings on plans that pre-date the section"
    ).toMatch(/(legacy|absent|missing|empty|backward.compat)[\s\S]{0,200}(no.findings|skip|n\/a)/i);
  });
});
