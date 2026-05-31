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
 * Slimmed in v8.101 test-slim-down A4 from 12 atomized its() to 5
 * packed integration tests (init writes templates+agents+runbook in one
 * pass; start-command body wiring; runbook verdict surface; critic
 * prompt scope; CORE_AGENTS + agent-file roster). The init-writes
 * block shares a single `initCclaw` invocation now to avoid 3 redundant
 * project bootstraps.
 */

const CRITIC_STEPS_FILENAME = "critic-steps.md";

describe("v8.42 — critic Hop 4.5 install layer (e2e)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("WIRING — single initCclaw run writes the critic.md artifact template, .cclaw/lib/agents/critic.md (on-demand activation + Modes: gap/adversarial), and the merged .cclaw/lib/runbooks/critic-steps.md (v8.54 merged post-impl + pre-impl)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });

    const tplPath = path.join(project, ".cclaw", "lib", "templates", "critic.md");
    const tplBody = await fs.readFile(tplPath, "utf8");
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "critic")!;
    expect(tplBody).toBe(tpl.body);

    const agentBody = await fs.readFile(
      path.join(project, ".cclaw", "lib", "agents", "critic.md"),
      "utf8"
    );
    expect(agentBody).toMatch(/^---\nname: critic\n/);
    expect(agentBody).toContain("activation: on-demand");
    expect(agentBody).toMatch(/## Modes\n\n- gap\n- adversarial/);

    const runbookBody = await fs.readFile(
      path.join(project, ".cclaw", "lib", "runbooks", CRITIC_STEPS_FILENAME),
      "utf8"
    );
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === CRITIC_STEPS_FILENAME)!;
    expect(runbookBody).toBe(runbook.body);
  });
});

describe("v8.42 — critic step dispatch surface (start-command body)", () => {
  it("BEHAVIOR — body inserts `critic` between `review` and `ship` in the canonical path, names the v8.42+ critic-step heading, references the merged critic-steps.md runbook, and includes `critic` in the lastSpecialist enum (v8.61 reframe)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/`plan`,\s*`build`,\s*`review`,\s*`critic`,\s*`ship`/);
    expect(body).toMatch(/#### critic \(critic step\)/);
    expect(body).toContain(CRITIC_STEPS_FILENAME);
    expect(START_COMMAND_BODY).toMatch(/`lastSpecialist`\s*=[\s\S]+`critic`/);
  });
});

describe("v8.42 — critic-steps runbook documents both verdict surfaces", () => {
  it("BEHAVIOR — runbook names all three post-impl verdicts (`pass` / `iterate` / `block-ship`), the block-ship picker shape + cap rules (fix-and-rereview / accept-and-ship / criticIteration), and the v8.51/v8.54 pre-impl (plan-critic) widened gate", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === CRITIC_STEPS_FILENAME)!;
    for (const verdict of ["`pass`", "`iterate`", "`block-ship`"]) {
      expect(runbook.body).toContain(verdict);
    }
    expect(runbook.body).toMatch(/fix and re-?review/i);
    expect(runbook.body).toMatch(/accept-and-ship/i);
    expect(runbook.body).toMatch(/criticIteration/);
    expect(runbook.body).toMatch(/Pre-implementation pass \(plan-critic\)/);
    expect(runbook.body).toMatch(/triage\.complexity != "trivial"/);
  });
});

describe("v8.42 — critic prompt scope", () => {
  it("BEHAVIOR — critic prompt covers the §3 adversarial techniques scaffold + gap-axis vocabulary (assumption violation / composition failures / cascade construction / abuse cases / edge-case / scope-creep / goal-backward)", () => {
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

describe("v8.62 / v8.82 / v8.104 — specialist count end-to-end (unified flow)", () => {
  it("WIRING — CORE_AGENTS contains 8 specialists + 2 research helpers (v8.104 merge — collapsed v8.75 plan-design + v8.82 plan-devex into v8.51 plan-critic as `rubricMode: \"design\"` / `rubricMode: \"devex\"`) and init writes the canonical 10-agent .md roster to .cclaw/lib/agents", async () => {
    const specialists = CORE_AGENTS.filter((a) => a.kind === "specialist");
    const research = CORE_AGENTS.filter((a) => a.kind === "research");
    expect(specialists).toHaveLength(8);
    expect(research).toHaveLength(2);

    let project: string | null = null;
    try {
      project = await createTempProject();
      await initCclaw({ cwd: project });
      const entries = await fs.readdir(path.join(project, ".cclaw", "lib", "agents"));
      const md = entries.filter((e) => e.endsWith(".md")).sort();
      expect(md).toEqual([
        "architect.md",
        "builder.md",
        "critic.md",
        "investigator.md",
        "learnings-research.md",
        "plan-critic.md",
        "qa-runner.md",
        "repo-research.md",
        "reviewer.md",
        "triage.md"
      ]);
    } finally {
      if (project) await removeProject(project);
    }
  });
});
