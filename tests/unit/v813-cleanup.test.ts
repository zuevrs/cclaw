import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.13 power-and-economy release locks. Tripwire tests for the runtime
 * + prompt invariants we shipped in this release. Failures mean a future
 * change drifted away from the documented behaviour.
 */
describe("v8.13 power-and-economy", () => {
  describe("T0 speed + token wins", () => {
    it("planner dispatches research helpers in parallel (T0-6)", () => {
      const planner = SPECIALIST_PROMPTS["planner"];
      expect(planner).toMatch(/research dispatch \(parallel; one always, one conditional\)/u);
      expect(planner).toMatch(/same tool-call batch/u);
      expect(planner).toMatch(/do NOT serialise/u);
    });

    it("triage uses single multi-question call when available (T0-7)", () => {
      expect(START_COMMAND_BODY).toMatch(/Single tool call, two questions in one form/u);
      expect(START_COMMAND_BODY).toMatch(/Combining saves one user round-trip/u);
    });

    it("ship parallel reviewers receive shared parsed-diff (T0-8)", () => {
      expect(START_COMMAND_BODY).toMatch(/Shared diff context \(single parse pass\)/u);
      expect(START_COMMAND_BODY).toMatch(/Shared diff:/u);
    });

    it("discovery auto-skip heuristic exists for low-ambiguity large-risky (T0-9)", () => {
      expect(START_COMMAND_BODY).toMatch(/Discovery auto-skip \(low-ambiguity fast path\)/u);
      expect(START_COMMAND_BODY).toMatch(/triage\.confidence` is `high`/u);
    });
  });

  describe("T1 Plan stage power", () => {
    it("plan template requires per-AC dependsOn + rollback (T1-1)", () => {
      const plan = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;
      expect(plan.body).toMatch(/dependsOn:/u);
      expect(plan.body).toMatch(/rollback:/u);
      expect(plan.body).toMatch(/feasibility_stamp:/u);
    });

    it("planner enforces dependsOn acyclic graph in self-review (T1-1)", () => {
      const planner = SPECIALIST_PROMPTS["planner"];
      expect(planner).toMatch(/dependsOn` graph is acyclic/u);
      expect(planner).toMatch(/topological commit order/u);
    });

    it("planner emits feasibility_stamp green/yellow/red (T1-2)", () => {
      const planner = SPECIALIST_PROMPTS["planner"];
      expect(planner).toMatch(/feasibility_stamp/u);
      expect(planner).toMatch(/green.*yellow.*red/su);
      expect(planner).toMatch(/A `red` stamp blocks build dispatch/u);
    });

    it("planner reuses research artefacts across specialists (T1-14)", () => {
      const planner = SPECIALIST_PROMPTS["planner"];
      expect(planner).toMatch(/Cross-specialist research cache/u);
      expect(planner).toMatch(/must NOT re-dispatch/u);
    });
  });

  describe("T1 Build stage power", () => {
    it("slice-builder requires non-functional checks per AC (T1-3)", () => {
      const sb = SPECIALIST_PROMPTS["slice-builder"];
      expect(sb).toMatch(/Non-functional checks per AC/u);
      expect(sb).toMatch(/branch-coverage/u);
      expect(sb).toMatch(/perf-smoke/u);
    });

    it("slice-builder requires no-behavioural-delta evidence on refactor-only AC (T1-4)", () => {
      const sb = SPECIALIST_PROMPTS["slice-builder"];
      expect(sb).toMatch(/Refactor-only AC verdict/u);
      expect(sb).toMatch(/No-behavioural-delta:/u);
      expect(sb).toMatch(/anchored tests/u);
    });

    it("slice-builder forbids refactor while RED (T2-9 mattpocock pattern)", () => {
      const sb = SPECIALIST_PROMPTS["slice-builder"];
      expect(sb).toMatch(/never refactor while RED/u);
    });

    it("slice-builder enumerates refactor candidates (T2-9)", () => {
      const sb = SPECIALIST_PROMPTS["slice-builder"];
      expect(sb).toMatch(/Refactor candidate inventory/u);
      expect(sb).toMatch(/Duplication/u);
      expect(sb).toMatch(/Long methods/u);
      expect(sb).toMatch(/Primitive obsession/u);
    });

    it("parallel-build fallback is no longer silent (T1-5)", () => {
      expect(START_COMMAND_BODY).toMatch(/Parallel-build fallback \(T1-5\)/u);
      expect(START_COMMAND_BODY).toMatch(/explicit warning/u);
      expect(START_COMMAND_BODY).toMatch(/accept-fallback/u);
    });
  });

  describe("T1 Review stage power", () => {
    it("reviewer uses 7 axes including test-quality + complexity-budget (T1-6, T1-8)", () => {
      const r = SPECIALIST_PROMPTS["reviewer"];
      expect(r).toMatch(/Seven-axis review/u);
      expect(r).toMatch(/test-quality/u);
      expect(r).toMatch(/complexity-budget/u);
    });

    it("reviewer slim-summary axes counter has 7 letters (T1-6)", () => {
      const r = SPECIALIST_PROMPTS["reviewer"];
      expect(r).toMatch(/c=N tq=N r=N a=N cb=N s=N p=N/u);
    });

    it("orchestrator auto-detects security-sensitive surfaces (T1-7)", () => {
      expect(START_COMMAND_BODY).toMatch(/Auto-detect security-sensitive surfaces/u);
      expect(START_COMMAND_BODY).toMatch(/regardless of `security_flag`/u);
    });

    it("adversarial pre-mortem reruns on fix-only hot paths (T1-9)", () => {
      expect(START_COMMAND_BODY).toMatch(/Adversarial pre-mortem rerun on fix-only hot paths/u);
      expect(START_COMMAND_BODY).toMatch(/re-runs adversarial mode/u);
    });

    it("cap-reached produces split-plan recovery (T1-10)", () => {
      expect(START_COMMAND_BODY).toMatch(/Cap-reached split-plan/u);
      expect(START_COMMAND_BODY).toMatch(/Cap-reached recovery/u);
      expect(START_COMMAND_BODY).toMatch(/Recommended split/u);
    });
  });

  describe("T1 Ship stage power", () => {
    it("ship runbook requires CI smoke gate (T1-11)", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
      expect(ship.body).toMatch(/CI smoke gate/u);
      expect(ship.body).toMatch(/ci_smoke_passed/u);
    });

    it("ship runbook auto-generates release notes (T1-12)", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
      expect(ship.body).toMatch(/Release-notes auto-gen/u);
      expect(ship.body).toMatch(/AC↔commit evidence/u);
      expect(ship.body).toMatch(/release_notes_filled/u);
    });

    it("ship runbook surfaces learnings hard-stop on non-trivial slugs (T1-13)", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
      expect(ship.body).toMatch(/Learnings hard-stop/u);
      expect(ship.body).toMatch(/non-silent/u);
    });

    it("Victory Detector includes new mandatory conditions", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
      expect(ship.body).toMatch(/ci_smoke_passed = true/u);
      expect(ship.body).toMatch(/release_notes_filled = true/u);
      expect(ship.body).toMatch(/learnings_captured_or_explicitly_skipped/u);
    });
  });

  describe("T2 capabilities", () => {
    it("verification-loop skill is shipped as auto-trigger (T2-1)", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "verification-loop");
      expect(skill).toBeDefined();
      expect(skill!.body).toMatch(/build\/typecheck\/lint\/test\/security/u);
      expect(skill!.body).toMatch(/strict.*continuous.*diff-only/su);
    });

    it("HANDOFF.json + .continue-here.md schema is documented (T2-3)", () => {
      expect(START_COMMAND_BODY).toMatch(/Handoff artifacts \(T2-3/u);
      expect(START_COMMAND_BODY).toMatch(/HANDOFF\.json/u);
      expect(START_COMMAND_BODY).toMatch(/\.continue-here\.md/u);
      expect(START_COMMAND_BODY).toMatch(/idempotent rewrite/u);
    });

    it("compound-refresh sub-step is documented (T2-4)", () => {
      expect(START_COMMAND_BODY).toMatch(/Compound-refresh sub-step/u);
      expect(START_COMMAND_BODY).toMatch(/dedup.*keep.*update.*consolidate.*replace/su);
    });

    it("ship.md template carries 'what didn't work' section (T2-11)", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
      expect(ship.body).toMatch(/what didn't work/u);
    });

    it("discoverability self-check is documented (T2-12)", () => {
      expect(START_COMMAND_BODY).toMatch(/Discoverability self-check/u);
      expect(START_COMMAND_BODY).toMatch(/AGENTS\.md.*CLAUDE\.md.*README\.md/su);
    });
  });
});
