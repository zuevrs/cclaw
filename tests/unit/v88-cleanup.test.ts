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
 * v8.8 cleanup — slimmed in v8.54.
 *
 * The full Tier 3 "no v7-era ceremony" sweep (23 negative assertions)
 * was retired; v7-era prose has been gone for 9 months, and the
 * `retired-tokens.test.ts` sweep (v8.54) covers any future re-emergence.
 * What stays here:
 *   - B1: design Phase 1 anchors (live invariant)
 *   - B2: A-N parity sweep across skills + prompts (catches phantom A-N)
 *   - B3: slice-builder strict/soft separation (v8.40 anchor)
 *   - B4: 5-tier severity anchor in security-reviewer
 *   - B5: flows/<slug>/<artifact>.md path invariant
 *   - B7: red_test_written canonical name
 */
describe("v8.8 cleanup (anchors)", () => {
  it("B1: design Phase 1 (Clarify) batches 0-3 clarifying questions (v8.14 + v8.47 pacing)", () => {
    expect(SPECIALIST_PROMPTS["design"]).toMatch(/Phase 1 — Clarify/);
    expect(SPECIALIST_PROMPTS["design"]).toMatch(/at most three.{0,200}clarifying questions/i);
    expect(SPECIALIST_PROMPTS["design"]).toMatch(/batched|0-3 questions/i);
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

  it("B3: slice-builder keeps the strict (per-AC prefixed commits) vs soft (plain commit) split", () => {
    const sb = SPECIALIST_PROMPTS["slice-builder"];
    expect(sb).toMatch(/In strict mode/);
    expect(sb).toMatch(/red\(AC-/);
    expect(sb).toMatch(/green\(AC-/);
    expect(sb).toMatch(/refactor\(AC-/);
    expect(sb).toMatch(/soft mode/i);
    expect(sb).toMatch(/plain `git commit`/);
  });

  it("B4: security-reviewer carries the 5-tier severity scale (critical / required / consider / nit / fyi)", () => {
    expect(SPECIALIST_PROMPTS["security-reviewer"]).toMatch(
      /critical \/ required \/ consider \/ nit \/ fyi/
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
