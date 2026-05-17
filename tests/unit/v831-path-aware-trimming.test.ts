import { describe, expect, it } from "vitest";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import {
  renderStartCommand,
  START_COMMAND_BODY
} from "../../src/content/start-command.js";

/**
 * v8.31 path-aware orchestrator trimming — slimmed in v8.54.
 *
 * v8.54 merged 4 pairs of runbooks (handoff-gates, critic-steps) and
 * lifted 2 (discovery, plan-small-medium) into stage-playbooks PLAN_PLAYBOOK,
 * so the per-path budget shape changed. The tests below preserve the
 * structural invariant ("body stays small; runbooks carry per-path
 * content") without re-enumerating every individual runbook ceiling.
 */

const RUNBOOK_BY_FILENAME: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const r of ON_DEMAND_RUNBOOKS) map[r.fileName] = r.body;
  return map;
})();

function bodyBudget(fileNames: string[]): number {
  return (
    START_COMMAND_BODY.length +
    fileNames.reduce((acc, name) => acc + (RUNBOOK_BY_FILENAME[name]?.length ?? 0), 0)
  );
}

describe("v8.31 path-aware orchestrator — body-only budget", () => {
  it("AC-1 — start-command body stays ≤ 135000 chars (... v8.74 raised by 2000 chars for the ethos preamble + cross-model trigger language; v8.76 raised by 12000 chars to absorb the Phase 1.5 Approaches Gate prose + the rewritten Phase 2 lens-dispatch prose (design-signal heuristic + `--lens=design` / `--lens=-design` flags + the new `research-design` lens row + the new `Framing:` envelope field); v8.77 raised by 17000 chars to absorb the Debug-branch routing section + the #### investigator stage details + the investigator stage-table row + the v8.77 footnote on plan; v8.79 raised by 10000 chars to absorb the new One-way Door Gate section under Dispatch — structured-ask payload, three-option picker, flow-state transitions, lite-ceremony exemption + the new `awaiting-one-way-confirmation` enum value documented in the slim-summary contract and hard-gate logic)", () => {
    expect(renderStartCommand().length).toBeLessThanOrEqual(135000);
  });

  it("AC-1 — start-command body stays ≤ 800 lines (... v8.74 raised by 5 lines for the ethos-preamble + Skills-attached bullet; v8.75 raised by 30 lines for the #### plan-design body section + SPECIALISTS roster + stage-table row; v8.76 raised by 50 lines for the new #### Phase 1.5 — approaches gate section (procedure + sub-cases + worked example) and the rewritten Phase 2 dispatch prose (design-signal heuristic + lens-toggle flags + new research-design row + `Framing:` envelope); v8.77 raised by 75 lines for the Debug-branch routing section + the #### investigator stage details + the investigator stage-table row + the v8.77 footnote on plan; v8.78 raised by 80 lines for the rewritten Phase 1 iterative discovery dialogue with per-dimension scoring — the four-dimension table (goal/constraints/criteria/context), the ambiguity formula, the weakest-dimension targeting rule, the challenge-mode rotation (Contrarian round 4 / Simplifier round 5), the per-round table, the math-gated exit threshold (ambiguity < 0.25), the `/cc research go` force-exit sub-command + invocation-matrix row)", () => {
    expect(renderStartCommand().split("\n").length).toBeLessThanOrEqual(800);
  });
});

describe("v8.31 path-aware orchestrator — per-path envelopes (v8.54: budgets unchanged after merges)", () => {
  // The merged runbooks (handoff-gates, critic-steps) replace two
  // separate files each, so we expect the budget to be roughly the same
  // (their content was simply unioned). The lifted plan-small-medium /
  // discovery move to PLAN_PLAYBOOK in stage-playbooks, which is read
  // from disk, not the on-demand runbooks set.

  const NON_INLINE_RUNBOOKS = [
    "dispatch-envelope.md",
    "handoff-artifacts.md",
    "handoff-gates.md",
    "compound-refresh.md",
    "pause-resume.md",
    "critic-steps.md"
  ];

  it("AC-2 — inline path budget = body alone, ≤ 135000 chars (... v8.74 raised by 2000 chars matching the body-only budget bump; v8.76 raised by 12000 chars matching the body-only budget bump for the Phase 1.5 Approaches Gate + Phase 2 dispatch rewrite + design lens row + `Framing:` envelope field; v8.77 raised by 17000 chars matching the body-only budget bump for the Debug-branch routing section + investigator stage details; v8.79 raised by 10000 chars matching the body-only budget bump for the One-way Door Gate section + the new `awaiting-one-way-confirmation` enum value)", () => {
    expect(bodyBudget([])).toBeLessThanOrEqual(135000);
  });

  it("AC-2 — non-inline path budget = body + 6 runbooks, ≤ 180000 chars (... v8.75 raised by 9000 chars matching the body bump for the new #### plan-design section; v8.76 raised by 12000 chars matching the body bump for the Phase 1.5 Approaches Gate + Phase 2 dispatch rewrite + design lens row; v8.77 raised by 20000 chars for the body bump + the new runbooks/debug-branch.md runbook being included in the non-inline budget set)", () => {
    expect(bodyBudget(NON_INLINE_RUNBOOKS)).toBeLessThanOrEqual(180000);
  });

  it("AC-2 — large-risky path adds parallel-build / cap-reached / adversarial-rerun, ≤ 205000 chars (... v8.75 raised by 9000 chars matching the non-inline path bump; v8.76 raised by 12000 chars matching the non-inline path bump for the body-only v8.76 deliverables)", () => {
    const largeRisky = [
      ...NON_INLINE_RUNBOOKS,
      "parallel-build.md",
      "cap-reached-recovery.md",
      "adversarial-rerun.md"
    ];
    expect(bodyBudget(largeRisky)).toBeLessThanOrEqual(205000);
  });

  it("AC-2 — strict ordering: large-risky > non-inline > inline (per-path adds material)", () => {
    expect(bodyBudget(NON_INLINE_RUNBOOKS)).toBeGreaterThan(bodyBudget([]));
    expect(
      bodyBudget([...NON_INLINE_RUNBOOKS, "parallel-build.md", "cap-reached-recovery.md"])
    ).toBeGreaterThan(bodyBudget(NON_INLINE_RUNBOOKS));
  });
});

describe("v8.31 path-aware orchestrator — pause-resume runbook is wired (anchor)", () => {
  it("AC-3 — pause-resume runbook exists with the on-demand heading prefix", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "pause-resume.md");
    expect(r?.body).toMatch(/^# On-demand runbook — /m);
  });

  it("AC-3 — start-command body references pause-resume.md from the trigger table", () => {
    expect(renderStartCommand()).toContain("pause-resume.md");
  });

  it("AC-3 — start-command body references the plan stage runbook for small-medium and large-risky", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/triage\.complexity == "small-medium"/);
    expect(body).toMatch(/triage\.complexity == "large-risky"/);
  });
});

describe("v8.31 path-aware orchestrator — lifted content preserved in PLAN_PLAYBOOK (v8.54)", () => {
  const PLAN_PLAYBOOK = STAGE_PLAYBOOKS.find((p) => p.id === "plan")!.body;

  it("AC-5 — plan playbook covers architect input/output + research order (v8.62 — `ac-author` renamed to `architect`, absorbing dead `design`'s Phase 0/2-6 work; the plan-stage runbook still covers the same surfaces)", () => {
    expect(PLAN_PLAYBOOK).toMatch(/architect/);
    expect(PLAN_PLAYBOOK).toMatch(/learnings-research/);
    expect(PLAN_PLAYBOOK).toMatch(/repo-research/);
    expect(PLAN_PLAYBOOK).toMatch(/brownfield/i);
    expect(PLAN_PLAYBOOK).toMatch(/touchSurface/);
  });

  it("AC-5 — plan playbook covers the large-risky architect ceremony depth (v8.62 unified flow retired the discovery sub-phase + the auto-skip heuristic; the architect's Frame/Approaches/Decisions/Pre-mortem/Compose phases scale via ceremonyMode = strict)", () => {
    expect(PLAN_PLAYBOOK).toMatch(/architect ceremony depth/);
    expect(PLAN_PLAYBOOK).toMatch(/Bootstrap[^a-z]+Frame[^a-z]+Approaches[^a-z]+Decisions[^a-z]+Pre-mortem[^a-z]+Compose/u);
    expect(PLAN_PLAYBOOK).not.toMatch(/Discovery auto-skip/);
    expect(PLAN_PLAYBOOK).not.toMatch(/main context.*multi-turn/iu);
  });

  it("AC-5 — pause-resume runbook still carries the Confidence-as-hard-gate prose (v8.61: collapsed from a step/auto table into an always-auto bullet list)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "pause-resume.md")!.body;
    // v8.61 collapsed the step/auto distinction; the Confidence hard-gate
    // contract now lives as a bullet list under "Confidence as a hard gate
    // (always-auto)". The semantic invariant (high → chain, medium → render
    // + chain, low → hard gate) is preserved.
    expect(r).toMatch(/Confidence as a hard gate/);
    expect(r).toMatch(/`low`.*hard gate/u);
  });
});
