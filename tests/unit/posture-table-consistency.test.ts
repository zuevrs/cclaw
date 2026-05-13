import { describe, expect, it } from "vitest";

import { AC_AUTHOR_PROMPT } from "../../src/content/specialist-prompts/ac-author.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { POSTURES, type Posture } from "../../src/types.js";

/**
 * v8.44 — posture-table byte-identical tripwire.
 *
 * The six posture values (`test-first`, `characterization-first`,
 * `tests-as-deliverable`, `refactor-only`, `docs-only`, `bootstrap`)
 * are referenced across four specialist prompts — each from a
 * different vantage:
 *
 * - **ac-author** picks the posture from a verb-heuristic table.
 * - **slice-builder** maps the posture to a commit ceremony.
 * - **reviewer** maps the posture to a git-log expectation.
 * - **critic** maps the posture to an escalation behaviour.
 *
 * The four prompts intentionally describe *different aspects* of each
 * posture, so we don't try to make their bullet bodies byte-identical
 * (that would force unrelated checks to drift in lock-step). Instead,
 * we pin a single **canonical enumeration line** that every prompt
 * must contain verbatim:
 *
 *     Postures (v8.36): `test-first` (default) | `characterization-first` |
 *     `tests-as-deliverable` | `refactor-only` | `docs-only` | `bootstrap`.
 *
 * If any specialist's posture vocabulary drifts (rename, reorder, drop,
 * forget to update one site after adding a value), this test fails
 * loudly with a diff. The brief's "byte-identical tripwire" is satisfied
 * on the load-bearing surface (the enumerated set + their canonical
 * spelling + ordering) without forcing the per-posture bodies into a
 * mechanical lockstep.
 *
 * The audit suggested extracting the posture table to a shared skill;
 * the user preferred byte-identical enforcement. This test is the
 * enforcement.
 */

/**
 * The canonical posture enumeration sentence. Every specialist prompt
 * that references postures must contain this exact substring. If you
 * are renaming a posture, adding a posture, or removing one, update
 * THIS constant and the four specialist prompts in lock-step — the
 * test will catch any prompt you forgot.
 *
 * The sentence intentionally tracks `POSTURES` (from `src/types.ts`)
 * order; if the type union changes ordering, the canonical string and
 * the assertion below must be updated together.
 */
const CANONICAL_POSTURE_LINE =
  "Postures: `test-first` (default) | `characterization-first` | `tests-as-deliverable` | `refactor-only` | `docs-only` | `bootstrap`.";

const POSTURE_SPECIALISTS: ReadonlyArray<{ id: string; body: string }> = [
  { id: "ac-author", body: AC_AUTHOR_PROMPT },
  { id: "slice-builder", body: SLICE_BUILDER_PROMPT },
  { id: "reviewer", body: REVIEWER_PROMPT },
  { id: "critic", body: CRITIC_PROMPT }
];

describe("v8.44 — posture-table byte-identical tripwire", () => {
  it("AC-1: each of the 4 specialist prompts contains the canonical posture enumeration verbatim", () => {
    for (const { id, body } of POSTURE_SPECIALISTS) {
      expect(
        body.includes(CANONICAL_POSTURE_LINE),
        `${id} prompt is missing the canonical posture enumeration line.\n` +
          `Expected substring:\n  ${CANONICAL_POSTURE_LINE}\n` +
          `If you intentionally changed the canonical enumeration (renamed a posture, reordered, added/removed one), ` +
          `update CANONICAL_POSTURE_LINE in this test AND all four specialist prompts in lock-step.`
      ).toBe(true);
    }
  });

  it("AC-2: the canonical line agrees with the POSTURES tuple from src/types.ts (no enumeration drift)", () => {
    const expectedPostures: ReadonlyArray<Posture> = [
      "test-first",
      "characterization-first",
      "tests-as-deliverable",
      "refactor-only",
      "docs-only",
      "bootstrap"
    ];
    expect(
      [...POSTURES],
      "POSTURES tuple in src/types.ts has drifted from the order pinned by the v8.44 tripwire. " +
        "If you intentionally reordered the type union, update both the tuple and CANONICAL_POSTURE_LINE."
    ).toEqual(expectedPostures);
    for (const posture of expectedPostures) {
      expect(
        CANONICAL_POSTURE_LINE.includes(`\`${posture}\``),
        `CANONICAL_POSTURE_LINE does not contain the posture value \`${posture}\` — update the constant.`
      ).toBe(true);
    }
  });

  it("AC-3: every specialist prompt mentions each individual posture value (no orphan postures)", () => {
    for (const { id, body } of POSTURE_SPECIALISTS) {
      for (const posture of POSTURES) {
        expect(
          body.includes(`\`${posture}\``),
          `${id} prompt does not mention the posture value \`${posture}\`. ` +
            `Every specialist that references postures must handle the full set; ` +
            `if a posture is intentionally out-of-scope for this specialist, document it inline before removing the mention.`
        ).toBe(true);
      }
    }
  });
});
