import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * TDD cycle wiring (v8.40 — prompt-only, git-log-verified).
 *
 * Slimmed in v8.101 test-slim-down A4 from 9 single-module its() to 3
 * packed cross-module wiring tests (skill + build playbook + TDD gates;
 * builder + reviewer prompts + commit prefixes; build template +
 * antipatterns + /cc start-command). Each packed test verifies the TDD
 * contract is propagated across every surface that ships it.
 */

describe("TDD cycle wiring — auto-trigger skill + build playbook + canonical TDD gates", () => {
  it("WIRING — tdd-and-verification skill fires on stage=build with RED/GREEN/REFACTOR + Iron Law, the build playbook is a TDD playbook with Discover/RED/GREEN/REFACTOR phases + Iron Law + red/green/refactor(AC-N), and the build playbook lists all eight canonical TDD gates", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-and-verification");
    expect(skill).toBeDefined();
    expect(skill!.triggers).toContain("stage:build");
    expect(skill!.body).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(skill!.body).toMatch(/Iron Law/iu);

    const runbook = STAGE_PLAYBOOKS.find((entry) => entry.id === "build")!;
    expect(runbook).toBeDefined();
    for (const heading of [
      "Discover before RED",
      "RED — write a failing test",
      "GREEN — minimal production change",
      "REFACTOR — keep behaviour"
    ]) {
      expect(runbook.body).toContain(heading);
    }
    expect(runbook.body).toContain("Iron Law");
    expect(runbook.body).toMatch(/red\(AC-N\)/u);
    expect(runbook.body).toMatch(/green\(AC-N\)/u);
    expect(runbook.body).toMatch(/refactor\(AC-N\)/u);
    for (const gate of [
      "discovery_complete",
      "impact_check_complete",
      "red_test_written",
      "red_fails_for_right_reason",
      "green_full_suite",
      "refactor_completed_or_skipped_with_reason",
      "traceable_to_plan",
      "commit_chain_intact"
    ]) {
      expect(runbook.body).toContain(gate);
    }
  });
});

describe("TDD cycle wiring — builder + reviewer prompts + per-AC commit prefixes", () => {
  it("WIRING — builder prompt is TDD-aware with watched-RED proof, full-suite GREEN, Iron Law, slice-based red/green/refactor(SL-N) + verify(AC-N), uses plain `git commit` with posture prefix recipe; reviewer prompt mentions git-log inspection of the per-AC commit chain", () => {
    const builder = SPECIALIST_PROMPTS["builder"];
    expect(builder).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(builder).toContain("watched-RED proof");
    expect(builder).toMatch(/full[- ]?relevant suite/iu);
    expect(builder).toContain("Iron Law");
    expect(builder).toMatch(/red\(SL-N\)/u);
    expect(builder).toMatch(/green\(SL-N\)/u);
    expect(builder).toMatch(/refactor\(SL-N\)/u);
    expect(builder).toMatch(/verify\(AC-N\)/u);
    expect(builder).toMatch(/git commit -m "red\(SL-N\)/u);
    expect(builder).toMatch(/git commit (?:--allow-empty )?-m "verify\(AC-N\)/u);

    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/git log --grep/u);
    expect(reviewer).toMatch(/red\(AC-/u);
    expect(reviewer).toMatch(/green\(AC-/u);
  });
});

describe("TDD cycle wiring — build template + antipatterns + /cc start-command surface", () => {
  it("WIRING — BUILD_TEMPLATE has the six-column TDD log table + Iron Law + tdd_cycle:enforced; ANTIPATTERNS covers TDD phase integrity via git-log inspection (red/green/refactor(AC-N), Work outside the AC, `git add -A`); START_COMMAND_BODY wires build as a TDD cycle (RED → GREEN → REFACTOR, strict mode, Iron Law, tdd-and-verification skill)", () => {
    const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === "build")!;
    for (const column of ["Discovery", "RED proof", "GREEN evidence", "REFACTOR notes", "commits"]) {
      expect(template.body).toContain(column);
    }
    expect(template.body).toContain("Iron Law");
    expect(template.body).toContain("tdd_cycle: enforced");

    expect(ANTIPATTERNS).toContain("TDD phase integrity broken");
    expect(ANTIPATTERNS).toMatch(/red\(AC-N\)/u);
    expect(ANTIPATTERNS).toMatch(/green\(AC-N\)/u);
    expect(ANTIPATTERNS).toMatch(/refactor\(AC-N\)/u);
    expect(ANTIPATTERNS).toMatch(/git log --grep/u);
    expect(ANTIPATTERNS).toContain("Work outside the AC");
    expect(ANTIPATTERNS).toContain("git add -A");

    expect(START_COMMAND_BODY).toMatch(/build/);
    expect(START_COMMAND_BODY).toMatch(/tdd-and-verification/);
    expect(START_COMMAND_BODY).toMatch(/RED → GREEN → REFACTOR/u);
    expect(START_COMMAND_BODY).toMatch(/strict mode/i);
    expect(START_COMMAND_BODY).toContain("Iron Law");
  });
});
