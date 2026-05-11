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
  it("AC-1 — `start-command.ts` body stays ≤480 lines (was 901 on v8.21)", () => {
    const body = renderStartCommand();
    const lineCount = body.split("\n").length;
    expect(
      lineCount,
      `start-command body is ${lineCount} lines (budget 480). If new runtime semantics need a body block, weigh moving an existing block to .cclaw/lib/runbooks/ instead of raising the budget.`
    ).toBeLessThanOrEqual(480);
  });

  it("AC-1 — the body is meaningfully smaller than the legacy v8.21 size (≥30% cut)", () => {
    const lineCount = renderStartCommand().split("\n").length;
    const v821Baseline = 901;
    const ratio = lineCount / v821Baseline;
    expect(
      ratio,
      `start-command body is ${lineCount} lines, ratio ${ratio.toFixed(2)} of v8.21 baseline (${v821Baseline}). v8.22's win disappears if the body re-grows past 70% of pre-v8.22.`
    ).toBeLessThanOrEqual(0.7);
  });
});

describe("v8.22 orchestrator-slim — on-demand runbooks exist and are wired", () => {
  const expectedRunbookFiles = [
    "dispatch-envelope.md",
    "parallel-build.md",
    "finalize.md",
    "cap-reached-recovery.md",
    "adversarial-rerun.md",
    "self-review-gate.md",
    "ship-gate.md",
    "handoff-artifacts.md",
    "compound-refresh.md",
    "discovery.md",
  ];

  it("AC-2 — `ON_DEMAND_RUNBOOKS` contains exactly the ten expected files", () => {
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
    expect(body).toMatch(/## On-demand runbooks \(v8\.22\)/);
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
  it("AC-4 — body alone is ≤46k chars (was ~52k on v8.21; a meaningful cut)", () => {
    const charCount = renderStartCommand().length;
    expect(
      charCount,
      `start-command body is ${charCount} chars (budget 46000). v8.22 cut ~14% off the body's char count by lifting on-demand runbooks; v8.23 + v8.24 added Hop 1 git-check + the two-pass default paragraph (deliberate ~1k char growth, documented in those slugs' CHANGELOGs). Do not raise this further without a CHANGELOG note.`
    ).toBeLessThanOrEqual(46000);
  });

  it("AC-4 — `START_COMMAND_BODY` export matches `renderStartCommand` output (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("AC-4 — combined body + all on-demand runbook bodies stays under a soft 100k-char ceiling", () => {
    const combined =
      renderStartCommand().length +
      ON_DEMAND_RUNBOOKS.reduce((acc, r) => acc + r.body.length, 0);
    expect(
      combined,
      `Combined body + on-demand runbooks total ${combined} chars (soft ceiling 100000). The pre-v8.22 body alone was ~50k; expanding past 100k means a block belongs on disk, not inlined and not in a runbook.`
    ).toBeLessThanOrEqual(100000);
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
    expect(indexBody).toContain("On-demand runbooks (v8.22)");
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

  it("AC-7 — Hop 6 finalize is no longer a body section (only a pointer paragraph)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/## Hop 6 — Finalize \(ship-finalize/);
    expect(body).toContain("runbooks/finalize.md");
    expect(body, "Hop 6 body should be short — full procedure lives in finalize.md").not.toMatch(
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
