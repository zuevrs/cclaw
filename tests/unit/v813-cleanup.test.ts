import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";

function runbookBody(id: string): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === id);
  if (!r) throw new Error(`No on-demand runbook with id=${id}`);
  return r.body;
}

/**
 * v8.13 power-and-economy release locks. Tripwire tests for the runtime
 * + prompt invariants we shipped in this release. Failures mean a future
 * change drifted away from the documented behaviour.
 */
describe("v8.13 power-and-economy", () => {
  describe("T0 speed + token wins", () => {
    it("ac-author dispatches research helpers in parallel (T0-6)", () => {
      const acAuthor = SPECIALIST_PROMPTS["ac-author"];
      expect(acAuthor).toMatch(/research dispatch \(parallel; one always, one conditional\)/u);
      expect(acAuthor).toMatch(/same tool-call batch/u);
      expect(acAuthor).toMatch(/do NOT serialise/u);
    });

    it("triage uses single multi-question call when available (T0-7)", () => {
      expect(START_COMMAND_BODY).toMatch(/Single tool call, TWO questions in one form/u);
      expect(START_COMMAND_BODY).toMatch(/Combining saves one round-trip per non-inline flow start/u);
    });

    it("ship parallel reviewers receive shared parsed-diff (T0-8; v8.22: in ship-gate runbook)", () => {
      const shipGate = runbookBody("ship-gate");
      expect(shipGate).toMatch(/Shared diff context \(single parse pass\)/u);
      expect(shipGate).toMatch(/Shared diff:/u);
      expect(START_COMMAND_BODY).toContain("ship-gate.md");
    });

    it("discovery auto-skip heuristic exists for low-ambiguity large-risky (T0-9; v8.22: in discovery runbook)", () => {
      const discovery = runbookBody("discovery");
      expect(discovery).toMatch(/Discovery auto-skip \(low-ambiguity fast path\)/u);
      expect(discovery).toMatch(/triage\.confidence` is `high`/u);
      expect(START_COMMAND_BODY).toContain("discovery.md");
    });
  });

  describe("T1 Plan stage power", () => {
    it("plan template requires per-AC dependsOn + rollback (T1-1)", () => {
      const plan = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;
      expect(plan.body).toMatch(/dependsOn:/u);
      expect(plan.body).toMatch(/rollback:/u);
      expect(plan.body).toMatch(/feasibility_stamp:/u);
    });

    it("ac-author enforces dependsOn acyclic graph in self-review (T1-1)", () => {
      const acAuthor = SPECIALIST_PROMPTS["ac-author"];
      expect(acAuthor).toMatch(/dependsOn` graph is acyclic/u);
      expect(acAuthor).toMatch(/topological commit order/u);
    });

    it("ac-author emits feasibility_stamp green/yellow/red (T1-2)", () => {
      const acAuthor = SPECIALIST_PROMPTS["ac-author"];
      expect(acAuthor).toMatch(/feasibility_stamp/u);
      expect(acAuthor).toMatch(/green.*yellow.*red/su);
      expect(acAuthor).toMatch(/A `red` stamp blocks build dispatch/u);
    });

    it("ac-author reuses research artefacts across specialists (T1-14)", () => {
      const acAuthor = SPECIALIST_PROMPTS["ac-author"];
      expect(acAuthor).toMatch(/Cross-specialist research cache/u);
      expect(acAuthor).toMatch(/must NOT re-dispatch/u);
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

    it("parallel-build fallback is no longer silent (T1-5; v8.22: in parallel-build runbook)", () => {
      const pb = runbookBody("parallel-build");
      expect(pb).toMatch(/Parallel-build fallback \(T1-5\)/u);
      expect(pb).toMatch(/explicit warning/u);
      expect(pb).toMatch(/accept-fallback/u);
      expect(START_COMMAND_BODY).toContain("parallel-build.md");
    });
  });

  describe("T1 Review stage power", () => {
    it("reviewer uses 7+ axes including test-quality + complexity-budget (T1-6, T1-8; v8.25 expanded to 8 axes; v8.48 expanded to 9 axes by adding edit-discipline; v8.52 expanded to 10 axes by adding qa-evidence, gated)", () => {
      const r = SPECIALIST_PROMPTS["reviewer"];
      expect(r).toMatch(/Ten-axis review|Nine-axis review|Eight-axis review|Seven-axis review/u);
      expect(r).toMatch(/test-quality/u);
      expect(r).toMatch(/complexity-budget/u);
    });

    it("reviewer slim-summary axes counter has the seven canonical letters (T1-6); v8.52 appended `qae=N`, gated on the qa-runner gate", () => {
      const r = SPECIALIST_PROMPTS["reviewer"];
      expect(r).toMatch(/c=N tq=N r=N a=N cb=N s=N p=N/u);
    });

    it("orchestrator auto-detects security-sensitive surfaces (T1-7)", () => {
      expect(START_COMMAND_BODY).toMatch(/Auto-detect security-sensitive surfaces/u);
      expect(START_COMMAND_BODY).toContain("regardless of `security_flag`");
    });

    it("adversarial pre-mortem reruns on fix-only hot paths (T1-9; v8.22: in adversarial-rerun runbook)", () => {
      const ar = runbookBody("adversarial-rerun");
      expect(ar).toMatch(/adversarial pre-mortem rerun/iu);
      expect(ar).toMatch(/once per ship attempt/u);
      expect(START_COMMAND_BODY).toContain("adversarial-rerun.md");
    });

    it("cap-reached produces split-plan recovery (T1-10; v8.22: in cap-reached-recovery runbook)", () => {
      const cr = runbookBody("cap-reached-recovery");
      expect(cr).toMatch(/Cap-reached split-plan/u);
      expect(cr).toMatch(/Cap-reached recovery/u);
      expect(cr).toMatch(/Recommended split/u);
      expect(START_COMMAND_BODY).toContain("cap-reached-recovery.md");
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
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification");
      expect(skill).toBeDefined();
      expect(skill!.body).toMatch(/build\/typecheck\/lint\/test\/security/u);
      expect(skill!.body).toMatch(/strict.*continuous.*diff-only/su);
    });

    it("HANDOFF.json + .continue-here.md schema is documented (T2-3; v8.22: in handoff-artifacts runbook)", () => {
      const ha = runbookBody("handoff-artifacts");
      expect(ha).toMatch(/HANDOFF\.json/u);
      expect(ha).toMatch(/\.continue-here\.md/u);
      expect(ha).toMatch(/idempotent/u);
      expect(START_COMMAND_BODY).toContain("handoff-artifacts.md");
      expect(START_COMMAND_BODY).toContain("HANDOFF.json");
      expect(START_COMMAND_BODY).toContain(".continue-here.md");
    });

    it("compound-refresh sub-step is documented (T2-4; v8.22: in compound-refresh runbook)", () => {
      const cr = runbookBody("compound-refresh");
      expect(cr).toMatch(/Compound-refresh sub-step/u);
      expect(cr).toMatch(/dedup.*keep.*update.*consolidate.*replace/su);
      expect(START_COMMAND_BODY).toContain("compound-refresh.md");
    });

    it("ship.md template carries 'what didn't work' section (T2-11)", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
      expect(ship.body).toMatch(/what didn't work/u);
    });

    it("discoverability self-check is documented (T2-12; v8.22: in compound-refresh runbook)", () => {
      const cr = runbookBody("compound-refresh");
      expect(cr).toMatch(/Discoverability self-check/u);
      expect(cr).toMatch(/AGENTS\.md.*CLAUDE\.md.*README\.md/su);
      expect(START_COMMAND_BODY).toContain("compound-refresh.md");
    });

    it("TDD-cycle skill carries anti-rationalization table (T2-8)", () => {
      const tdd = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification")!;
      expect(tdd.body).toMatch(/Anti-rationalization table/u);
      expect(tdd.body).toMatch(/rationalization \| truth/u);
    });
  });

  describe("T3 architectural foundations", () => {
    it("config exposes ModelPreferences for category-based routing (T3-2)", async () => {
      const mod = await import("../../src/config.js");
      const sample: import("../../src/config.js").CclawConfig = {
        version: "8.13.0",
        flowVersion: "8",
        harnesses: ["claude-code"],
        hooks: { profile: "default" },
        modelPreferences: {
          brainstormer: "fast",
          architect: "powerful",
          "ac-author": "balanced",
        },
      };
      expect(sample.modelPreferences?.architect).toBe("powerful");
      expect(typeof mod).toBe("object");
    });

    it("namespace router routes are documented (T3-1, gsd pattern)", () => {
      expect(START_COMMAND_BODY).toMatch(/Namespace router \(T3-1/u);
      expect(START_COMMAND_BODY).toMatch(/\/cc-plan/u);
      expect(START_COMMAND_BODY).toMatch(/\/cc-build/u);
      expect(START_COMMAND_BODY).toMatch(/\/cc-review/u);
      expect(START_COMMAND_BODY).toMatch(/\/cc-ship/u);
    });

    it("two-reviewer per-task loop is documented (T3-3, obra pattern)", () => {
      expect(START_COMMAND_BODY).toMatch(/Two-reviewer per-task loop \(T3-3/u);
      expect(START_COMMAND_BODY).toMatch(/spec-review/u);
      expect(START_COMMAND_BODY).toMatch(/code-quality-review/u);
      expect(START_COMMAND_BODY).toMatch(/spec-block.*skips Pass 2/su);
    });
  });
});
