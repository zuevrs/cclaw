import { describe, expect, it } from "vitest";

import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";

/**
 * v8.24 — two-stage reviewer default on large-risky. v8.13 introduced the
 * two-pass loop (spec → code-quality) but gated it behind
 * `config.reviewerTwoPass: true` OR `(triage.complexity == "large-risky" &&
 * security_flag: true)`. v8.20's finding-dedup makes the cost cheap; the
 * audit (superpowers reference) recommended two-pass as the default on every
 * large-risky slug, with `security_flag` no longer required to trigger it.
 *
 * v8.24 changes the AND to OR (effectively: just `large-risky` triggers
 * two-pass; `security_flag: true` alone still triggers it; `config.
 * reviewerTwoPass: true` still triggers it explicitly; `config.
 * reviewerTwoPass: false` is now the documented opt-out for users who want
 * single-pass even on large-risky).
 *
 * The two-pass mechanics (spec → spec-clear → code-quality, skip Pass 2 on
 * spec-block / spec-warn) are unchanged. Dedup (v8.20) still applies
 * per-iteration — the dedup key is (axis, surface, one-liner); axes between
 * Pass 1 (correctness, test-quality) and Pass 2 (readability, architecture,
 * complexity-budget, perf) are disjoint by construction, so there is no
 * cross-pass overlap to dedup.
 */

const TWO_REVIEWER_HEADING = "Two-reviewer per-task loop (T3-3, obra pattern; v8.13)";

const SHIP_GATE_BODY = (() => {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === "handoff-gates");
  if (!r) throw new Error("handoff-gates runbook not found (v8.54 merged ship-gate + self-review-gate)");
  return r.body;
})();

const REVIEWER_PROMPT = SPECIALIST_PROMPTS["reviewer"];

describe("v8.24 two-stage reviewer default — gate changes (AND → OR)", () => {
  it("AC-1 — large-risky alone triggers two-pass (no `security_flag` requirement)", () => {
    expect(START_COMMAND_BODY).toContain(TWO_REVIEWER_HEADING);
    expect(
      START_COMMAND_BODY,
      "v8.24: the gate should name large-risky as a sufficient (not necessary-with-security_flag) trigger"
    ).toMatch(/triage\.complexity == "large-risky"[\s\S]{0,200}(default|always|alone|every|automatic)/i);
  });

  it("AC-1 — the gate no longer requires `security_flag: true` AS WELL AS large-risky", () => {
    expect(
      START_COMMAND_BODY,
      "the legacy v8.13 gate said `large-risky AND security_flag` — v8.24 weakens this to OR. The body should not still describe the AND as the auto-trigger contract."
    ).not.toMatch(/large-risky.{0,40}AND[\s\S]{0,40}security_flag.*highest-risk band/i);
  });

  it("AC-1 — `security_flag: true` alone still triggers two-pass (any complexity)", () => {
    expect(
      START_COMMAND_BODY,
      "security_flag-only paths (small-medium + security_flag) should still escalate to two-pass"
    ).toMatch(/security_flag[\s\S]{0,200}two-pass|two-pass[\s\S]{0,200}security_flag/i);
  });

  it("AC-1 — `config.reviewerTwoPass: false` is the documented opt-out for large-risky", () => {
    expect(
      START_COMMAND_BODY,
      "users who want single-pass even on large-risky must have a documented escape hatch"
    ).toMatch(/config\.reviewerTwoPass:?\s*false[\s\S]{0,200}(single|opt[\s-]?out|force|override)/i);
  });
});

describe("v8.24 two-stage reviewer default — backward compatibility", () => {
  it("AC-2 — `config.reviewerTwoPass: true` remains the explicit-opt-in path (small/medium can still force two-pass)", () => {
    expect(START_COMMAND_BODY).toMatch(/config\.reviewerTwoPass:?\s*true/);
  });

  it("AC-2 — small-medium without `security_flag` and without explicit config remains single-pass (the default v8.12 path)", () => {
    expect(
      START_COMMAND_BODY,
      "the body should still name single-pass as the default for the typical small-medium path"
    ).toMatch(/single-pass[\s\S]{0,200}(small|default|v8\.12)/i);
  });

  it("AC-2 — body explicitly migrates the v8.13 → v8.24 default-shift contract", () => {
    expect(
      START_COMMAND_BODY,
      "the v8.24 paragraph should name itself so a future maintainer can trace the default-shift back to a slug"
    ).toMatch(/v8\.24/);
  });
});

describe("v8.24 two-stage reviewer default — two-pass mechanics unchanged", () => {
  it("AC-3 — Pass 1 (spec-review) still names spec-clear / spec-block / spec-warn decisions", () => {
    expect(START_COMMAND_BODY).toMatch(/spec-clear/);
    expect(START_COMMAND_BODY).toMatch(/spec-block/);
    expect(START_COMMAND_BODY).toMatch(/spec-warn/);
  });

  it("AC-3 — Pass 2 (code-quality-review) still names quality-clear / quality-block / quality-warn decisions", () => {
    expect(START_COMMAND_BODY).toMatch(/quality-clear/);
    expect(START_COMMAND_BODY).toMatch(/quality-block/);
    expect(START_COMMAND_BODY).toMatch(/quality-warn/);
  });

  it("AC-3 — Pass 2 still runs only when Pass 1 returned spec-clear (spec-block/spec-warn skips Pass 2)", () => {
    expect(START_COMMAND_BODY).toMatch(/Pass 2 runs only when Pass 1 returned `spec-clear`/);
    expect(START_COMMAND_BODY).toMatch(/spec-block.*skips Pass 2|spec-block.*spec-warn.*skip/su);
  });

  it("AC-3 — pass-1 axis split (correctness + test-quality only) is preserved", () => {
    expect(START_COMMAND_BODY).toMatch(/correctness \+ test-quality findings only/);
  });

  it("AC-3 — pass-2 axis split (readability + architecture + complexity-budget + perf only) is preserved", () => {
    expect(START_COMMAND_BODY).toMatch(/readability \+ architecture \+ complexity-budget \+ perf/);
  });
});

describe("v8.24 two-stage reviewer default — v8.20 dedup invariants preserved", () => {
  it("AC-4 — reviewer specialist prompt still names finding-dedup as the within-iteration rule (v8.20 invariant)", () => {
    expect(REVIEWER_PROMPT).toMatch(/dedup/i);
    expect(REVIEWER_PROMPT).toMatch(/within an iteration/i);
  });

  it("AC-4 — body / runbooks do not introduce a cross-pass dedup that would collapse legitimate findings", () => {
    expect(
      START_COMMAND_BODY,
      "Pass 1 and Pass 2 have disjoint axes by construction; the v8.24 default-shift must NOT introduce a cross-pass dedup that would mask legitimate quality findings under spec-review noise"
    ).not.toMatch(/cross-pass dedup|merge findings across passes/i);
  });
});

describe("v8.24 two-stage reviewer default — ship-gate runbook is unaffected", () => {
  it("AC-5 — ship-gate runbook still describes parallel ship reviewers (separate from per-task two-pass)", () => {
    expect(
      SHIP_GATE_BODY,
      "ship-gate fan-out (release + adversarial + security reviewers) is separate from the per-task two-pass; v8.24 only changes the per-task trigger"
    ).toMatch(/release|adversarial|fan[\s-]?out/i);
  });
});
