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
 * v8.13 power-and-economy release locks (slimmed in v8.54). One anchor
 * per shipped T-line; the per-axis sweeps are owned by their respective
 * specialist / template / runbook test files.
 */
describe("v8.13 power-and-economy (anchors)", () => {
  it("T0-6: ac-author dispatches research helpers in parallel", () => {
    expect(SPECIALIST_PROMPTS["ac-author"]).toMatch(/research dispatch \(parallel; one always, one conditional\)/u);
  });

  it("T0-8: ship-stage parallel reviewers share a parsed diff (v8.54: in handoff-gates runbook)", () => {
    const handoffGates = runbookBody("handoff-gates");
    expect(handoffGates).toMatch(/Shared diff/u);
    expect(START_COMMAND_BODY).toContain("handoff-gates.md");
  });

  it("T0-9: discovery auto-skip heuristic lives in the plan stage runbook (v8.54: merged from discovery.md)", () => {
    const plan = STAGE_PLAYBOOKS.find((p) => p.id === "plan")!;
    expect(plan.body).toMatch(/Discovery auto-skip/u);
    expect(plan.body).toMatch(/triage\.confidence` is `high`/u);
  });

  it("T1-1: plan template requires dependsOn + rollback + feasibility_stamp", () => {
    const plan = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;
    expect(plan.body).toMatch(/dependsOn:/u);
    expect(plan.body).toMatch(/rollback:/u);
    expect(plan.body).toMatch(/feasibility_stamp:/u);
  });

  it("T1-5: parallel-build fallback is explicit (no silent fall-through)", () => {
    expect(runbookBody("parallel-build")).toMatch(/Parallel-build fallback \(T1-5\)/u);
  });

  it("T1-6/T1-8: reviewer carries the multi-axis slim-summary counter", () => {
    expect(SPECIALIST_PROMPTS["reviewer"]).toMatch(/c=N tq=N r=N a=N cb=N s=N p=N/u);
  });

  it("T1-9: adversarial pre-mortem rerun has its own on-demand runbook", () => {
    expect(runbookBody("adversarial-rerun")).toMatch(/adversarial pre-mortem rerun/iu);
  });

  it("T1-10: cap-reached split-plan recovery is its own on-demand runbook", () => {
    expect(runbookBody("cap-reached-recovery")).toMatch(/Cap-reached split-plan/u);
  });

  it("T1-11/T1-12/T1-13: ship runbook enforces CI smoke + release-notes + learnings-hard-stop", () => {
    const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship")!;
    expect(ship.body).toMatch(/CI smoke gate/u);
    expect(ship.body).toMatch(/Release-notes auto-gen/u);
    expect(ship.body).toMatch(/Learnings hard-stop/u);
  });

  it("T2-1: tdd-and-verification skill ships as auto-trigger", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "tdd-and-verification");
    expect(skill?.body).toMatch(/build\/typecheck\/lint\/test\/security/u);
  });

  it("T2-3: HANDOFF.json + .continue-here.md schema lives in handoff-artifacts runbook", () => {
    expect(runbookBody("handoff-artifacts")).toMatch(/HANDOFF\.json/u);
  });

  it("T2-4 / T2-12: compound-refresh + discoverability self-check share one runbook", () => {
    const cr = runbookBody("compound-refresh");
    expect(cr).toMatch(/Compound-refresh sub-step/u);
    expect(cr).toMatch(/Discoverability self-check/u);
  });

  it("T3-3: two-reviewer per-task loop is named in the orchestrator body", () => {
    expect(START_COMMAND_BODY).toMatch(/Two-reviewer per-task loop \(T3-3/u);
  });
});
