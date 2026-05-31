import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initCclaw, syncCclaw } from "../../src/install.js";
import { readFlowState, writeFlowState } from "../../src/run-persistence.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.23 no-git fallback — flow-state + install-layer wiring.
 *
 * Slimmed in v8.100: kept the `readFlowState` / `writeFlowState` round-
 * trips for the `triage.downgradeReason` schema and the `initCclaw` /
 * `syncCclaw` no-git survival tests. The renderStartCommand and
 * triage-gate skill-body prompt-greps were removed.
 */
describe("v8.23 no-git fallback — TriageDecision schema accepts downgradeReason", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-4 — `flow-state.json` round-trips a triage with `downgradeReason: \"no-git\"`", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const state = await readFlowState(project);
    state.currentSlug = "20260511-no-git-flow";
    state.triage = {
      complexity: "large-risky",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Auto-downgraded from strict because no .git/ in projectRoot.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      downgradeReason: "no-git",
    } as typeof state.triage;
    await writeFlowState(project, state);
    const reread = await readFlowState(project);
    expect(reread.triage?.downgradeReason).toBe("no-git");
  });

  it("AC-4 — `flow-state.json` round-trips a triage with `downgradeReason: null`", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const state = await readFlowState(project);
    state.currentSlug = "20260511-with-git-flow";
    state.triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Normal small-medium flow.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      downgradeReason: null,
    } as typeof state.triage;
    await writeFlowState(project, state);
    const reread = await readFlowState(project);
    expect(reread.triage?.downgradeReason).toBeNull();
  });

  it("AC-4 — `flow-state.json` validates a triage WITHOUT `downgradeReason` (backward compat)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const state = await readFlowState(project);
    state.currentSlug = "20260511-legacy-flow";
    state.triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Pre-v8.23 flow without downgradeReason.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
    };
    await writeFlowState(project, state);
    const reread = await readFlowState(project);
    expect(reread.triage?.downgradeReason).toBeUndefined();
  });

  it("AC-4 — schema rejects non-string `downgradeReason` (e.g. number)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const statePath = path.join(project, ".cclaw", "state", "flow-state.json");
    const raw = JSON.parse(await fs.readFile(statePath, "utf8"));
    raw.currentSlug = "20260511-bad-shape";
    raw.triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Bad shape: downgradeReason is a number.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      downgradeReason: 42,
    };
    await fs.writeFile(statePath, JSON.stringify(raw, null, 2), "utf8");
    await expect(readFlowState(project)).rejects.toThrow(/downgradeReason/);
  });
});

describe("v8.23 no-git fallback — install layer survives on a no-git temp project", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-5 — `cclaw init` on a freshly-created (no .git) temp dir completes without crash", async () => {
    project = await createTempProject();
    await expect(initCclaw({ cwd: project })).resolves.toBeDefined();
    const cclawDir = await fs.stat(path.join(project, ".cclaw"));
    expect(cclawDir.isDirectory()).toBe(true);
  });

  it("AC-5 — `cclaw sync` on a no-git project is idempotent and writes no .git files", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await syncCclaw({ cwd: project });
    await syncCclaw({ cwd: project });
    await expect(fs.access(path.join(project, ".git"))).rejects.toBeTruthy();
  });
});
