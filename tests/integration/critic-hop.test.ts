import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initCclaw } from "../../src/install.js";
import {
  renderStartCommand,
  START_COMMAND_BODY
} from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.42 — adversarial critic Hop 4.5 integration test.
 *
 * v8.54 merged the standalone `critic-stage.md` and `plan-critic-stage.md`
 * runbooks into a single `critic-steps.md` that covers both the
 * pre-implementation (plan-critic) and post-implementation (critic)
 * passes. The test layer follows the merge — every runbook reference
 * here points at `critic-steps.md`.
 */

const CRITIC_STEPS_FILENAME = "critic-steps.md";

describe("v8.42 — critic Hop 4.5 install layer (e2e)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("init writes .cclaw/lib/templates/critic.md", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const target = path.join(project, ".cclaw", "lib", "templates", "critic.md");
    const body = await fs.readFile(target, "utf8");
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "critic")!;
    expect(body).toBe(tpl.body);
  });

  it("init writes .cclaw/lib/agents/critic.md with on-demand activation", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const body = await fs.readFile(
      path.join(project, ".cclaw", "lib", "agents", "critic.md"),
      "utf8"
    );
    expect(body).toMatch(/^---\nname: critic\n/);
    expect(body).toContain("activation: on-demand");
    expect(body).toMatch(/## Modes\n\n- gap\n- adversarial/);
  });

  it("init writes .cclaw/lib/runbooks/critic-steps.md (v8.54 merged: post-impl + pre-impl)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const body = await fs.readFile(
      path.join(project, ".cclaw", "lib", "runbooks", CRITIC_STEPS_FILENAME),
      "utf8"
    );
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === CRITIC_STEPS_FILENAME)!;
    expect(body).toBe(runbook.body);
  });
});

describe("v8.42 — critic step dispatch path reachable from start-command body", () => {
  it("body adds `critic` between `review` and `ship` in the canonical path", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/`plan`,\s*`build`,\s*`review`,\s*`critic`,\s*`ship`/);
    expect(body).toMatch(/#### critic \(v8\.42\+, critic step\)/);
  });

  it("body references the merged `critic-steps.md` runbook", () => {
    expect(renderStartCommand()).toContain(CRITIC_STEPS_FILENAME);
  });

  it("body includes `critic` in the Last specialist enum", () => {
    expect(START_COMMAND_BODY).toMatch(/Last specialist:.+\bcritic\b/);
  });
});

describe("v8.42 — critic-steps runbook documents both verdict surfaces", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === CRITIC_STEPS_FILENAME)!;

  it("post-impl section names all three critic verdicts (pass / iterate / block-ship)", () => {
    expect(runbook.body).toContain("`pass`");
    expect(runbook.body).toContain("`iterate`");
    expect(runbook.body).toContain("`block-ship`");
  });

  it("post-impl section names the block-ship picker shape + cap rules", () => {
    expect(runbook.body).toMatch(/fix and re-?review/i);
    expect(runbook.body).toMatch(/accept-and-ship/i);
    expect(runbook.body).toMatch(/criticIteration/);
  });

  it("pre-impl (plan-critic) section is present with v8.54 widened gate", () => {
    expect(runbook.body).toMatch(/Pre-implementation pass \(plan-critic, v8\.51\)/);
    expect(runbook.body).toMatch(/triage\.complexity != "trivial"/);
  });
});

describe("v8.42 — critic prompt covers known-bad scenarios", () => {
  it("§3 adversarial techniques scaffold + gap-axis vocabulary are present", () => {
    const prompt = SPECIALIST_PROMPTS.critic;
    for (const token of [
      "assumption violation",
      "composition failures",
      "cascade construction",
      "abuse cases",
      "edge-case",
      "scope-creep",
      "goal-backward"
    ]) {
      expect(prompt).toMatch(new RegExp(token, "i"));
    }
  });
});

describe("v8.42 — specialist count is 8 end-to-end", () => {
  it("CORE_AGENTS contains 8 specialists + 2 research helpers", () => {
    const specialists = CORE_AGENTS.filter((a) => a.kind === "specialist");
    const research = CORE_AGENTS.filter((a) => a.kind === "research");
    expect(specialists).toHaveLength(8);
    expect(research).toHaveLength(2);
  });

  it("init writes the 10 expected agent files", async () => {
    let project: string | null = null;
    try {
      project = await createTempProject();
      await initCclaw({ cwd: project });
      const entries = await fs.readdir(path.join(project, ".cclaw", "lib", "agents"));
      const md = entries.filter((e) => e.endsWith(".md")).sort();
      expect(md).toEqual([
        "ac-author.md",
        "critic.md",
        "design.md",
        "learnings-research.md",
        "plan-critic.md",
        "qa-runner.md",
        "repo-research.md",
        "reviewer.md",
        "security-reviewer.md",
        "slice-builder.md"
      ]);
    } finally {
      if (project) await removeProject(project);
    }
  });
});
