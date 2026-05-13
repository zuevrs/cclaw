import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { renderStartCommand } from "../../src/content/start-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { readFlowState, writeFlowState } from "../../src/run-persistence.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.23 — no-git fallback. The original v8.23 had three surfaces that
 * broke without git: strict-mode commit-helper (now retired in v8.40),
 * the inline path's terminal `git commit`, and parallel-build worktrees.
 *
 * v8.40 reframes the fallback: with the commit-helper hook gone, the
 * strict-mode chain is now reviewer-enforced ex-post via
 * `git log --grep="(AC-N):"`. Without `.git/` the reviewer cannot scan
 * the chain, and the parallel-build worktree path is still unavailable —
 * so the auto-downgrade `strict → soft` (with `triage.downgradeReason:
 * "no-git"`) stays the right call. These tripwires pin that contract
 * survives the v8.40 hook removal.
 */

const TRIAGE_GATE_SKILL = (() => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === "triage-gate.md");
  if (!skill) throw new Error("triage-gate skill not found");
  return skill.body;
})();

describe("v8.23 no-git fallback — detect step git-check + auto-downgrade", () => {
  it("AC-1 — `start-command.ts` detect step documents the git-check sub-step", () => {
    const body = renderStartCommand();
    expect(
      body,
      "detect should explicitly mention a git-check sub-step so a maintainer can find the v8.23 fallback path"
    ).toMatch(/Detect[\s\S]+?git[- ]check/i);
  });

  it("AC-1 — body names the auto-downgrade rule (strict → soft when no .git/)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/no.?git/i);
    expect(
      body,
      "body should name the downgrade target so a future maintainer reading detect knows what acMode the orchestrator settles on"
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

  it("AC-2 (v8.40) — `triage-gate.md` no longer references the retired commit-helper hook", () => {
    expect(TRIAGE_GATE_SKILL).not.toContain("commit-helper");
  });
});

describe("v8.40 no-git fallback — strict-mode chain check is skipped when no .git/", () => {
  it("AC-3 — `triage-gate.md` notes that strict mode requires per-AC commits the reviewer reads via git log", () => {
    expect(TRIAGE_GATE_SKILL).toMatch(/strict mode requires per-AC commits/i);
    expect(TRIAGE_GATE_SKILL).toMatch(/git log/i);
  });

  it("AC-3 — reviewer prompt notes that the chain check is skipped when triage.downgradeReason is no-git", () => {
    // The reviewer's posture-aware git-log inspection only fires for
    // strict-mode flows that have a `.git/` directory; when the triage
    // recorded downgradeReason=no-git, the chain check is structurally
    // impossible (nothing to grep) and the reviewer should skip it.
    const reviewerPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/content/specialist-prompts/reviewer.ts"
    );
    return fs.readFile(reviewerPath, "utf8").then((source) => {
      expect(source).toMatch(/no-git/u);
    });
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
