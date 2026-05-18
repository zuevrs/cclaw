import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CRITIC_PROMPT,
  INVESTIGATOR_PROMPT,
  REVIEWER_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

/**
 * v8.83 docs drift cleanup + investigator axis bug fix.
 *
 * This file is a tripwire suite: each test pins one of the count-row /
 * axis-name claims the v8.83 cleanup corrected so the same drift cannot
 * silently reopen next arc. The shape mirrors prior tripwire suites
 * (`v8XX-cleanup`, `v8XX-investigator-v2`, etc.) — short asserts, no
 * scaffolding, one expectation per concern.
 *
 *   1. Investigator's Phase 5 post-mortem axis list (lines 284-285 of
 *      `investigator.ts`) matches the reviewer's canonical 11 axes
 *      string-for-string.
 *   2. README.md no longer contains the stale pre-v8.85.1 count strings.
 *   3. README.md contains the corrected post-v8.85.1 count strings.
 *   4. start-command.ts no longer contains the stale `eight flow
 *      specialists` / `five-field` count strings.
 *   5. critic.ts no longer contains the stale `reviewer's eight axes`
 *      string.
 *
 * Escalation rule (from the v8.83-docs-fix spec): if any of these
 * tripwires reveal a deeper count discrepancy requiring a code (not
 * docs) change, stop and surface — the suite is intentionally narrow.
 */
describe("v8.83 docs drift cleanup + investigator axis fix", () => {
  describe("Tripwire 1: investigator.ts axis names match reviewer.ts canonical 11-axis list", () => {
    const canonicalAxes = [
      "correctness",
      "readability",
      "architecture",
      "security",
      "perf",
      "test-quality",
      "complexity-budget",
      "edit-discipline",
      "qa-evidence",
      "nfr-compliance",
      "design-quality"
    ];

    it("INVESTIGATOR_PROMPT post-mortem axis listing names all 11 canonical axes", () => {
      for (const axis of canonicalAxes) {
        expect(
          INVESTIGATOR_PROMPT,
          `investigator.ts post-mortem axis listing missing canonical axis \`${axis}\``
        ).toContain(`\`${axis}\``);
      }
    });

    it("INVESTIGATOR_PROMPT does NOT mention pre-v8.83 fabricated axis names", () => {
      const fabricated = [
        "`code-quality`",
        "`tests`",
        "`risk`",
        "`acceptance`",
        "`coupling`",
        "`performance`",
        "`error-discipline`",
        "<11th>"
      ];
      for (const stale of fabricated) {
        expect(
          INVESTIGATOR_PROMPT,
          `investigator.ts still contains fabricated axis name \`${stale}\``
        ).not.toContain(stale);
      }
    });

    it("REVIEWER_PROMPT contains all 11 canonical axes (sanity cross-check)", () => {
      for (const axis of canonicalAxes) {
        expect(
          REVIEWER_PROMPT,
          `reviewer.ts canonical surface missing axis \`${axis}\``
        ).toContain(`\`${axis}\``);
      }
    });
  });

  describe("Tripwire 2: README.md does NOT contain stale pre-v8.85.1 count strings", () => {
    const stale = [
      "8 sub-agents",
      "5 research-only lens",
      "10 reviewer axes",
      "ten-axis",
      "25 skills",
      "13 runbooks"
    ];

    for (const needle of stale) {
      it(`README.md does not contain stale \`${needle}\``, () => {
        expect(README).not.toContain(needle);
      });
    }
  });

  describe("Tripwire 3: README.md DOES contain corrected post-v8.85.1 count strings", () => {
    it("README.md contains `10 sub-agents` OR `10 specialist contracts`", () => {
      const hasSubAgents = README.includes("10 sub-agents");
      const hasContracts = README.includes("10 specialist contracts");
      expect(hasSubAgents || hasContracts).toBe(true);
    });

    it("README.md contains `6 research-only lens` OR `six lenses`", () => {
      const hasLens = README.includes("6 research-only lens");
      const hasSix = README.includes("six lenses");
      expect(hasLens || hasSix).toBe(true);
    });

    it("README.md contains `11 axes` OR `eleven-axis`", () => {
      const hasEleven = README.includes("11 axes");
      const hasElevenAxis = README.includes("eleven-axis");
      expect(hasEleven || hasElevenAxis).toBe(true);
    });

    it("README.md contains `27 skills`", () => {
      expect(README).toContain("27 skills");
    });

    it("README.md contains `16 runbooks`", () => {
      expect(README).toContain("16 runbooks");
    });
  });

  describe("Tripwire 4: start-command.ts does NOT contain stale count strings", () => {
    it("start-command.ts does not contain `eight flow specialists`", () => {
      expect(START_COMMAND_BODY).not.toContain("eight flow specialists");
    });

    it("start-command.ts does not contain `five-field`", () => {
      expect(START_COMMAND_BODY).not.toContain("five-field");
    });
  });

  describe("Tripwire 5: critic.ts does NOT contain stale axis-count strings", () => {
    it("critic.ts does not contain `reviewer's eight axes`", () => {
      expect(CRITIC_PROMPT).not.toContain("reviewer's eight axes");
    });
  });
});
