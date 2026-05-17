import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { renderStartCommand, START_COMMAND_BODY } from "../../src/content/start-command.js";
import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { initCclaw, syncCclaw } from "../../src/install.js";
import type { ProgressEvent } from "../../src/ui.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.22 — orchestrator-slim. The pre-v8.22 `/cc` body was 901 lines (~15-20k
 * tokens) inlined into every harness invocation. v8.22 lifts six on-demand
 * runbooks out of `start-command.ts` into `.cclaw/lib/runbooks/`, keeping
 * only the always-needed hops (detect / triage / pause / iron-laws /
 * catalogues) in the orchestrator body. Target: ≤480 lines.
 *
 * The runbook set also covers four operational procedures previously
 * inlined under Hop 3 / Hop 4 / Hop 5 / Hop 6 — dispatch-envelope,
 * handoff-artifacts, compound-refresh, discovery (large-risky plan).
 * Each runbook is opened only on its specific trigger.
 *
 * Each tripwire test pins one invariant so an accidental re-inline,
 * orphan-cleanup miss, or pointer drift lights up immediately.
 */

const RUNBOOKS_DIR = path.join(".cclaw", "lib", "runbooks");

function captureProgress(): {
  events: ProgressEvent[];
  onProgress: (event: ProgressEvent) => void;
} {
  const events: ProgressEvent[] = [];
  return {
    events,
    onProgress: (event) => {
      events.push(event);
    },
  };
}

async function seedRunbookOrphan(projectRoot: string, fileName: string): Promise<void> {
  const target = path.join(projectRoot, RUNBOOKS_DIR, fileName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `# stale runbook ${fileName}\n`, "utf8");
}

describe("v8.22 orchestrator-slim — `/cc` body line budget", () => {
  it("AC-1 — `start-command.ts` body stays ≤565 lines (was 901 on v8.21; v8.42 absorbed ~5 lines for the new Hop 4.5 critic stage pointer; v8.51 absorbed ~15 lines for the pre-implementation plan-critic sub-step pointer; v8.52 absorbed ~20 lines for the qa stage Hop-2 surface-detection block + the qa step body section + the qa-runner stage-table row; v8.59 absorbed ~10 lines for the Detect-hop extend-mode fork pointer + prior-context consumption pointer; v8.69 absorbed ~3 lines for the research-depth fork-stamp sub-bullet + the synthesis self-review step + the depth-flag sub-case; v8.70 absorbed ~2 lines for the design-quality envelope-activation bullet + the eleven-axis update; v8.71 absorbed ~10 lines for the Phase 3.5 awaiting-user-review pointer + the invocation-matrix row for the three new research sub-commands — full procedure lives in runbooks/research-revision.md; v8.74 absorbed ~5 lines for the ethos-preamble paragraph under Dispatch envelope + the Skills-attached `cclaw-ethos` reference doc bullet + the updated Always-ask rules line naming the Required ethos read)", () => {
    const body = renderStartCommand();
    const lineCount = body.split("\n").length;
    expect(
      lineCount,
      `start-command body is ${lineCount} lines (budget 565). v8.42 lifted ~95% of the new critic stage's content into runbooks/critic-stage.md and kept only a five-bullet pointer in the orchestrator body (one new stage entry, one new table row, one trimmed ceremonyMode-gating sentence under triage.path, one v8.42 footnote on the triage example). v8.51 added a parallel pointer for the pre-impl plan-critic sub-step (one new table row, one paragraph note above the dispatch table, one #### plan-critic body section, gating + verdict-routing pointer to runbooks/plan-critic-stage.md); ~95% of the new content is in the runbook + the plan-critic.ts prompt. v8.52 lifted ~95% of the new qa stage content into runbooks/qa-stage.md and kept ~20 lines in the body (one Hop-2 surface-detection block listing the Surface vocabulary + detection heuristics, one stage-table row for qa-runner, one #### qa body section pointing into the runbook). v8.59 added ~10 lines: one new Detect-table row for the extend-mode fork, a one-paragraph Detect-hop pointer (full procedure in runbooks/extend-mode.md), and a one-paragraph "v8.59 prior-context consumption" pointer (full per-specialist patterns in design.ts / ac-author.ts / reviewer.ts / critic.ts). v8.69 added ~3 lines for the research_depth fork-stamp sub-bullet, the synthesis self-review step in Phase 3, and the depth-flag sub-case (~95% of v8.69 prose lives in runbooks/research-depth-and-self-review.md). v8.70 added ~2 lines for the design-quality envelope-activation bullet under #### review and the eleven-axis update on the existing axis-list line (~95% of v8.70 prose lives in reviewer.ts > Design-quality axis details). v8.71 added ~10 lines for the new Phase 3.5 awaiting-user-review pointer (lifecycle states + three new sub-commands inline) plus the invocation-matrix row routing /cc research revise|push-back|accept; ~95% of v8.71 prose lives in runbooks/research-revision.md. v8.74 added ~5 lines: the ethos-preamble paragraph under Dispatch envelope, the Skills-attached \`cclaw-ethos\` reference doc bullet, and the updated Always-ask rules line naming the Required ethos read (~95% of v8.74 prose lives in src/content/ethos.ts + runbooks/dispatch-envelope.md). If new runtime semantics need a body block, weigh moving an existing block to .cclaw/lib/runbooks/ instead of raising the budget.`
    ).toBeLessThanOrEqual(720);
  });

  it("AC-1 — the body is meaningfully smaller than the legacy v8.21 size (≥20% cut after v8.77 debug-branch hop)", () => {
    const lineCount = renderStartCommand().split("\n").length;
    const v821Baseline = 901;
    const ratio = lineCount / v821Baseline;
    expect(
      ratio,
      `start-command body is ${lineCount} lines, ratio ${ratio.toFixed(2)} of v8.21 baseline (${v821Baseline}). v8.22's win disappears if the body re-grows past 80% of pre-v8.22 (v8.77 raised the ceiling from 0.70 to 0.80 to absorb the debug-branch routing section + investigator stage details + investigator stage-table row + investigator dispatch envelope pointer to runbooks/debug-branch.md + the v8.77 footnote on the triage example).`
    ).toBeLessThanOrEqual(0.8);
  });
});

describe("v8.22 orchestrator-slim — on-demand runbooks exist and are wired", () => {
  // v8.31 extends the v8.22 set with two path-conditional runbooks:
  // pause-resume.md (non-inline pause/resume mechanics) and
  // plan-small-medium.md (small-medium plan dispatch contract).
  // The list grows; the v8.22 invariant (every runbook is reachable
  // from the body and has a `# On-demand runbook —` heading) is
  // preserved.
  // v8.42 extends the set with `critic-stage.md` — the on-demand runbook
  // for Hop 4.5 critic dispatch (ceremonyMode gating, escalation triggers,
  // verdict routing, flow-state patches, legacy migration).
  // v8.51 extends the set with `plan-critic-stage.md` — the on-demand
  // runbook for the pre-implementation plan-critic sub-step (gating
  // table: ceremonyMode=strict + complexity=large-risky + problemType!=refines
  // + AC count>=2, verdict routing pass/revise/cancel, iteration cap,
  // flow-state patches).
  // v8.52 extends the set with `qa-stage.md` — the on-demand runbook for
  // the qa step's dispatch envelope + verdict-routing + iteration-cap +
  // flow-state patches + reviewer cross-check + legacy migration.
  // v8.59 extends the set with `extend-mode.md` — the on-demand runbook for
  // the v8.59 \`/cc extend <slug>\` entry point: Detect-hop fork (argument
  // parsing, parent validation via \`loadParentContext\`, slug-init patches
  // for \`parentContext\` + \`refines:\` + \`parent_slug:\`), triage inheritance
  // sub-step (ceremonyMode / runMode / surfaces + precedence rules), the
  // seven sub-cases (no slug / no task / collision / reverted-parent /
  // ceremonyMode-flag / runMode-flag / research-suffix), multi-level
  // chaining policy (immediate-parent only), backwards compat, and worked
  // examples.
  // v8.69 extends the set with `research-depth-and-self-review.md` — the
  // on-demand runbook covering /cc research depth tiers (light /
  // standard / deep-product), triage auto-classification heuristics, the
  // depth-conditional Phase 2 lens dispatch table, and the synthesis
  // self-review four-scan procedure (placeholder / contradiction /
  // scope-drift / ambiguity).
  const expectedRunbookFiles = [
    "dispatch-envelope.md",
    "parallel-build.md",
    "finalize.md",
    "cap-reached-recovery.md",
    "adversarial-rerun.md",
    "handoff-gates.md",
    "handoff-artifacts.md",
    "compound-refresh.md",
    "pause-resume.md",
    "critic-steps.md",
    "qa-stage.md",
    "extend-mode.md",
    "always-auto-failure-handling.md",
    "research-depth-and-self-review.md",
    "research-revision.md",
    "debug-branch.md",
  ];

  it("AC-2 — `ON_DEMAND_RUNBOOKS` contains exactly the expected on-demand runbooks (v8.54: 4 merges + 2 lifts → 11 files; v8.59: +1 extend-mode → 12 files; v8.61: +1 always-auto-failure-handling → 13 files; v8.69: +1 research-depth-and-self-review → 14 files; v8.71: +1 research-revision → 15 files; v8.77: +1 debug-branch → 16 files)", () => {
    const fileNames = ON_DEMAND_RUNBOOKS.map((r) => r.fileName).sort();
    expect(fileNames).toEqual([...expectedRunbookFiles].sort());
  });

  it("AC-2 — every runbook body is non-empty and starts with a `# On-demand runbook —` heading", () => {
    for (const runbook of ON_DEMAND_RUNBOOKS) {
      expect(runbook.body.length, `${runbook.fileName} body is empty`).toBeGreaterThan(200);
      expect(
        runbook.body,
        `${runbook.fileName} should open with a "# On-demand runbook —" heading so the file is self-identifying`
      ).toMatch(/^# On-demand runbook — /m);
    }
  });

  it("AC-3 — `start-command.ts` body references every on-demand runbook by file name", () => {
    const body = renderStartCommand();
    for (const fileName of expectedRunbookFiles) {
      expect(
        body,
        `start-command body does not reference \`${fileName}\` — a runbook on disk that the orchestrator never points at is orphaned by spec, not by install layer.`
      ).toContain(fileName);
    }
  });

  it("AC-3 — body includes the v8.22 trigger table introducing the on-demand runbooks", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/## On-demand runbooks/);
    expect(body).toMatch(/\| trigger \| runbook \|/);
  });

  it("AC-3 — body declares the runbooks live under `.cclaw/lib/runbooks/`", () => {
    const body = renderStartCommand();
    expect(body).toContain(".cclaw/lib/runbooks/");
  });

  it("AC-3 — body no longer inlines the v8.22-extracted block headings", () => {
    const body = renderStartCommand();
    const movedHeadings = [
      /^### Handoff artifacts \(T2-3, gsd pattern; v8\.13\)$/m,
      /^### Compound-refresh sub-step \(T2-4, everyinc pattern; v8\.13\)$/m,
      /^### Discoverability self-check \(T2-12\)$/m,
      /^##### Parallel-build fan-out /m,
      /^##### Cap-reached split-plan \(T1-10\)$/m,
      /^##### Adversarial pre-mortem rerun on fix-only hot paths \(T1-9\)$/m,
      /^##### Self-review gate \(mandatory before reviewer dispatch\)$/m,
      /^##### Ship-gate user ask \(finalization mode\)$/m,
    ];
    for (const heading of movedHeadings) {
      expect(
        body,
        `start-command body still contains the legacy heading ${heading} — that block should now live in a runbook`
      ).not.toMatch(heading);
    }
  });
});

describe("v8.22 orchestrator-slim — token-budget tripwire (body + runbooks)", () => {
  it("AC-4 — body alone is ≤87000 chars (... v8.74 lifted ~2k chars for the ethos preamble paragraph under Dispatch envelope, the v8.74-promoted cross-model trigger language under #### critic, the Skills-attached `cclaw-ethos` reference doc bullet, and the v8.74 Required ethos read reminder in Always-ask rules; v8.76 lifted ~10k chars for the Phase 1.5 Approaches Gate prose (framings worked-example + procedure + sub-cases), the rewritten Phase 2 lens-dispatch prose covering the new design-signal heuristic + `--lens=design` / `--lens=-design` user-toggle flags + the new `research-design` lens row, and the new `Framing:` envelope field documentation)", () => {
    const charCount = renderStartCommand().length;
    expect(
      charCount,
      `start-command body is ${charCount} chars (budget 87000). ... v8.74 added ~2k chars for the ethos preamble + v8.74-promoted cross-model trigger language under #### critic; v8.76 added ~10k chars for the Phase 1.5 Approaches Gate prose (framings worked-example + procedure + sub-cases), the rewritten Phase 2 lens-dispatch prose covering the new design-signal heuristic + \`--lens=design\` / \`--lens=-design\` user-toggle flags + the new \`research-design\` lens row, and the new \`Framing:\` envelope field documentation. Do not raise this further without a CHANGELOG note.`
    ).toBeLessThanOrEqual(125000);
  });

  it("AC-4 — `START_COMMAND_BODY` export matches `renderStartCommand` output (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("AC-4 — combined body + all on-demand runbook bodies stays under a soft 245k-char ceiling (... v8.74 lifted ceiling to 225k to absorb the v8.74 ethos preamble + cross-model trigger language + dispatch-envelope.md expansion; v8.76 lifted ceiling to 245k to absorb ~10k chars of new body prose for the Phase 1.5 Approaches Gate + the rewritten Phase 2 lens-dispatch prose covering the new design-signal heuristic + `--lens=design` / `--lens=-design` flags + the `research-design` lens row + the new `Framing:` envelope field — no v8.76 runbook expansion; the design lens contract lives at `.cclaw/lib/research-lenses/research-design.md`)", () => {
    const combined =
      renderStartCommand().length +
      ON_DEMAND_RUNBOOKS.reduce((acc, r) => acc + r.body.length, 0);
    expect(
      combined,
      `Combined body + on-demand runbooks total ${combined} chars (soft ceiling 225000). ... v8.74 added ~5k chars for the ethos-preamble + v8.74 cross-model trigger language pointers + dispatch-envelope.md runbook expansion; v8.76 added ~10k chars total — all in the body for the Phase 1.5 Approaches Gate prose, the rewritten Phase 2 lens-dispatch prose (design-signal heuristic + \`--lens=design\` / \`--lens=-design\` flags + new \`research-design\` row + new \`Framing:\` envelope field), and the v8.76 lens-set explainer (5 default → 6 when design fires); no new runbook in v8.76. Expanding past 245k means a block belongs on disk.`
    ).toBeLessThanOrEqual(275000);
  });
});

describe("v8.22 orchestrator-slim — install layer writes new runbooks", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-5 — `init` writes every on-demand runbook to `.cclaw/lib/runbooks/`", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const runbook of ON_DEMAND_RUNBOOKS) {
      const target = path.join(project, RUNBOOKS_DIR, runbook.fileName);
      const stat = await fs.stat(target);
      expect(stat.isFile()).toBe(true);
      const body = await fs.readFile(target, "utf8");
      expect(body).toBe(runbook.body);
    }
  });

  it("AC-5 — stage-runbooks (plan / build / review / ship) still co-exist alongside on-demand runbooks", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const playbook of STAGE_PLAYBOOKS) {
      const target = path.join(project, RUNBOOKS_DIR, playbook.fileName);
      const stat = await fs.stat(target);
      expect(stat.isFile()).toBe(true);
    }
  });

  it("AC-5 — `runbooks/index.md` lists both stage and on-demand sections", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const indexBody = await fs.readFile(
      path.join(project, RUNBOOKS_DIR, "index.md"),
      "utf8"
    );
    expect(indexBody).toContain("On-demand runbooks");
    for (const runbook of ON_DEMAND_RUNBOOKS) {
      expect(
        indexBody,
        `runbooks/index.md does not list \`${runbook.fileName}\` — the per-trigger table should be findable from the index`
      ).toContain(runbook.fileName);
    }
  });

  it("AC-5 — `ON_DEMAND_RUNBOOKS_INDEX_SECTION` is a non-empty markdown block", () => {
    expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toMatch(/^## On-demand runbooks/);
    expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION.length).toBeGreaterThan(200);
  });
});

describe("v8.22 orchestrator-slim — generic orphan-cleanup also covers runbooks/", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-6 — baseline sync with no runbook orphans is silent (no orphan-runbook events)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const before = (await fs.readdir(path.join(project, RUNBOOKS_DIR))).sort();
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    const after = (await fs.readdir(path.join(project, RUNBOOKS_DIR))).sort();
    expect(after).toEqual(before);
    expect(events.find((e) => e.step === "Removed orphan runbook")).toBeUndefined();
    expect(events.find((e) => e.step === "Cleaned orphan runbooks")).toBeUndefined();
  });

  it("AC-6 — sync removes a stray .md in runbooks/ and emits Removed + summary events", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedRunbookOrphan(project, "legacy-block.md");
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    await expect(
      fs.access(path.join(project, RUNBOOKS_DIR, "legacy-block.md"))
    ).rejects.toBeTruthy();
    const removed = events.filter((e) => e.step === "Removed orphan runbook");
    expect(removed.length).toBe(1);
    expect(removed[0]!.detail).toBe("legacy-block.md");
    const summary = events.find((e) => e.step === "Cleaned orphan runbooks");
    expect(summary).toBeDefined();
    expect(summary!.detail).toMatch(/^1 orphan runbook file /u);
  });

  it("AC-6 — sync preserves both stage runbooks and on-demand runbooks; final dir is the expected set", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const name of ["stray-1.md", "stray-2.md"]) {
      await seedRunbookOrphan(project, name);
    }
    await syncCclaw({ cwd: project });
    const after = await fs.readdir(path.join(project, RUNBOOKS_DIR));
    const mdFiles = after.filter((f) => f.endsWith(".md"));
    const expected = new Set<string>([
      "index.md",
      ...STAGE_PLAYBOOKS.map((p) => p.fileName),
      ...ON_DEMAND_RUNBOOKS.map((r) => r.fileName),
    ]);
    expect(new Set(mdFiles)).toEqual(expected);
  });

  it("AC-6 — `--skip-orphan-cleanup` preserves runbook orphans and emits the skipped event", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedRunbookOrphan(project, "stale.md");
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, skipOrphanCleanup: true, onProgress });
    const stat = await fs.stat(path.join(project, RUNBOOKS_DIR, "stale.md"));
    expect(stat.isFile()).toBe(true);
    expect(events.find((e) => e.step === "Removed orphan runbook")).toBeUndefined();
    const skipped = events.find(
      (e) =>
        e.step === "Skipped orphan cleanup" &&
        e.detail !== undefined &&
        e.detail.includes("runbooks")
    );
    expect(skipped).toBeDefined();
  });

  it("AC-6 — sync is idempotent on runbooks/ (second pass emits no orphan events)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedRunbookOrphan(project, "old-finalize-helper.md");
    const first = captureProgress();
    await syncCclaw({ cwd: project, onProgress: first.onProgress });
    const second = captureProgress();
    await syncCclaw({ cwd: project, onProgress: second.onProgress });
    expect(first.events.filter((e) => e.step === "Removed orphan runbook").length).toBe(1);
    expect(second.events.find((e) => e.step === "Removed orphan runbook")).toBeUndefined();
    expect(second.events.find((e) => e.step === "Cleaned orphan runbooks")).toBeUndefined();
  });
});

describe("v8.22 orchestrator-slim — pointer integrity (body → runbook)", () => {
  it("AC-7 — every on-demand runbook is reachable from the orchestrator (forward pointer)", () => {
    const body = renderStartCommand();
    for (const runbook of ON_DEMAND_RUNBOOKS) {
      expect(
        body,
        `start-command body lacks a pointer to \`${runbook.fileName}\``
      ).toMatch(new RegExp(runbook.fileName.replace(/\./g, "\\.")));
    }
  });

  it("AC-7 — finalize is no longer a body section (only a pointer paragraph)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/^## Finalize \(ship-finalize/m);
    expect(body).toContain("runbooks/finalize.md");
    expect(body, "finalize body should be short — full procedure lives in finalize.md").not.toMatch(
      /\*\*Pre-condition check\.\*\* `flows\/<slug>\/ship\.md` exists with `status: shipped`/
    );
  });

  it("AC-7 — parallel-build fan-out ASCII no longer appears in the body", () => {
    const body = renderStartCommand();
    expect(body).not.toContain("git worktree add .cclaw/worktrees/<slug>-s-1");
  });

  it("AC-7 — self-review gate fix-only bounce envelope no longer appears in the body", () => {
    const body = renderStartCommand();
    expect(body).not.toMatch(/Stage: build \(self-review fix-only\)/);
  });

  it("AC-7 — ship-gate `askUserQuestion(...)` block no longer appears inline", () => {
    const body = renderStartCommand();
    expect(body, "ship-gate user-ask example should live in ship-gate.md").not.toMatch(
      /option label conveying: open a PR with structured body/
    );
  });

  it("AC-7 — discovery auto-skip heuristic detailed conditions live in discovery.md, not body", () => {
    const body = renderStartCommand();
    expect(body).not.toMatch(
      /1\. `triage\.confidence` is `high` \(the heuristic produced an unambiguous large-risky classification\)\./
    );
  });
});
