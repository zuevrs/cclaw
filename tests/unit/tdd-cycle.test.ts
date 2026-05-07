import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { COMMIT_HELPER_HOOK_SPEC } from "../../src/content/node-hooks.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";

describe("TDD cycle wiring", () => {
  it("ships a tdd-cycle auto-trigger skill that fires on stage=build", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle");
    expect(skill).toBeDefined();
    expect(skill!.triggers).toContain("stage:build");
    expect(skill!.body).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(skill!.body).toMatch(/Iron Law/iu);
  });

  it("build runbook is a TDD playbook with discovery + RED + GREEN + REFACTOR phases", () => {
    const runbook = STAGE_PLAYBOOKS.find((entry) => entry.id === "build");
    expect(runbook).toBeDefined();
    for (const heading of ["Discover before RED", "RED — write a failing test", "GREEN — minimal production change", "REFACTOR — keep behaviour"]) {
      expect(runbook!.body).toContain(heading);
    }
    expect(runbook!.body).toContain("Iron Law");
    expect(runbook!.body).toContain("--phase=red");
    expect(runbook!.body).toContain("--phase=green");
    expect(runbook!.body).toContain("--phase=refactor");
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

  it("slice-builder prompt is TDD-aware with watched-RED proof and full-suite GREEN evidence", () => {
    const prompt = SPECIALIST_PROMPTS["slice-builder"];
    expect(prompt).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(prompt).toContain("watched-RED proof");
    expect(prompt).toMatch(/full[- ]?relevant suite/iu);
    expect(prompt).toContain("Iron Law");
    expect(prompt).toContain("--phase=red");
    expect(prompt).toContain("--phase=green");
    expect(prompt).toContain("--phase=refactor");
  });

  it("BUILD_TEMPLATE has a six-column TDD log table", () => {
    const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === "build")!;
    for (const column of ["Discovery", "RED proof", "GREEN evidence", "REFACTOR notes", "commits"]) {
      expect(template.body).toContain(column);
    }
    expect(template.body).toContain("Iron Law");
    expect(template.body).toContain("tdd_cycle: enforced");
  });

  it("commit-helper hook enforces --phase and rejects production files in RED", () => {
    expect(COMMIT_HELPER_HOOK_SPEC.body).toContain("--phase is required");
    expect(COMMIT_HELPER_HOOK_SPEC.body).toMatch(/RED phase rejects production files/u);
    expect(COMMIT_HELPER_HOOK_SPEC.body).toMatch(/cannot record GREEN.*no RED commit/u);
    expect(COMMIT_HELPER_HOOK_SPEC.body).toMatch(/cannot record REFACTOR.*missing/u);
    expect(COMMIT_HELPER_HOOK_SPEC.body).toContain("--skipped");
  });

  it("antipatterns library catalogues the five TDD failure modes (A-13..A-17)", () => {
    for (const entry of ["A-13", "A-14", "A-15", "A-16", "A-17"]) {
      expect(ANTIPATTERNS).toContain(entry);
    }
    expect(ANTIPATTERNS).toContain("Implementation is obvious, skipping RED");
    expect(ANTIPATTERNS).toContain("Single test green, didn't run the suite");
    expect(ANTIPATTERNS).toContain("REFACTOR phase silently skipped");
    expect(ANTIPATTERNS).toContain("Production code in the RED commit");
  });

  it("/cc command (start-command) describes build as a TDD cycle with all three phases", async () => {
    const { START_COMMAND_BODY } = await import("../../src/content/start-command.js");
    expect(START_COMMAND_BODY).toContain("Step 5 — Build (TDD cycle)");
    expect(START_COMMAND_BODY).toMatch(/RED.*GREEN.*REFACTOR/u);
    expect(START_COMMAND_BODY).toContain("--phase=red");
    expect(START_COMMAND_BODY).toContain("--phase=green");
    expect(START_COMMAND_BODY).toContain("--phase=refactor");
    expect(START_COMMAND_BODY).toContain("Iron Law");
  });
});
