import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";

describe("TDD cycle wiring (v8.40 — prompt-only, git-log-verified)", () => {
  it("ships a tdd-and-verification auto-trigger skill that fires on stage=build", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-and-verification");
    expect(skill).toBeDefined();
    expect(skill!.triggers).toContain("stage:build");
    expect(skill!.body).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(skill!.body).toMatch(/Iron Law/iu);
  });

  it("build runbook is a TDD playbook with discovery + RED + GREEN + REFACTOR phases", () => {
    const runbook = STAGE_PLAYBOOKS.find((entry) => entry.id === "build");
    expect(runbook).toBeDefined();
    for (const heading of [
      "Discover before RED",
      "RED — write a failing test",
      "GREEN — minimal production change",
      "REFACTOR — keep behaviour"
    ]) {
      expect(runbook!.body).toContain(heading);
    }
    expect(runbook!.body).toContain("Iron Law");
    expect(runbook!.body).toMatch(/red\(AC-N\)/u);
    expect(runbook!.body).toMatch(/green\(AC-N\)/u);
    expect(runbook!.body).toMatch(/refactor\(AC-N\)/u);
  });

  it("build runbook lists the eight mandatory TDD gates", () => {
    const runbook = STAGE_PLAYBOOKS.find((entry) => entry.id === "build")!;
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

  it("builder prompt is TDD-aware with watched-RED proof and full-suite GREEN evidence (v8.63 — slice-based TDD; commit prefixes carry SL-N for the work pass and verify(AC-N) for the verification pass)", () => {
    const prompt = SPECIALIST_PROMPTS["builder"];
    expect(prompt).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(prompt).toContain("watched-RED proof");
    expect(prompt).toMatch(/full[- ]?relevant suite/iu);
    expect(prompt).toContain("Iron Law");
    expect(prompt).toMatch(/red\(SL-N\)/u);
    expect(prompt).toMatch(/green\(SL-N\)/u);
    expect(prompt).toMatch(/refactor\(SL-N\)/u);
    expect(prompt).toMatch(/verify\(AC-N\)/u);
  });

  it("builder prompt uses plain git commit with the posture prefix recipe (v8.63 — slice work commits prefixed with red(SL-N); AC verify commits prefixed with verify(AC-N))", () => {
    const prompt = SPECIALIST_PROMPTS["builder"];
    expect(prompt).toMatch(/git commit -m "red\(SL-N\)/u);
    expect(prompt).toMatch(/git commit (?:--allow-empty )?-m "verify\(AC-N\)/u);
  });

  it("reviewer prompt mentions git-log inspection of the per-AC commit chain", () => {
    const prompt = SPECIALIST_PROMPTS["reviewer"];
    expect(prompt).toMatch(/git log --grep/u);
    expect(prompt).toMatch(/red\(AC-/u);
    expect(prompt).toMatch(/green\(AC-/u);
  });

  it("BUILD_TEMPLATE has a six-column TDD log table", () => {
    const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === "build")!;
    for (const column of ["Discovery", "RED proof", "GREEN evidence", "REFACTOR notes", "commits"]) {
      expect(template.body).toContain(column);
    }
    expect(template.body).toContain("Iron Law");
    expect(template.body).toContain("tdd_cycle: enforced");
  });

  it("antipatterns library covers TDD phase integrity via git-log inspection", () => {
    expect(ANTIPATTERNS).toContain("TDD phase integrity broken");
    expect(ANTIPATTERNS).toMatch(/red\(AC-N\)/u);
    expect(ANTIPATTERNS).toMatch(/green\(AC-N\)/u);
    expect(ANTIPATTERNS).toMatch(/refactor\(AC-N\)/u);
    expect(ANTIPATTERNS).toMatch(/git log --grep/u);
    expect(ANTIPATTERNS).toContain("Work outside the AC");
    expect(ANTIPATTERNS).toContain("git add -A");
  });

  it("/cc command (start-command) wires build as a TDD cycle with mode-aware granularity", async () => {
    const { START_COMMAND_BODY } = await import("../../src/content/start-command.js");
    expect(START_COMMAND_BODY).toMatch(/build/);
    expect(START_COMMAND_BODY).toMatch(/tdd-and-verification/);
    expect(START_COMMAND_BODY).toMatch(/RED → GREEN → REFACTOR/u);
    expect(START_COMMAND_BODY).toMatch(/strict mode/i);
    expect(START_COMMAND_BODY).toContain("Iron Law");
  });
});
