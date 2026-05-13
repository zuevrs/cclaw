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
 * End-to-end coverage:
 *  - After `cclaw init` the critic specialist + template + runbook all
 *    land on disk in the right places.
 *  - The orchestrator body (`start-command.ts`) carries the Hop 4.5
 *    dispatch path so a harness invocation can see the new stage.
 *  - Five known-bad scenarios from spec §10 — verify the critic prompt
 *    contains the relevant gap-axis language so the dispatch would
 *    catch each scenario (the scenarios drive the §10 test plan;
 *    asserting the prompt covers each axis is a structural check, not
 *    a behavioural one — the behavioural side runs in cclaw itself
 *    when the slug ships through its own critic stage per Q4).
 *
 * Spec: `.cclaw/flows/v842-critic-design/design.md > §10 — Test plan`.
 */

describe("v8.42 — critic Hop 4.5 install layer (e2e)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("init writes .cclaw/lib/templates/critic.md", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const target = path.join(project, ".cclaw", "lib", "templates", "critic.md");
    const stat = await fs.stat(target);
    expect(stat.isFile()).toBe(true);
    const body = await fs.readFile(target, "utf8");
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "critic")!;
    expect(body).toBe(tpl.body);
  });

  it("init writes .cclaw/lib/agents/critic.md with the on-demand activation frontmatter", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const target = path.join(project, ".cclaw", "lib", "agents", "critic.md");
    const stat = await fs.stat(target);
    expect(stat.isFile()).toBe(true);
    const body = await fs.readFile(target, "utf8");
    expect(body).toMatch(/^---\nname: critic\n/);
    expect(body).toContain("activation: on-demand");
    // renderAgentMarkdown emits modes as a bulleted `## Modes` section,
    // not as a comma-joined frontmatter field. The two modes the critic
    // exposes (gap / adversarial) must both render as `- <mode>` bullets.
    expect(body).toMatch(/## Modes\n\n- gap\n- adversarial/);
    const critic = CORE_AGENTS.find((a) => a.id === "critic")!;
    expect(body).toContain(critic.prompt);
  });

  it("init writes .cclaw/lib/runbooks/critic-stage.md (the Hop 4.5 dispatch runbook)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const target = path.join(project, ".cclaw", "lib", "runbooks", "critic-stage.md");
    const stat = await fs.stat(target);
    expect(stat.isFile()).toBe(true);
    const body = await fs.readFile(target, "utf8");
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-stage.md")!;
    expect(body).toBe(runbook.body);
  });
});

describe("v8.42 — critic Hop 4.5 dispatch path is reachable from start-command body", () => {
  it("body adds `critic` to the canonical stage list (5 stages now)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/`plan`,\s*`build`,\s*`review`,\s*`critic`,\s*`ship`/);
  });

  it("body adds a `#### critic` stage section between `#### review` and `#### ship`", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/#### critic \(v8\.42\+, Hop 4\.5\)/);
    const criticIdx = body.indexOf("#### critic");
    const reviewIdx = body.indexOf("#### review");
    const shipIdx = body.indexOf("#### ship");
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(criticIdx).toBeGreaterThan(reviewIdx);
    expect(shipIdx).toBeGreaterThan(criticIdx);
  });

  it("body references `critic-stage.md` runbook as the on-demand source-of-truth", () => {
    const body = renderStartCommand();
    expect(body).toContain("critic-stage.md");
  });

  it("body marks the triage.path example so the v8.42 critic stage shows up between review and ship", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/"path":\s*\["plan",\s*"build",\s*"review",\s*"critic",\s*"ship"\]/);
  });

  it("body includes `critic` in the resume summary's Last specialist enum", () => {
    expect(START_COMMAND_BODY).toMatch(/Last specialist:.+\bcritic\b/);
  });

  it("body's auto-mode option lists critic in the stage chain", () => {
    expect(START_COMMAND_BODY).toMatch(/plan → build → review → critic → ship/);
  });
});

describe("v8.42 — critic Hop 4.5 verdict routing (block-ship picker)", () => {
  it("critic-stage runbook documents all three verdict outcomes (pass / iterate / block-ship)", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-stage.md")!;
    expect(runbook.body).toContain("`pass`");
    expect(runbook.body).toContain("`iterate`");
    expect(runbook.body).toContain("`block-ship`");
  });

  it("critic-stage runbook documents the block-ship picker shape (fix and re-review / accept-and-ship / /cc-cancel)", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-stage.md")!;
    expect(runbook.body).toMatch(/fix and re-?review/i);
    expect(runbook.body).toMatch(/accept-and-ship/i);
    expect(runbook.body).toMatch(/\/cc-cancel/);
  });

  it("critic-stage runbook documents the cap-rules (1 re-run, 2 dispatches max)", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-stage.md")!;
    expect(runbook.body).toMatch(/1 critic re-?run|hard cap: 1/i);
    expect(runbook.body).toMatch(/criticIteration/);
  });

  it("critic-stage runbook documents the legacy pre-v8.42 migration path", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-stage.md")!;
    expect(runbook.body).toMatch(/legacy|pre-v8\.42/i);
    expect(runbook.body).toMatch(/criticVerdict/);
    expect(
      runbook.body,
      "the migration trigger is currentStage=review + lastSpecialist=reviewer + absent criticVerdict"
    ).toMatch(/currentStage:\s*"review"[\s\S]{0,200}lastSpecialist:\s*"reviewer"/);
  });

  it("critic-stage runbook documents Q4 dogfooding for the v8.42 implementation slug itself", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-stage.md")!;
    expect(runbook.body).toMatch(/dogfood|Q4/i);
    expect(runbook.body).toMatch(/triage\.criticOverride/);
  });
});

describe("v8.42 — critic prompt covers the §10 known-bad scenarios (gap-axis coverage)", () => {
  // Spec §10 enumerates five known-bad scenarios cclaw critic must catch.
  // Each test asserts the critic prompt's gap-axis vocabulary covers the
  // axis the scenario exercises — a structural check that the dispatch
  // would activate the right reasoning pathway.

  it("scenario 1: false assumption (input shape) — critic prompt covers assumption violation and false-assumption gaps", () => {
    expect(SPECIALIST_PROMPTS.critic, "§3a assumption violation technique").toMatch(
      /assumption violation/i
    );
    expect(
      SPECIALIST_PROMPTS.critic,
      "§2 gap classes include false-assumptions (prose form 'False assumptions' under the gap-analysis section)"
    ).toMatch(/false[\s-]?assumptions?/i);
  });

  it("scenario 2: missing edge case — critic prompt covers edge-case coverage gap + untested-edge axis", () => {
    expect(SPECIALIST_PROMPTS.critic).toMatch(/edge-?case/i);
    expect(SPECIALIST_PROMPTS.critic).toMatch(/untested edge case/i);
  });

  it("scenario 3: scope creep / unrelated changes — critic prompt covers scope-creep gap axis", () => {
    expect(SPECIALIST_PROMPTS.critic).toMatch(/scope-?creep/i);
  });

  it("scenario 4: v8.36-posture failure (tests-as-deliverable pins wrong contract) — critic prompt covers goal-backward (AC drift) verification", () => {
    expect(SPECIALIST_PROMPTS.critic).toMatch(/goal-?backward/i);
    expect(
      SPECIALIST_PROMPTS.critic,
      "the AC self-audit asks 'is the AC the right AC' (drift detection)"
    ).toMatch(/drift|drifted/i);
  });

  it("scenario 5: composition failure (boundary error contract divergence) — critic prompt covers composition failures + cascade construction techniques", () => {
    expect(SPECIALIST_PROMPTS.critic, "§3b composition failures").toMatch(
      /composition failures/i
    );
    expect(SPECIALIST_PROMPTS.critic, "§3c cascade construction").toMatch(
      /cascade construction/i
    );
  });

  it("scenarios 1-5 — critic prompt names every adversarial-technique scaffold from spec §3 (assumption / composition / cascade / abuse)", () => {
    // Sanity check: even though gap mode skips §3, the four techniques are
    // documented so they fire in adversarial mode.
    for (const technique of [
      "assumption violation",
      "composition failures",
      "cascade construction",
      "abuse cases"
    ]) {
      expect(
        SPECIALIST_PROMPTS.critic,
        `adversarial technique "${technique}" missing from critic prompt §3`
      ).toMatch(new RegExp(technique, "i"));
    }
  });
});

describe("v8.42 — critic specialist count is six end-to-end", () => {
  it("CORE_AGENTS contains exactly 6 specialists + 2 research helpers = 8 entries", () => {
    const specialists = CORE_AGENTS.filter((a) => a.kind === "specialist");
    const research = CORE_AGENTS.filter((a) => a.kind === "research");
    expect(specialists).toHaveLength(6);
    expect(research).toHaveLength(2);
    expect(CORE_AGENTS).toHaveLength(8);
  });

  it("init writes exactly 8 agent files under .cclaw/lib/agents/", async () => {
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
