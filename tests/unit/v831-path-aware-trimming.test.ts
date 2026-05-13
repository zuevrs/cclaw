import { describe, expect, it } from "vitest";

import {
  renderStartCommand,
  START_COMMAND_BODY
} from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";

/**
 * v8.31 — path-aware orchestrator trimming.
 *
 * The five-audit flow-complexity review (cclaw v8.29 vs flow-complexity audit)
 * found ~2-3K tokens of large-risky-only / non-inline-only content still
 * inlined in `start-command.ts` that loads on every `/cc` invocation,
 * including inline / trivial paths that never reach those mechanics. v8.22
 * lifted ten on-demand runbooks but stopped short of path-conditional
 * gating; v8.31 closes the gap.
 *
 * Two new on-demand runbooks own the lifted content:
 *
 * - `pause-resume.md` — Hop 4 step/auto mode mechanics, Confidence-as-hard-gate
 *   table, common-rules-for-both-modes block. Triggered on every stage exit
 *   when `triage.path` is non-inline (inline trivial has `runMode: null` and
 *   never pauses).
 * - `plan-small-medium.md` — Plan-stage-on-small/medium dispatch contract
 *   (ac-author + pre-author research order, input/output spec, slim summary).
 *   Triggered when `triage.complexity == "small-medium"` AND `plan` in path.
 *
 * Both runbooks are pointers from the body's trigger table; the body keeps
 * the orchestrator-wide invariants (`/cc` is the only resume verb, end-of-turn
 * is the pause mechanism, Confidence: low is a hard gate in both modes) so
 * the v8.11 / v8.14 / v8.22 tripwires stay green. Observable behaviour
 * (specialist dispatches per path) is identical pre- and post-v8.31.
 *
 * The per-path budget assertions formalise the audit's finding: inline reads
 * the body only (zero runbooks); small-medium opens a strict subset of
 * runbooks; large-risky opens the largest superset (discovery + parallel-build
 * + cap-reached + adversarial-rerun). Z > Y > X by construction.
 */

const RUNBOOK_INDEX: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const r of ON_DEMAND_RUNBOOKS) {
    map[r.fileName] = r.body;
  }
  return map;
})();

function runbookBody(fileName: string): string {
  const body = RUNBOOK_INDEX[fileName];
  if (body === undefined) {
    throw new Error(`runbook not registered: ${fileName}`);
  }
  return body;
}

function pathBudget(runbookFiles: string[]): number {
  const body = START_COMMAND_BODY.length;
  const runbooks = runbookFiles.reduce(
    (acc, name) => acc + runbookBody(name).length,
    0
  );
  return body + runbooks;
}

const INLINE_RUNBOOKS: string[] = [];

// v8.42 — critic-stage.md is opened on every `review → critic` transition
// when triage.path includes "critic" (every non-inline path). Both
// small-medium and large-risky open it.
const SMALL_MEDIUM_RUNBOOKS: string[] = [
  "dispatch-envelope.md",
  "handoff-artifacts.md",
  "self-review-gate.md",
  "ship-gate.md",
  "compound-refresh.md",
  "pause-resume.md",
  "plan-small-medium.md",
  "critic-stage.md"
];

const LARGE_RISKY_RUNBOOKS: string[] = [
  ...SMALL_MEDIUM_RUNBOOKS.filter((f) => f !== "plan-small-medium.md"),
  "discovery.md",
  "parallel-build.md",
  "cap-reached-recovery.md",
  "adversarial-rerun.md"
];

describe("v8.31 path-aware orchestrator trimming — body-only budget", () => {
  it("AC-1 — orchestrator body alone is ≤ 48000 chars (was 45212 on v8.30; v8.42 lifted to absorb the Hop 4.5 critic stage pointer)", () => {
    const charCount = renderStartCommand().length;
    expect(
      charCount,
      `start-command body is ${charCount} chars (budget 48000). v8.31 lifted Hop 4 pause/resume detail + plan-stage-on-small/medium into on-demand runbooks; v8.34 added ~2K chars for the mid-flight runMode toggle; v8.42 added ~2K chars for the new critic stage pointer (~95% of the new content is lifted to critic-stage.md runbook). Future slugs may tighten further by lifting the Two-reviewer per-task loop block (large-risky-only) or the slim-summary enum prose; v8.31/v8.34/v8.42 stop here to keep v8.24 / v8.21 tripwires unmodified.`
    ).toBeLessThanOrEqual(48000);
  });

  it("AC-1 — orchestrator body alone is ≤ 485 lines (was 472 on v8.30; v8.42 absorbed ~5 lines for the new Hop 4.5 critic stage pointer)", () => {
    const lineCount = renderStartCommand().split("\n").length;
    expect(
      lineCount,
      `start-command body is ${lineCount} lines (budget 485). v8.22 budget was 480; v8.31 tightened to 435; v8.34 lifted to 450 to absorb the mid-flight runMode toggle section (~14 lines, orchestrator-wide); v8.42 lifted to 485 for the new Hop 4.5 critic stage pointer (~5-bullet block; remainder is in critic-stage.md).`
    ).toBeLessThanOrEqual(485);
  });

  it("AC-1 — orchestrator body alone stays within ≤107% of v8.30 baseline (one new stage + descriptive stage names)", () => {
    const v830CharBaseline = 45212;
    const charCount = renderStartCommand().length;
    const ratio = charCount / v830CharBaseline;
    expect(
      ratio,
      `body is ${charCount} chars, ratio ${ratio.toFixed(3)} of v8.30 baseline (${v830CharBaseline}). v8.31's win was ~7.8% cut; v8.34 + v8.40 spent some on the runMode toggle and git-log inspection prose; v8.42 added the new critic stage (~2K chars body + ~7K chars runbook); v8.45 traded the compact "Hop N" labels for descriptive stage names (~40 chars net). The body should stay within ~7% of v8.30 (one new stage costs ~5% growth; readable headings cost ~1% more). Future re-growth past this ratio is a signal to lift more content to runbooks.`
    ).toBeLessThanOrEqual(1.07);
  });
});

describe("v8.31 path-aware orchestrator trimming — per-path budget envelopes", () => {
  it("AC-2 — inline-path budget = body only; ≤ 48000 chars (v8.42 lifted to absorb the Hop 4.5 critic stage pointer)", () => {
    const budget = pathBudget(INLINE_RUNBOOKS);
    expect(
      budget,
      `inline path reads the orchestrator body and nothing else (no specialist dispatches). budget = body alone = ${budget} chars; ceiling 48000 (v8.31 = 42500 + v8.34 toggle docs + v8.42 critic stage pointer; inline does NOT open critic-stage.md since triage.path == ["build"] on inline).`
    ).toBeLessThanOrEqual(48000);
  });

  it("AC-2 — small-medium-path budget = body + 8 runbooks; ≤ 115000 chars (v8.42 added critic-stage.md)", () => {
    const budget = pathBudget(SMALL_MEDIUM_RUNBOOKS);
    expect(
      budget,
      `small-medium path reads the body + dispatch-envelope, handoff-artifacts, self-review-gate, ship-gate, compound-refresh, pause-resume, plan-small-medium, critic-stage (v8.42). budget = ${budget} chars; ceiling 115000.`
    ).toBeLessThanOrEqual(115000);
  });

  it("AC-2 — large-risky-path budget = body + 11 runbooks; ≤ 155000 chars (v8.42 added critic-stage.md)", () => {
    const budget = pathBudget(LARGE_RISKY_RUNBOOKS);
    expect(
      budget,
      `large-risky path reads the body + small-medium's set (minus plan-small-medium) + discovery, parallel-build, cap-reached-recovery, adversarial-rerun + critic-stage (v8.42). budget = ${budget} chars; ceiling 155000.`
    ).toBeLessThanOrEqual(155000);
  });

  it("AC-2 — strict ordering: large-risky > small-medium > inline", () => {
    const inlineBudget = pathBudget(INLINE_RUNBOOKS);
    const smallMediumBudget = pathBudget(SMALL_MEDIUM_RUNBOOKS);
    const largeRiskyBudget = pathBudget(LARGE_RISKY_RUNBOOKS);
    expect(
      smallMediumBudget,
      "small-medium MUST read strictly more material than inline"
    ).toBeGreaterThan(inlineBudget);
    expect(
      largeRiskyBudget,
      "large-risky MUST read strictly more material than small-medium"
    ).toBeGreaterThan(smallMediumBudget);
  });
});

describe("v8.31 path-aware orchestrator trimming — new runbooks exist and are wired", () => {
  it("AC-3 — `pause-resume.md` is registered in ON_DEMAND_RUNBOOKS", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "pause-resume.md");
    expect(r, "pause-resume.md must be present in ON_DEMAND_RUNBOOKS").toBeDefined();
    expect(r!.body.length, "pause-resume.md body cannot be empty").toBeGreaterThan(800);
    expect(
      r!.body,
      "pause-resume.md should open with the on-demand runbook heading prefix"
    ).toMatch(/^# On-demand runbook — /m);
  });

  it("AC-3 — `plan-small-medium.md` is registered in ON_DEMAND_RUNBOOKS", () => {
    const r = ON_DEMAND_RUNBOOKS.find(
      (rb) => rb.fileName === "plan-small-medium.md"
    );
    expect(
      r,
      "plan-small-medium.md must be present in ON_DEMAND_RUNBOOKS"
    ).toBeDefined();
    expect(r!.body.length, "plan-small-medium.md body cannot be empty").toBeGreaterThan(
      500
    );
    expect(
      r!.body,
      "plan-small-medium.md should open with the on-demand runbook heading prefix"
    ).toMatch(/^# On-demand runbook — /m);
  });

  it("AC-3 — orchestrator body references `pause-resume.md` from the trigger table", () => {
    const body = renderStartCommand();
    expect(
      body,
      "body must reference `pause-resume.md` so the orchestrator opens it on the path-conditional trigger"
    ).toContain("pause-resume.md");
  });

  it("AC-3 — orchestrator body references `plan-small-medium.md` from the trigger table", () => {
    const body = renderStartCommand();
    expect(
      body,
      "body must reference `plan-small-medium.md` so the orchestrator opens it when small-medium plan dispatches"
    ).toContain("plan-small-medium.md");
  });

  it("AC-3 — trigger table names path-conditional gating explicitly (`small-medium` and non-inline)", () => {
    const body = renderStartCommand();
    expect(
      body,
      "the trigger table should name `triage.complexity == \"small-medium\"` as the gating predicate for plan-small-medium.md"
    ).toMatch(/triage\.complexity == "small-medium"/);
  });
});

describe("v8.31 path-aware orchestrator trimming — content lifted, contract preserved", () => {
  it("AC-4 — orchestrator body still names `/cc` as the single resume verb (v8.11 invariant)", () => {
    const body = renderStartCommand();
    expect(body, "v8.11 invariant: `/cc` is the only resume verb").toMatch(
      /`\/cc`\s+is the (only|single|canonical) resume/iu
    );
  });

  it("AC-4 — orchestrator body still tells the agent to `End your turn` in step mode (v8.11 invariant)", () => {
    const body = renderStartCommand();
    expect(body, "v8.11 invariant: step mode = end-of-turn").toMatch(/End your turn/);
  });

  it("AC-4 — orchestrator body still names the `single resume mechanism` (v8.11 invariant)", () => {
    const body = renderStartCommand();
    expect(body, "v8.11 invariant: single resume mechanism").toMatch(
      /single resume mechanism/i
    );
  });

  it("AC-4 — orchestrator body still has the Pause and resume section (start-command.test invariant)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/^## Pause and resume$/m);
  });

  it("AC-4 — orchestrator body still names `Confidence: low` as a hard gate in both modes", () => {
    const body = renderStartCommand();
    expect(
      body,
      "Confidence: low is a hard gate in both step and auto modes; the body keeps the gate-name invariant even after lifting the detailed table to the runbook"
    ).toMatch(/Confidence:\s*low/);
  });

  it("AC-4 — orchestrator body still names ac-author + plan-authoring wrapper for small-medium plan (v8.14 invariant)", () => {
    const body = renderStartCommand();
    expect(
      body,
      "v8.14 invariant: ac-author is the small-medium plan specialist; plan-authoring is the wrapper. Even after lifting the input/output detail to plan-small-medium.md the body keeps the specialist mapping."
    ).toMatch(/ac-author/);
    expect(body).toMatch(/plan-authoring/);
  });

  it("AC-4 — orchestrator body still names large-risky plan as design → ac-author sub-phase (v8.14 invariant)", () => {
    const body = renderStartCommand();
    expect(body, "v8.14 invariant: large-risky plan expands to design → ac-author").toMatch(
      /design.*main context.*multi-?turn/iu
    );
    expect(body).toMatch(/ac-author.*sub-?agent/iu);
  });
});

describe("v8.31 path-aware orchestrator trimming — lifted content moved to runbooks, not deleted", () => {
  it("AC-5 — full `step` mode mechanics (HANDOFF.json + End-your-turn + magic word) live in pause-resume.md", () => {
    const body = runbookBody("pause-resume.md");
    expect(body).toMatch(/`step` mode/i);
    expect(body).toMatch(/End your turn/);
    expect(body).toMatch(/HANDOFF\.json/);
    expect(body).toMatch(/single resume mechanism/i);
  });

  it("AC-5 — full `auto` mode hard-gate list lives in pause-resume.md", () => {
    const body = runbookBody("pause-resume.md");
    expect(body).toMatch(/`auto` mode/i);
    expect(body).toMatch(/hard gates?/i);
    expect(body).toMatch(/cap-reached/);
    expect(body).toMatch(/`Confidence: low`/);
  });

  it("AC-5 — Confidence-as-hard-gate table (step / auto columns) lives in pause-resume.md", () => {
    const body = runbookBody("pause-resume.md");
    expect(
      body,
      "the Confidence-as-hard-gate table should live in the runbook so the orchestrator opens it only when a slim summary lands with a non-`high` confidence"
    ).toMatch(/\| Confidence \| step mode \| auto mode \|/);
    expect(body, "table must enumerate the three confidence levels").toMatch(/`high`/);
    expect(body).toMatch(/`medium`/);
    expect(body).toMatch(/`low`/);
  });

  it("AC-5 — plan-small-medium runbook covers ac-author input/output + research order", () => {
    const body = runbookBody("plan-small-medium.md");
    expect(body).toMatch(/ac-author/i);
    expect(body).toMatch(/learnings-research/);
    expect(body).toMatch(/repo-research/);
    expect(body).toMatch(/brownfield/i);
    expect(body).toMatch(/touch surface|touchSurface/i);
  });

  it("AC-5 — pause-resume body declares its path-conditional trigger explicitly", () => {
    const body = runbookBody("pause-resume.md");
    expect(
      body,
      "the runbook should name when it fires (every stage exit when triage.path is non-inline) so a reader knows whether to open it"
    ).toMatch(/triage\.path|non-?inline|inline path/i);
  });

  it("AC-5 — plan-small-medium body declares its path-conditional trigger explicitly", () => {
    const body = runbookBody("plan-small-medium.md");
    expect(
      body,
      "the runbook should name its gating predicate (small-medium complexity, plan stage)"
    ).toMatch(/small-medium/);
  });
});
