import { describe, expect, it } from "vitest";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { RECOVERY_PLAYBOOK } from "../../src/content/recovery.js";

const allSkillsConcat = AUTO_TRIGGER_SKILLS.map((s) => s.body).join("\n\n");
const allSpecialistsConcat = Object.values(SPECIALIST_PROMPTS).join("\n\n");
const allPlaybooksConcat = STAGE_PLAYBOOKS.map((p) => p.body).join("\n\n");
const everything = [
  allSkillsConcat,
  allSpecialistsConcat,
  START_COMMAND_BODY,
  allPlaybooksConcat,
  RECOVERY_PLAYBOOK
].join("\n\n");

/**
 * v8.8 cleanup release: 7 real bugs fixed (B1-B7), test suite halved
 * (v82-v87 regression files dropped after extracting genuine behavior
 * tests to flow-state.test.ts), version markers and 3-tier severity
 * legacy notes stripped from skill body / specialist prompts.
 *
 * This file verifies the cleanup is complete and stays clean. If a
 * future change reintroduces a "(v8.X+)" header or a wrong A-number
 * citation, this suite breaks loudly.
 */
describe("v8.8 cleanup", () => {
  // ─────────────────────────────────────────────────────────────────────
  // B1 — interpretationForks wired through every relevant specialist
  // ─────────────────────────────────────────────────────────────────────
  describe("B1 — interpretationForks is wired (legacy specialists) + v8.14 design supersedes it", () => {
    it("ac-author prompt still reads triage.interpretationForks (legacy non-discovery cross-check)", () => {
      expect(SPECIALIST_PROMPTS["ac-author"]).toMatch(/triage\.interpretationForks/);
    });

    it("slice-builder prompt reads triage.interpretationForks", () => {
      expect(SPECIALIST_PROMPTS["slice-builder"]).toMatch(/interpretationForks/);
    });

    it("ac-author Phase 2 mentions interpretationForks cross-check (not just assumptions)", () => {
      expect(SPECIALIST_PROMPTS["ac-author"]).toMatch(
        /Phase 2 — Assumptions \+ interpretation cross-check/i
      );
    });

    it("v8.14 + v8.47: design Phase 1 (Clarify) replaces the brainstormer/architect interpretation-fork reads with live clarifying questions (v8.47 batches them in one ask)", () => {
      // v8.14 retired brainstormer and architect. design's Phase 1
      // (Clarify) asks <=3 clarifying questions IN the running
      // orchestrator context instead of reading a pre-baked
      // interpretationForks array. v8.47 collapsed the per-question
      // turn pattern (1 question per turn) into ONE batched
      // structured-ask call (0-3 questions in a single call) so the
      // user sees at most one Phase 1 turn.
      expect(SPECIALIST_PROMPTS["design"]).toMatch(/Phase 1 — Clarify/);
      expect(SPECIALIST_PROMPTS["design"]).toMatch(/at most three.{0,200}clarifying questions/i);
      expect(SPECIALIST_PROMPTS["design"]).toMatch(/batched|ONE batched|single batched|0-3 questions/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // B2 — TDD anti-patterns rebuilt from antipatterns.ts; A-N parity
  // ─────────────────────────────────────────────────────────────────────
  describe("B2 — TDD anti-patterns reference correct A-numbers", () => {
    const tdd = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification");

    it("tdd-cycle skill is registered", () => {
      expect(tdd).toBeDefined();
    });

    it("does NOT cite phantom A-18 / A-19 / A-20 (those never existed in this codebase)", () => {
      const antipatternsSection = tdd!.body.split("## Anti-patterns")[1] ?? "";
      expect(antipatternsSection).not.toMatch(/horizontal slicing.{0,40}A-18/i);
      expect(antipatternsSection).not.toMatch(/pushing past.{0,40}A-19/i);
      expect(antipatternsSection).not.toMatch(/mocking.{0,40}A-20/i);
    });

    it("cites A-1 for skipping RED / phase integrity (renumbered from old A-2 in v8.12)", () => {
      const section = tdd!.body.split("## Anti-patterns")[1] ?? "";
      expect(section).toMatch(/A-1.{0,120}TDD phase integrity/s);
    });

    it("cites A-2 for work-outside-the-AC (renumbered from old A-3)", () => {
      const section = tdd!.body.split("## Anti-patterns")[1] ?? "";
      expect(section).toMatch(/A-2.{0,80}work outside the AC/s);
    });

    it("cites A-3 for mocking-what-should-not-be-mocked (renumbered from old A-15)", () => {
      const section = tdd!.body.split("## Anti-patterns")[1] ?? "";
      expect(section).toMatch(/A-3.{0,120}[Mm]ocking/s);
    });

    it("does NOT cite the deleted A-12 / A-13 / A-14 (single-test-green, horizontal slicing, pushing past failing test)", () => {
      // These antipatterns were among the 24 unused entries deleted in v8.12.
      const section = tdd!.body.split("## Anti-patterns")[1] ?? "";
      expect(section).not.toMatch(/A-12/);
      expect(section).not.toMatch(/A-13/);
      expect(section).not.toMatch(/A-14/);
    });

    it("A-N parity: every A-N referenced in skills / prompts exists in antipatterns.ts", () => {
      const referenced = new Set<string>();
      const re = /\bA-(\d+)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(everything)) !== null) {
        referenced.add(m[1]!);
      }
      const defined = new Set<string>();
      const reDef = /^## (A-(\d+))/gm;
      while ((m = reDef.exec(ANTIPATTERNS)) !== null) {
        defined.add(m[2]!);
      }
      const missing = [...referenced].filter((n) => !defined.has(n)).sort((a, b) => +a - +b);
      expect(missing).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // B3 — slice-builder commit rule scopes strict vs soft (v8.40: prompt-only)
  //
  // v8.8 originally scoped a "commit-helper, never git commit directly" rule
  // to strict mode. v8.40 retired the commit-helper hook entirely; the rule
  // now reads "per-AC commits with posture-driven prefixes in strict mode;
  // plain git commit in soft mode". This block guards that the v8.8
  // separation of concerns (strict ≠ soft) survived the v8.40 migration.
  // ─────────────────────────────────────────────────────────────────────
  describe("B3 — slice-builder strict/soft separation survives v8.40 hook removal", () => {
    const sb = SPECIALIST_PROMPTS["slice-builder"];

    it("strict mode rule mentions posture-driven per-AC commit prefixes", () => {
      expect(sb).toMatch(/In strict mode/);
      expect(sb).toMatch(/red\(AC-/);
      expect(sb).toMatch(/green\(AC-/);
      expect(sb).toMatch(/refactor\(AC-/);
    });

    it("soft mode rule mentions plain git commit (no per-AC prefix)", () => {
      expect(sb).toMatch(/soft mode/i);
      expect(sb).toMatch(/plain `git commit`/);
    });

    it("v8.40 tripwire: no reference to the retired commit-helper hook", () => {
      expect(sb).not.toContain("commit-helper");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // B4 — severity scale aligned with reviewer (5-tier)
  // ─────────────────────────────────────────────────────────────────────
  describe("B4 — severity scale aligned with the reviewer (5-tier)", () => {
    it("slice-builder shim rule cites severity=critical, not severity=block", () => {
      const sb = SPECIALIST_PROMPTS["slice-builder"];
      expect(sb).toMatch(/severity: `critical`/);
      expect(sb).not.toMatch(/severity: `block`/);
    });

    it("ac-author edge-case finding cites severity=required (not block)", () => {
      const acAuthor = SPECIALIST_PROMPTS["ac-author"];
      expect(acAuthor).toMatch(/severity=`required`.{0,80}edge-case coverage/s);
      expect(acAuthor).not.toMatch(/flags an AC as `block`/);
    });

    it("security-reviewer Output section uses 5-tier scale (no block / warn / info severity)", () => {
      const sr = SPECIALIST_PROMPTS["security-reviewer"];
      expect(sr).toMatch(/critical \/ required \/ consider \/ nit \/ fyi/);
      expect(sr).not.toMatch(/regular `block \/ warn \/ info` axis/);
    });

    it("security-reviewer worked example uses axis | severity columns (not legacy security-warn)", () => {
      const sr = SPECIALIST_PROMPTS["security-reviewer"];
      expect(sr).toMatch(/\| F-1 \| security \| required \|/);
      expect(sr).not.toMatch(/security-warn/);
    });

    it("security-reviewer JSON summary uses by_axis + by_severity (5-tier shape)", () => {
      const sr = SPECIALIST_PROMPTS["security-reviewer"];
      expect(sr).toMatch(/"by_axis":/);
      expect(sr).toMatch(/"by_severity":.{0,200}"required": 1/s);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // B5 — v7-style paths gone (plans/<slug>.md → flows/<slug>/plan.md)
  // ─────────────────────────────────────────────────────────────────────
  describe("B5 — v7-style paths replaced by flows/<slug>/<artifact>.md everywhere", () => {
    const v7Patterns = [
      /`plans\/<slug>\.md`/,
      /`builds\/<slug>\.md`/,
      /`reviews\/<slug>\.md`/,
      /`decisions\/<slug>\.md`/,
      /`ships\/<slug>\.md`/,
      /`learnings\/<slug>\.md`/
    ];

    for (const pat of v7Patterns) {
      it(`no occurrences of ${pat.source} in skill body / specialist prompts / start-command / playbooks / recovery`, () => {
        expect(everything).not.toMatch(pat);
      });
    }

    it("flows/<slug>/<artifact>.md form is used (≥1 occurrence each)", () => {
      expect(everything).toMatch(/flows\/<slug>\/plan\.md/);
      expect(everything).toMatch(/flows\/<slug>\/build\.md/);
      expect(everything).toMatch(/flows\/<slug>\/review\.md/);
      // v8.14: decisions inline into plan.md; legacy specialists may still
      // cite decisions.md from pre-v8.14 shipped slugs but it's no longer a
      // required artifact for new flows.
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // B6 — RETIRED in v8.14: architect prompt was merged into design.
  // The numbering invariant for architect's Sub-agent context block is
  // moot because the block no longer exists.
  // ─────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────
  // B7 — red_test_written is the canonical name (vs old red_test_recorded)
  // ─────────────────────────────────────────────────────────────────────
  describe("B7 — TDD gate name is unified (red_test_written)", () => {
    it("tdd-cycle skill body uses red_test_written", () => {
      const tdd = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification")!;
      expect(tdd.body).toMatch(/red_test_written/);
    });

    it("tdd-cycle skill body does NOT use the legacy red_test_recorded name", () => {
      const tdd = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification")!;
      expect(tdd.body).not.toMatch(/red_test_recorded/);
    });

    it("stage-playbook build runbook body uses red_test_written", () => {
      const buildPlaybook = STAGE_PLAYBOOKS.find((p) => p.id === "build");
      expect(buildPlaybook).toBeDefined();
      expect(buildPlaybook!.body).toMatch(/red_test_written/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tier 3 — version markers stripped from skill body / specialist prompts
  // (TS code comments and user-facing migration messages are KEPT)
  // ─────────────────────────────────────────────────────────────────────
  describe("Tier 3 — no '(v8.X+)' / 'since v8.X' / legacy-note version markers in skill body or prompts", () => {
    const promptsAndSkillsOnly = [allSkillsConcat, allSpecialistsConcat].join("\n\n");

    it("no '(v8.X+)' parenthetical markers (e.g. (v8.7+), (v8.4+))", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/\(v8\.\d+\+\)/);
    });

    it("no '(NEW sub-step, v8.X+)' headings", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/\(NEW sub-step, v8\./);
    });

    it("no 'Severity legacy note' block (legacy 3-tier mapping)", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/Severity legacy note/i);
    });

    it("no 'v8.X maps these' history references", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/v8\.\d+ maps these/i);
    });

    it("no 'since v8.X' history-as-content references", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/since v8\.\d+/i);
    });

    it("no 'v7-era' rhetoric", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/v7-era/i);
    });

    it("no 'the v7 mistake' / 'the v8.X bug' rhetoric", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/the v7 mistake/i);
      expect(promptsAndSkillsOnly).not.toMatch(/the v8\.\d+ bug/i);
    });

    it("no 'cclaw v8' rhetorical lead-in (user-facing migration messages live in CLI / start-command, not prompts)", () => {
      expect(promptsAndSkillsOnly).not.toMatch(/Cclaw v8 explicitly/i);
      expect(promptsAndSkillsOnly).not.toMatch(/cclaw v8\.\d+\+ replaces/i);
    });
  });
});
