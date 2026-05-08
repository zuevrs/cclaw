import { describe, expect, it } from "vitest";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import {
  assertFlowStateV82,
  createInitialFlowState,
  isRunMode,
  migrateFlowState,
  runModeOf
} from "../../src/flow-state.js";
import { RUN_MODES, type TriageDecision } from "../../src/types.js";

describe("v8.3 — structured ask, run mode, parallel-build dispatch, deeper TDD", () => {
  describe("RunMode type + helpers", () => {
    it("ships RUN_MODES with step (default) and auto", () => {
      expect(RUN_MODES).toEqual(["step", "auto"]);
    });

    it("isRunMode rejects garbage", () => {
      expect(isRunMode("step")).toBe(true);
      expect(isRunMode("auto")).toBe(true);
      expect(isRunMode("autopilot")).toBe(false);
      expect(isRunMode(undefined)).toBe(false);
    });

    it("runModeOf defaults to step when triage is null or runMode is absent", () => {
      expect(runModeOf(null)).toBe("step");
      expect(runModeOf(undefined)).toBe("step");
      const triageWithoutRunMode: TriageDecision = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "test",
        decidedAt: "2026-05-08T00:00:00Z",
        userOverrode: false
      };
      expect(runModeOf(triageWithoutRunMode)).toBe("step");
    });

    it("runModeOf returns auto when set", () => {
      const triageAuto: TriageDecision = {
        complexity: "small-medium",
        acMode: "soft",
        path: ["plan", "build", "review", "ship"],
        rationale: "test",
        decidedAt: "2026-05-08T00:00:00Z",
        userOverrode: false,
        runMode: "auto"
      };
      expect(runModeOf(triageAuto)).toBe("auto");
    });
  });

  describe("flow-state schema accepts runMode and migrates legacy state with runMode: step", () => {
    it("createInitialFlowState ships triage: null (no runMode to set)", () => {
      const state = createInitialFlowState("2026-05-08T00:00:00Z");
      expect(state.triage).toBeNull();
    });

    it("assertFlowStateV82 accepts triage with runMode: auto", () => {
      const state = createInitialFlowState("2026-05-08T00:00:00Z");
      const next = {
        ...state,
        currentSlug: "demo",
        currentStage: "plan" as const,
        triage: {
          complexity: "small-medium" as const,
          acMode: "soft" as const,
          path: ["plan", "build", "review", "ship"] as const,
          rationale: "demo",
          decidedAt: "2026-05-08T00:00:00Z",
          userOverrode: false,
          runMode: "auto" as const
        }
      };
      expect(() => assertFlowStateV82(next)).not.toThrow();
    });

    it("assertFlowStateV82 still accepts triage WITHOUT runMode (8.2 backward compat)", () => {
      const state = createInitialFlowState("2026-05-08T00:00:00Z");
      const next = {
        ...state,
        currentSlug: "demo",
        currentStage: "plan" as const,
        triage: {
          complexity: "small-medium" as const,
          acMode: "soft" as const,
          path: ["plan", "build", "review", "ship"] as const,
          rationale: "demo",
          decidedAt: "2026-05-08T00:00:00Z",
          userOverrode: false
        }
      };
      expect(() => assertFlowStateV82(next)).not.toThrow();
    });

    it("assertFlowStateV82 rejects triage.runMode = 'autopilot' (only 'auto' / 'step')", () => {
      const state = createInitialFlowState("2026-05-08T00:00:00Z");
      const bad = {
        ...state,
        currentSlug: "demo",
        currentStage: "plan" as const,
        triage: {
          complexity: "small-medium",
          acMode: "soft",
          path: ["plan", "build", "review", "ship"],
          rationale: "x",
          decidedAt: "2026-05-08T00:00:00Z",
          userOverrode: false,
          runMode: "autopilot"
        }
      };
      expect(() => assertFlowStateV82(bad)).toThrow(/Invalid triage.runMode/);
    });

    it("migration from v2 sets runMode: step on the inferred triage", () => {
      const v2 = {
        schemaVersion: 2,
        currentSlug: "legacy-flow",
        currentStage: "plan",
        ac: [{ id: "AC-1", text: "x", status: "pending" as const }],
        lastSpecialist: null,
        startedAt: "2026-01-01T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false
      };
      const migrated = migrateFlowState(v2);
      expect(migrated.schemaVersion).toBe(3);
      expect(migrated.triage).not.toBeNull();
      expect(migrated.triage!.acMode).toBe("strict");
      expect(migrated.triage!.runMode).toBe("step");
    });
  });

  describe("triage-gate skill — structured ask + run-mode question", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "triage-gate");

    it("references the harness's structured ask tools by name (Claude / Cursor / OpenCode / Codex)", () => {
      expect(skill).toBeDefined();
      expect(skill!.body).toMatch(/AskUserQuestion/);
      expect(skill!.body).toMatch(/AskQuestion/);
    });

    it("describes the path question with the four options", () => {
      expect(skill!.body).toMatch(/Question 1 — path/);
      expect(skill!.body).toMatch(/Proceed as recommended/);
      expect(skill!.body).toMatch(/Switch to trivial/);
      expect(skill!.body).toMatch(/Escalate to large-risky/);
      expect(skill!.body).toMatch(/Custom/);
    });

    it("describes the run-mode question with step / auto options", () => {
      expect(skill!.body).toMatch(/Question 2 — run mode/);
      expect(skill!.body).toMatch(/Step \(default\)/);
      expect(skill!.body).toMatch(/Auto/);
      expect(skill!.body).toMatch(/block findings or security flag/);
    });

    it("documents the fallback to a fenced block when no structured ask tool exists", () => {
      expect(skill!.body).toMatch(/Fallback/);
      expect(skill!.body).toMatch(/\[s\] Step/);
      expect(skill!.body).toMatch(/\[a\] Auto/);
    });

    it("persists runMode in the recorded triage", () => {
      expect(skill!.body).toMatch(/"runMode": "step"/);
    });

    it("warns about defaulting to step when Question 2 is skipped", () => {
      expect(skill!.body).toMatch(/Default `step`|defaults to `step`/);
    });
  });

  describe("/cc orchestrator — Hop 4 honours runMode", () => {
    const body = renderStartCommand();

    it("documents both step (default) and auto modes in Hop 4", () => {
      expect(body).toMatch(/`step` mode \(default/);
      expect(body).toMatch(/`auto` mode \(autopilot/);
    });

    it("describes the four hard gates that ALWAYS pause, even in auto", () => {
      expect(body).toMatch(/block findings/i);
      expect(body).toMatch(/cap-reached/);
      expect(body).toMatch(/security-reviewer/);
      expect(body).toMatch(/About to run `ship`/);
    });

    it("persists runMode in the example triage block", () => {
      expect(body).toMatch(/"runMode": "step"/);
    });

    it("references the structured ask tools at Hop 2", () => {
      expect(body).toMatch(/AskUserQuestion/);
      expect(body).toMatch(/AskQuestion/);
    });

    it("updates the always-ask rules to acknowledge auto mode", () => {
      expect(body).toMatch(/In `step` mode, always pause/);
      expect(body).toMatch(/In `auto` mode, never auto-advance past a hard gate/);
    });
  });

  describe("/cc orchestrator — Hop 3 build has explicit parallel-build fan-out", () => {
    const body = renderStartCommand();

    it("describes the trigger conditions for parallel-build (planner topology + acMode strict + 2+ slices)", () => {
      expect(body).toMatch(/Parallel-build fan-out/);
      expect(body).toMatch(/topology: parallel-build/);
      expect(body).toMatch(/acMode == strict/);
    });

    it("draws the fan-out diagram with worktree paths and branches", () => {
      expect(body).toMatch(/git worktree add \.cclaw\/worktrees\/<slug>-s-1/);
      expect(body).toMatch(/cclaw\/<slug>\/s-1/);
      expect(body).toMatch(/reviewer \(mode=integration\)/);
    });

    it("caps parallelism at 5 slices (no waves)", () => {
      expect(body).toMatch(/capped at 5/);
      expect(body).toMatch(/More than 5 parallel slices is forbidden/);
    });

    it("documents the inline-fallback when sub-agent dispatch is unavailable", () => {
      expect(body).toMatch(/inline-fallback/);
    });

    it("autopilot does not skip the integration-reviewer ask on a block finding", () => {
      expect(body).toMatch(/`auto` runMode does \*\*not\*\* affect the integration-reviewer ask/);
    });
  });

  describe("tdd-cycle skill — vertical slicing, stop-the-line, prove-it, good-tests", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === "tdd-cycle");

    it("explains vertical slicing with a wrong vs right diagram", () => {
      expect(skill).toBeDefined();
      expect(skill!.body).toMatch(/Vertical slicing/);
      expect(skill!.body).toMatch(/WRONG \(horizontal\)/);
      expect(skill!.body).toMatch(/RIGHT \(vertical \/ tracer bullet\)/);
    });

    it("includes the stop-the-line rule with reproduce / root-cause / fix steps", () => {
      expect(skill!.body).toMatch(/Stop-the-line rule/);
      expect(skill!.body).toMatch(/Preserve evidence/);
      expect(skill!.body).toMatch(/Reproduce in isolation/);
      expect(skill!.body).toMatch(/Diagnose root cause/);
      expect(skill!.body).toMatch(/three attempts/);
    });

    it("includes the Prove-It pattern for bug fixes", () => {
      expect(skill!.body).toMatch(/Prove-It pattern/);
      expect(skill!.body).toMatch(/failing test that reproduces the bug/);
    });

    it("documents writing-good-tests rules (state-not-interactions, DAMP, real-over-mock, pyramid)", () => {
      expect(skill!.body).toMatch(/Test state, not interactions/);
      expect(skill!.body).toMatch(/DAMP over DRY/);
      expect(skill!.body).toMatch(/Prefer real implementations over mocks/);
      expect(skill!.body).toMatch(/Test pyramid/);
    });

    it("lists the new anti-patterns A-18 (horizontal), A-19 (push-past-fail), A-20 (over-mocking)", () => {
      expect(skill!.body).toMatch(/A-18/);
      expect(skill!.body).toMatch(/Horizontal slicing/);
      expect(skill!.body).toMatch(/A-19/);
      expect(skill!.body).toMatch(/Pushing past a failing test/);
      expect(skill!.body).toMatch(/A-20/);
      expect(skill!.body).toMatch(/Mocking what you should not mock/);
    });
  });

  describe("antipatterns library — A-13 / A-14 / A-15 added", () => {
    it("ships A-13 horizontal slicing", () => {
      expect(ANTIPATTERNS).toMatch(/## A-13 — Horizontal slicing/);
      expect(ANTIPATTERNS).toMatch(/One test → one implementation → repeat/);
    });

    it("ships A-14 pushing past a failing test", () => {
      expect(ANTIPATTERNS).toMatch(/## A-14 — Pushing past a failing test/);
      expect(ANTIPATTERNS).toMatch(/Stop the line/);
    });

    it("ships A-15 over-mocking", () => {
      expect(ANTIPATTERNS).toMatch(/## A-15 — Mocking what should not be mocked/);
      expect(ANTIPATTERNS).toMatch(/state-based assertions/);
    });
  });
});
