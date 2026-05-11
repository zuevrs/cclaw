import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { renderStartCommand } from "../../src/content/start-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { NODE_HOOKS } from "../../src/content/node-hooks.js";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { readFlowState, writeFlowState } from "../../src/run-persistence.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.23 — no-git fallback. Without git, three surfaces broke silently on
 * v8.22: strict-mode build (commit-helper.mjs `git diff --cached` crashed
 * with "git not available"), inline path's terminal `git commit`, and
 * parallel-build worktrees. v8.23 adds a Hop 1 git-check, auto-downgrades
 * `triage.acMode` `strict → soft` with `triage.downgradeReason: "no-git"`,
 * and makes `commit-helper.mjs` a graceful no-op (warning to stderr, exit
 * 0) in soft mode when git is absent.
 *
 * Each tripwire pins one invariant so a regression — re-enabling a
 * git-call without a fallback, dropping the warning, or letting a strict
 * AC mode survive a no-git triage — lights up immediately.
 */

const COMMIT_HELPER_BODY = (() => {
  const hook = NODE_HOOKS.find((h) => h.id === "commit-helper");
  if (!hook) throw new Error("commit-helper hook not found");
  return hook.body;
})();

const TRIAGE_GATE_SKILL = (() => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === "triage-gate.md");
  if (!skill) throw new Error("triage-gate skill not found");
  return skill.body;
})();

describe("v8.23 no-git fallback — Hop 1 git-check + auto-downgrade", () => {
  it("AC-1 — `start-command.ts` Hop 1 documents the git-check sub-step", () => {
    const body = renderStartCommand();
    expect(
      body,
      "Hop 1 should explicitly mention a git-check sub-step so a maintainer can find the v8.23 fallback path"
    ).toMatch(/Hop 1[\s\S]+?git[- ]check/i);
  });

  it("AC-1 — body names the auto-downgrade rule (strict → soft when no .git/)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/no.?git/i);
    expect(
      body,
      "body should name the downgrade target so a future maintainer reading Hop 1 knows what acMode the orchestrator settles on"
    ).toMatch(/strict.*soft|soft.*downgrade|acMode.*soft/);
  });

  it("AC-1 — body names `triage.downgradeReason` as the audit-trail field", () => {
    const body = renderStartCommand();
    expect(body).toContain("downgradeReason");
    expect(body).toMatch(/"no-git"/);
  });

  it("AC-1 — body still tells the agent to surface a one-line warning to the user", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/warn(ing)?|notify/i);
  });
});

describe("v8.23 no-git fallback — triage-gate skill documents the auto-downgrade", () => {
  it("AC-2 — `triage-gate.md` names the no-git auto-downgrade rule", () => {
    expect(TRIAGE_GATE_SKILL).toMatch(/no.?git/i);
    expect(
      TRIAGE_GATE_SKILL,
      "skill should explain that strict mode auto-downgrades to soft when .git/ is absent"
    ).toMatch(/strict.*soft|acMode.*soft|downgrade.*soft/);
  });

  it("AC-2 — `triage-gate.md` records the audit-trail field name (downgradeReason)", () => {
    expect(TRIAGE_GATE_SKILL).toContain("downgradeReason");
  });

  it("AC-2 — `triage-gate.md` calls out the inline `git commit` and parallel-build worktree consequences", () => {
    expect(
      TRIAGE_GATE_SKILL,
      "skill should at least mention parallel-build can't run without git, so the user knows why the orchestrator chose soft mode"
    ).toMatch(/parallel.?build|worktree/i);
  });
});

describe("v8.23 no-git fallback — commit-helper.mjs graceful no-op in soft mode", () => {
  it("AC-3 — commit-helper body has a soft-mode no-git branch that exits 0", () => {
    expect(
      COMMIT_HELPER_BODY,
      "soft mode should not exit 2 when git is missing — it should write a one-line warning and exit 0"
    ).toMatch(/no.?git|git.*not.*available|git.*missing/i);
    expect(COMMIT_HELPER_BODY).toMatch(/process\.exit\(0\)/);
  });

  it("AC-3 — commit-helper writes the no-git warning to stderr (not stdout)", () => {
    expect(
      COMMIT_HELPER_BODY,
      "warning should go to stderr so it does not contaminate machine-readable stdout in a CI / scripted run"
    ).toMatch(/console\.(error|warn)[\s\S]*?(no.?git|not.*available|missing)/i);
  });

  it("AC-3 — commit-helper still hard-fails in strict mode when git is unavailable", () => {
    expect(
      COMMIT_HELPER_BODY,
      "strict mode must NOT silently no-op without git — strict implies AC trace, which requires SHAs"
    ).toMatch(/strict[\s\S]*?(process\.exit\(2\)|git not available)/);
  });

  it("AC-3 — commit-helper notes the soft-mode no-op writes no AC trace and no commit", () => {
    expect(COMMIT_HELPER_BODY).toMatch(/no.?op|skipped|advisory/i);
  });
});

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
      acMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Auto-downgraded from strict because no .git/ in projectRoot.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      runMode: "step",
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
      acMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Normal small-medium flow.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      runMode: "step",
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
      acMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Pre-v8.23 flow without downgradeReason.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      runMode: "step",
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
      acMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "Bad shape: downgradeReason is a number.",
      decidedAt: new Date().toISOString(),
      userOverrode: false,
      runMode: "step",
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
