import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { initCclaw, syncCclaw } from "../../src/install.js";
import type { ProgressEvent } from "../../src/ui.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.22 — orchestrator-slim install-layer wiring.
 *
 * Slimmed in v8.100: kept the `initCclaw` / `syncCclaw` install + orphan-
 * cleanup wiring tests for the .cclaw/lib/runbooks/ surface. The body
 * line / char budget tests were removed (v831-path-aware-trimming.test.ts
 * already covers them). The pointer-integrity content-greps on the
 * rendered start-command body were also removed.
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
      expect(indexBody).toContain(runbook.fileName);
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
