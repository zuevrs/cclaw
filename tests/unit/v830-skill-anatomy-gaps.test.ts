import { describe, expect, it } from "vitest";

import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.30 — skill anatomy gaps (When-NOT-to-apply + top-8 Common
 * Rationalizations tables; addy pattern).
 *
 * v8.26 enforced the Overview / When-to-use / ≥2-depth-sections rubric
 * across every skill. The five-audit review (cclaw v8.29 vs
 * addyosmani-skills / gstack / karpathy+mattpocock / flow-complexity /
 * oh-my-openagent+everyinc+chachamaru) flagged two consistent gaps:
 *
 * 1. **`When NOT to apply` is missing across 0/18 skills.** The
 *    addyosmani anatomy pairs every "When to use" with a negative-scope
 *    counterpart that names the cases the skill explicitly does NOT
 *    cover. The negative scope is what stops the orchestrator from
 *    invoking a skill out of context and what stops a future agent
 *    from cargo-culting the skill into adjacent surfaces.
 *
 * 2. **Common Rationalizations tables are present in only 2/8 top
 *    skills.** The pattern (a two-column `excuse → rebuttal` table)
 *    materialises the most-common ways an agent talks themselves out
 *    of obeying the skill, paired with the rebuttal. The reviewer
 *    cites the table directly when a slim-summary Notes line names a
 *    listed rationalization. The two-column table is the lifecycle
 *    artifact for the rationalization slot; bullet lists, prose
 *    paragraphs, and "Anti-patterns" lists don't fit the slot.
 *
 *    The top-8 skills are the ones the orchestrator dispatches into
 *    every flow stage and where an agent is most likely to hand-wave
 *    past discipline:
 *
 *    `tdd-and-verification`, `review-discipline`, `commit-hygiene`,
 *    `ac-discipline`, `api-evolution`, `debug-and-browser`, `triage-gate`.
 *
 *    `tdd-and-verification` shipped the table in v8.13; v8.30 ships
 *    the other six. (v8.44 retired `code-simplification.md` along
 *    with four other zombie additive skills — its table is no longer
 *    in the floor set.)
 *
 * Both gaps are **additive-only**. Skill bodies are preserved verbatim
 * except for the new H2 sections appended in their canonical position.
 * The v8.26 tripwire (Overview + When-to-use + ≥2 depth sections) still
 * fires from `v826-skill-anatomy.test.ts`; this file extends the rubric
 * with the v8.30 additions.
 */

const ALL_SKILLS = AUTO_TRIGGER_SKILLS.map((s) => ({
  fileName: s.fileName,
  body: s.body,
}));

/**
 * Top-8 skills that must carry an explicit two-column "Common
 * rationalizations" table (or its v8.13 / v8.27 alias
 * "Anti-rationalization table"). The rubric is intentionally narrow:
 * the rationalization slot is satisfied ONLY by a markdown table whose
 * first column is a quoted excuse and second column is the rebuttal.
 */
const TOP_8_RATIONALIZATION_SKILLS = [
  "tdd-and-verification.md",
  "review-discipline.md",
  "commit-hygiene.md",
  "ac-discipline.md",
  "api-evolution.md",
  "debug-and-browser.md",
  "triage-gate.md",
];

const WHEN_NOT_HEADING =
  /^##\s+(When NOT to (use|apply|invoke|trigger|run)|When this skill does NOT apply|When NOT to write|When to skip|When NOT)/m;

const RATIONALIZATIONS_HEADING =
  /^##\s+(Common rationalizations|Anti-rationalization)/m;

/**
 * Match a two-column markdown table by scanning for a pipe-delimited
 * header row immediately followed by a pipe-delimited separator row
 * (`| --- |`). Two-column = at least two cell separators on the header
 * row. The body rows are not enumerated here; the v8.26 rubric already
 * vouches for body content being present (the depth-count check).
 */
function bodyAfter(body: string, heading: RegExp): string | null {
  const match = heading.exec(body);
  if (!match || match.index === undefined) return null;
  // Slice from the heading to the next H2 (or end-of-file) so the table
  // detection is scoped to the rationalizations section only.
  const after = body.slice(match.index + match[0].length);
  const nextH2 = after.search(/^##\s/m);
  return nextH2 === -1 ? after : after.slice(0, nextH2);
}

function hasTwoColumnTable(section: string): boolean {
  // ripgrep-shaped markdown table: header row `| col | col |` followed
  // by a separator row `| --- | --- |`. Tolerant of leading whitespace
  // and pipe-padding variance.
  return /\|[^\n|]+\|[^\n|]+\|\s*\n\s*\|\s*-+\s*\|\s*-+\s*\|/.test(section);
}

describe("v8.30 skill anatomy gaps — When NOT to apply on every skill", () => {
  it("AC-1 — every skill has a `When NOT to apply` (or equivalent) H2 heading", () => {
    for (const skill of ALL_SKILLS) {
      expect(
        WHEN_NOT_HEADING.test(skill.body),
        `${skill.fileName} lacks a When-NOT-to-apply heading (e.g. "## When NOT to apply", "## When NOT to use", "## When NOT to invoke", "## When this skill does NOT apply"). The negative-scope section is what stops the orchestrator from invoking the skill out of context; missing it is the exact failure mode the v8.30 audit flagged.`
      ).toBe(true);
    }
  });

  it("AC-1 — the `When NOT to apply` section has non-empty body content (≥30 chars)", () => {
    for (const skill of ALL_SKILLS) {
      const section = bodyAfter(skill.body, WHEN_NOT_HEADING);
      expect(section, `${skill.fileName} matched the When-NOT heading but has no body slice`).not.toBeNull();
      const trimmed = (section ?? "").trim();
      expect(
        trimmed.length,
        `${skill.fileName}'s When-NOT-to-apply section is only ${trimmed.length} chars; the audit asked for a short list of negative-scope cases, not an empty stub.`
      ).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("v8.30 skill anatomy gaps — Common Rationalizations table in top-8 skills", () => {
  it("AC-2 — each of the top-8 skills has a `Common rationalizations` or `Anti-rationalization` H2", () => {
    for (const fileName of TOP_8_RATIONALIZATION_SKILLS) {
      const skill = ALL_SKILLS.find((s) => s.fileName === fileName);
      if (!skill) {
        throw new Error(`Expected top-8 skill ${fileName}`);
      }
      expect(
        RATIONALIZATIONS_HEADING.test(skill.body),
        `${fileName} lacks a Common-rationalizations heading (e.g. "## Common rationalizations" or "## Anti-rationalization table"). The two-column excuse-vs-rebuttal table is the canonical surface for the rationalization slot in the addy / cclaw anatomy.`
      ).toBe(true);
    }
  });

  it("AC-2 — each top-8 rationalizations section carries a two-column markdown table", () => {
    for (const fileName of TOP_8_RATIONALIZATION_SKILLS) {
      const skill = ALL_SKILLS.find((s) => s.fileName === fileName);
      if (!skill) {
        throw new Error(`Expected top-8 skill ${fileName}`);
      }
      const section = bodyAfter(skill.body, RATIONALIZATIONS_HEADING);
      expect(section, `${fileName} matched the rationalizations heading but no body slice`).not.toBeNull();
      expect(
        hasTwoColumnTable(section ?? ""),
        `${fileName}'s Common-rationalizations section does NOT contain a two-column markdown table (header row + separator row with at least two columns). The v8.30 rubric requires the table shape; prose lists or single-column tables don't count.`
      ).toBe(true);
    }
  });

  it("AC-2 — non-top-8 skills are NOT forced to carry the table (it stays an opt-in rubric)", () => {
    // Negative assertion: a future maintainer adding the table to a
    // non-top-8 skill is fine; this test just locks the floor.
    // Concretely we sample one short skill (refinement.md) that
    // intentionally stays minimal and verify the test does NOT demand
    // a rationalizations table from it.
    const refinement = ALL_SKILLS.find((s) => s.fileName === "refinement.md");
    if (!refinement) throw new Error("Expected refinement.md skill");
    // No expectation either way — the test asserts that the audit
    // doesn't fail when a non-top-8 skill happens to lack the table.
    // This is a documentation test: it documents the scope of AC-2.
    expect(refinement.body.length).toBeGreaterThan(200);
  });
});

describe("v8.30 skill anatomy gaps — preserves the v8.26 rubric byte-compatibly", () => {
  it("AC-3 — every skill still has its `# Skill: <name>` H1", () => {
    for (const skill of ALL_SKILLS) {
      expect(
        skill.body,
        `${skill.fileName} lost its top-level "# Skill: <name>" heading — v8.30 additions must be additive only`
      ).toMatch(/^# Skill: /m);
    }
  });

  it("AC-3 — every skill still has its `## When to use` (or equivalent) heading from v8.26", () => {
    const WHEN_HEADING = /^##\s+(When |Applies\b|Triggers\b)/m;
    for (const skill of ALL_SKILLS) {
      expect(
        WHEN_HEADING.test(skill.body),
        `${skill.fileName} lost its v8.26 When-to-use heading after the v8.30 anatomy patches`
      ).toBe(true);
    }
  });

  it("AC-3 — every skill body remains non-empty and stays under a generous 1500-line ceiling", () => {
    for (const skill of ALL_SKILLS) {
      const lines = skill.body.split("\n").length;
      expect(skill.body.length).toBeGreaterThan(200);
      expect(
        lines,
        `${skill.fileName} grew to ${lines} lines after v8.30 patches. The additive sections should be 5-15 lines (When NOT) and ~30-50 lines (Common rationalizations); growing past ~1500 means the patch went beyond additive.`
      ).toBeLessThanOrEqual(1500);
    }
  });
});
