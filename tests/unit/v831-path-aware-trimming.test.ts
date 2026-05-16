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
  it("AC-1 — start-command body stays ≤ 79000 chars (v8.59 raised by 1500 chars for the Detect-hop extend-mode fork pointer + prior-context consumption pointer; v8.63 raised by 1000 chars for the slice / AC separation dispatch envelope clarifiers — `## Plan / Slices` + `## Acceptance Criteria (verification)` dual-table contract in the strict plan-stage desc and the per-slice TDD + `verify(AC-N): passing` envelope in the build-stage desc; v8.65 raised by 9000 chars for the multi-lens research orchestrator: 4-phase contract + lens dispatch envelope + lens-output schema + synthesis pass + handoff prompt — the full per-lens contracts live in .cclaw/lib/research-lenses/<lens>.md so the body only carries the orchestrator-side prose)", () => {
    expect(renderStartCommand().length).toBeLessThanOrEqual(79000);
  });

  it("AC-1 — start-command body stays ≤ 545 lines (v8.59 raised by 10 lines to absorb the Detect-hop extend-mode pointer + the v8.59 prior-context consumption pointer; matches the v8.22 line-budget raise in v822-orchestrator-slim.test.ts)", () => {
    expect(renderStartCommand().split("\n").length).toBeLessThanOrEqual(545);
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

  it("AC-2 — inline path budget = body alone, ≤ 79000 chars (v8.59 raised by 1500 chars; v8.63 raised by 1000 chars for slice / AC separation dispatch envelope clarifiers; v8.65 raised by 9000 chars for the multi-lens research orchestrator; see body-only budget above for rationale)", () => {
    expect(bodyBudget([])).toBeLessThanOrEqual(79000);
  });

  it("AC-2 — non-inline path budget = body + 6 runbooks, ≤ 132000 chars (v8.59 raised by 2000 chars: ~1500 chars body + ~500 chars extend-mode pointer; v8.63 raised by 1000 chars for slice / AC separation body bump; v8.65 raised by 9000 chars for the multi-lens research orchestrator's body prose riding into every dispatch)", () => {
    expect(bodyBudget(NON_INLINE_RUNBOOKS)).toBeLessThanOrEqual(132000);
  });

  it("AC-2 — large-risky path adds parallel-build / cap-reached / adversarial-rerun, ≤ 177000 chars (v8.59 raised by 2000 chars matching the non-inline path bump; v8.63 raised by 1000 chars matching the body bump; v8.65 raised by 9000 chars matching the multi-lens research orchestrator's body bump)", () => {
    const largeRisky = [
      ...NON_INLINE_RUNBOOKS,
      "parallel-build.md",
      "cap-reached-recovery.md",
      "adversarial-rerun.md"
    ];
    expect(bodyBudget(largeRisky)).toBeLessThanOrEqual(177000);
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
