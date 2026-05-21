import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.110 — skill-side slice/AC migration completion (tripwire).
 *
 * v8.109 ("honesty sweep") completed the SL-N / verify(AC-N) split on the
 * TS side (BUILD_TEMPLATE, SHIP_TEMPLATE, anti-rationalizations.ts,
 * reviewer.ts, builder.ts) — but the auto-loaded skill bodies still taught
 * the pre-v8.63 commit prefix shape. That left the LLM dispatching against
 * a contradictory contract (builder.ts says (SL-N), skill body says (AC-N))
 * and emitting `red(AC-N):`-style commits the reviewer's new
 * `git log --grep="(SL-N):"` scan silently misses.
 *
 * v8.110 retargets the five auto-loaded skill bodies + the two skills.ts
 * descriptions:
 *   - ac-discipline.md          (10+ AC-prefix occurrences; ac-traceability reshape)
 *   - tdd-and-verification.md   (15+ AC-prefix occurrences; always-on TDD teacher)
 *   - commit-hygiene.md         (canonical "Strict-mode subject" rule)
 *   - conversation-language.md  (2 example occurrences)
 *   - plan-authoring.md         (1 occurrence)
 *
 * The contract is canonical in builder.ts + reviewer.ts; this test pins
 * the skill bodies to match.
 *
 *   - Slice work commits use `red(SL-N):` / `green(SL-N):` / `refactor(SL-N):`
 *     / `test(SL-N):` / `docs(SL-N):` (keyed by SL).
 *   - AC verification commits use `verify(AC-N): passing` (keyed by AC).
 *   - The buggy patterns are `red(AC-` / `green(AC-` / `refactor(AC-`
 *     anywhere except as explicit "archived-flow back-compat" framing.
 */

const SKILL_IDS_UNDER_CONTRACT = [
  "ac-discipline",
  "tdd-and-verification",
  "commit-hygiene",
  "conversation-language",
  "plan-authoring",
] as const;

const SLICE_PREFIX_PATTERNS = [
  /red\(SL-N\):/,
  /green\(SL-N\):/,
  /refactor\(SL-N\):/,
] as const;

const BUGGY_AC_PREFIX_PATTERNS = [
  /red\(AC-/,
  /green\(AC-/,
  /refactor\(AC-/,
] as const;

const VERIFY_AC_PATTERN = /verify\(AC-N\): passing/;

const ARCHIVED_FLOW_MARKERS = [
  "archived-flow",
  "Archived-flow",
  "pre-v8.63",
  "Pre-v8.63",
];

function loadSkillBody(id: string): string {
  const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === id);
  if (!skill) {
    throw new Error(`AUTO_TRIGGER_SKILLS missing entry for \`${id}\``);
  }
  return skill.body;
}

function loadSkillDescription(id: string): string {
  const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === id);
  if (!skill) {
    throw new Error(`AUTO_TRIGGER_SKILLS missing entry for \`${id}\``);
  }
  return skill.description;
}

/**
 * A buggy AC-prefix occurrence is "OK" only when it sits inside a paragraph
 * whose body names one of the archived-flow markers. The heuristic: take a
 * generous slice of context around the match (600 chars each side, large
 * enough to span a section heading + an explanatory paragraph) and check
 * whether any marker appears.
 */
function hasArchivedFlowFraming(body: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 600);
  const end = Math.min(body.length, matchIndex + 600);
  const window = body.slice(start, end);
  return ARCHIVED_FLOW_MARKERS.some((marker) => window.includes(marker));
}

describe("v8.110 — skill-side slice/AC migration completion (tripwire)", () => {
  describe("Slice-work commits use (SL-N) prefixes in every retargeted skill", () => {
    for (const id of SKILL_IDS_UNDER_CONTRACT) {
      it(`\`${id}.md\` carries at least one (SL-N) slice-work prefix example`, () => {
        const body = loadSkillBody(id);
        for (const pattern of SLICE_PREFIX_PATTERNS) {
          expect(
            body,
            `\`${id}.md\` must teach the slice-work prefix shape via at least one \`${pattern.source}\` example`,
          ).toMatch(pattern);
        }
      });
    }
  });

  describe("AC-prefix slice work is gone (except archived-flow back-compat framing)", () => {
    for (const id of SKILL_IDS_UNDER_CONTRACT) {
      it(`\`${id}.md\` contains no naked \`red(AC-\` / \`green(AC-\` / \`refactor(AC-\` outside archived-flow back-compat framing`, () => {
        const body = loadSkillBody(id);
        const naked: string[] = [];
        for (const pattern of BUGGY_AC_PREFIX_PATTERNS) {
          const globalPattern = new RegExp(pattern.source, "g");
          let match: RegExpExecArray | null;
          while ((match = globalPattern.exec(body)) !== null) {
            if (!hasArchivedFlowFraming(body, match.index)) {
              naked.push(
                `\`${match[0]}\` at offset ${match.index} (context: …${body
                  .slice(Math.max(0, match.index - 60), match.index + 60)
                  .replace(/\n/g, " ")}…)`,
              );
            }
          }
        }
        expect(
          naked,
          `\`${id}.md\` must not teach the pre-v8.63 commit-prefix shape without explicit archived-flow back-compat framing; found:\n${naked.join(
            "\n",
          )}`,
        ).toEqual([]);
      });
    }
  });

  describe("`verify(AC-N): passing` shape appears in the AC-side skills", () => {
    const VERIFY_REQUIRED = [
      "ac-discipline",
      "tdd-and-verification",
      "commit-hygiene",
    ] as const;

    for (const id of VERIFY_REQUIRED) {
      it(`\`${id}.md\` cites the \`verify(AC-N): passing\` shape at least once`, () => {
        const body = loadSkillBody(id);
        expect(
          body,
          `\`${id}.md\` must reference the canonical AC-verification commit shape \`verify(AC-N): passing\``,
        ).toMatch(VERIFY_AC_PATTERN);
      });
    }
  });

  describe("skills.ts descriptions reference the new SL / verify(AC) contract", () => {
    it("`ac-discipline` description names the `verify(AC-N): passing` chain (and does not teach `red(AC-N):` slice work)", () => {
      const description = loadSkillDescription("ac-discipline");
      expect(description).toMatch(/verify\(AC-N\)/);
      expect(description).not.toMatch(/red\(AC-N\)/);
      expect(description).not.toMatch(/green\(AC-N\)/);
      expect(description).not.toMatch(/refactor\(AC-N\)/);
    });

    it("`commit-hygiene` description names slice-work `(SL-N)` prefixes AND the `verify(AC-N): passing` shape", () => {
      const description = loadSkillDescription("commit-hygiene");
      expect(description).toMatch(/red\(SL-N\):/);
      expect(description).toMatch(/green\(SL-N\):/);
      expect(description).toMatch(/refactor\(SL-N\):/);
      expect(description).toMatch(/verify\(AC-N\): passing/);
      expect(description).not.toMatch(/red\(AC-N\):/);
      expect(description).not.toMatch(/green\(AC-N\):/);
      expect(description).not.toMatch(/refactor\(AC-N\):/);
    });
  });
});
