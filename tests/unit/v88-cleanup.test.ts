import { describe, expect, it } from "vitest";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";

const allSkillsConcat = AUTO_TRIGGER_SKILLS.map((s) => s.body).join("\n\n");
const allSpecialistsConcat = Object.values(SPECIALIST_PROMPTS).join("\n\n");
const allPlaybooksConcat = STAGE_PLAYBOOKS.map((p) => p.body).join("\n\n");
const everything = [allSkillsConcat, allSpecialistsConcat, START_COMMAND_BODY, allPlaybooksConcat].join("\n\n");

/**
 * v8.8 cleanup — slimmed in v8.54, re-pinned in v8.62.
 *
 * The full Tier 3 "no v7-era ceremony" sweep (23 negative assertions)
 * was retired; v7-era prose has been gone for 9 months, and the
 * `retired-tokens.test.ts` sweep (v8.54) covers any future re-emergence.
 * What stays here (v8.62 unified flow updated):
 *   - B1: no mid-plan dialogue — v8.62 forbids the Phase 1 (Clarify)
 *         pacing entirely (replaces the v8.14 + v8.47 pacing anchor)
 *   - B2: A-N parity sweep across skills + prompts (catches phantom A-N)
 *   - B3: builder strict/soft separation (v8.40 anchor; v8.62 renamed
 *         from slice-builder)
 *   - B4: reviewer's security axis carries the 5-tier severity scale
 *         (v8.62 absorbed the former security-reviewer specialist)
 *   - B5: flows/<slug>/<artifact>.md path invariant
 *   - B7: red_test_written canonical name
 */
describe("v8.8 cleanup (anchors)", () => {
  it("B1: v8.62 unified flow forbids mid-plan dialogue entirely; no specialist runs a 'Clarify' phase, and the `architect` resolves vagueness silently using best judgment (replaces the v8.14 + v8.47 design Phase 1 pacing anchor)", () => {
    const architect = SPECIALIST_PROMPTS["architect"];
    // v8.62: the dead `design` specialist's Phase 1 (Clarify) is gone —
    // `architect` absorbs Phase 0/2-6 but explicitly drops the
    // multi-turn dialogue protocol. The prompt must NOT carry a
    // Phase 1 Clarify section and must NOT carry the "at most three
    // clarifying questions" pacing language.
    expect(architect).not.toMatch(/Phase 1 — Clarify/);
    expect(architect).not.toMatch(/at most three.{0,200}clarifying questions/i);
    expect(architect).not.toMatch(/batched.{0,80}clarifying|0-3 questions/i);
    // Positive lock: the prompt should explicitly call out the silent
    // resolution / no-dialogue stance somewhere.
    expect(architect).toMatch(/(silent|silently|no mid-plan dialogue|best judgment|no questions)/i);
  });

  it("B2: A-N parity — every A-N referenced in skills / prompts / playbooks exists in antipatterns.ts", () => {
    const referenced = new Set<string>();
    const re = /\bA-(\d+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(everything)) !== null) referenced.add(m[1]!);
    const defined = new Set<string>();
    const reDef = /^## (A-(\d+))/gm;
    while ((m = reDef.exec(ANTIPATTERNS)) !== null) defined.add(m[2]!);
    const missing = [...referenced].filter((n) => !defined.has(n));
    expect(missing).toEqual([]);
  });

  it("B3: builder keeps the strict (per-slice prefixed commits + per-AC verify commits) vs soft (plain commit) split (v8.62 renamed from slice-builder; v8.63 separated work-units (slices, SL-N) from verification (AC, AC-N))", () => {
    const builder = SPECIALIST_PROMPTS["builder"];
    expect(builder).toMatch(/In strict mode/);
    expect(builder).toMatch(/red\(SL-/);
    expect(builder).toMatch(/green\(SL-/);
    expect(builder).toMatch(/refactor\(SL-/);
    expect(builder).toMatch(/verify\(AC-/);
    expect(builder).toMatch(/soft mode/i);
    expect(builder).toMatch(/plain `git commit`/);
  });

  it("B4: reviewer's security axis carries the 5-tier severity scale (critical / required / consider / nit / fyi) — v8.62 absorbed the former security-reviewer specialist into reviewer's security axis along with its severity vocabulary", () => {
    // The reviewer canonicalises the five severities in a code-spanned
    // list (`critical` / `required` / `consider` / `nit` / `fyi`);
    // allow optional backticks around each token so the assertion
    // tracks the rendered prose tolerantly.
    expect(SPECIALIST_PROMPTS["reviewer"]).toMatch(
      /`?critical`? \/ `?required`? \/ `?consider`? \/ `?nit`? \/ `?fyi`?/
    );
  });

  it("B5: artifacts use flows/<slug>/<artifact>.md (no v7 plans/builds/reviews paths)", () => {
    for (const pat of [
      /`plans\/<slug>\.md`/,
      /`builds\/<slug>\.md`/,
      /`reviews\/<slug>\.md`/,
      /`ships\/<slug>\.md`/
    ]) {
      expect(everything).not.toMatch(pat);
    }
    expect(everything).toMatch(/flows\/<slug>\/plan\.md/);
    expect(everything).toMatch(/flows\/<slug>\/build\.md/);
    expect(everything).toMatch(/flows\/<slug>\/review\.md/);
  });

  it("B7: red_test_written is the canonical TDD gate name (legacy red_test_recorded is gone)", () => {
    const tdd = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification")!;
    expect(tdd.body).toMatch(/red_test_written/);
    expect(tdd.body).not.toMatch(/red_test_recorded/);
    const buildPlaybook = STAGE_PLAYBOOKS.find((p) => p.id === "build")!;
    expect(buildPlaybook.body).toMatch(/red_test_written/);
  });
});
