import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_FILE_ORDER } from "../../src/constants.js";
import { stageSkillFolder } from "../../src/content/skills.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("flow command contracts", () => {
  it("creates thin command contracts with required sections", async () => {
    const root = await createTempProject("flow");
    await initCclaw({ projectRoot: root });

    for (const stage of COMMAND_FILE_ORDER) {
      const content = await fs.readFile(path.join(root, ".cclaw/commands", `${stage}.md`), "utf8");
      expect(content).toContain("## HARD-GATE");
      expect(content).toContain("## Gates");
      expect(content).toContain("## Exit");
      expect(content).toContain("## Anchors");
      expect(content).toContain("SKILL.md");

      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThan(45);
    }
  });

  it("enforces TDD and two-layer review semantics in skills", async () => {
    const root = await createTempProject("tdd");
    await initCclaw({ projectRoot: root });

    const tddSkill = await fs.readFile(path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"), "utf8");
    const reviewSkill = await fs.readFile(path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"), "utf8");
    const shipSkill = await fs.readFile(path.join(root, ".cclaw/skills/shipping-and-handoff/SKILL.md"), "utf8");

    expect(tddSkill).toContain("RED");
    expect(tddSkill).toContain("GREEN");
    expect(reviewSkill).toContain("Layer 1");
    expect(reviewSkill).toContain("Layer 2");
    expect(shipSkill).toContain("finalization mode");
  });

  it("generates full skill set and harness flow commands", async () => {
    const root = await createTempProject("skills");
    await initCclaw({ projectRoot: root });

    for (const stage of COMMAND_FILE_ORDER) {
      const skillPath = path.join(root, ".cclaw/skills", stageSkillFolder(stage), "SKILL.md");
      const content = await fs.readFile(skillPath, "utf8");
      expect(content).toContain("## Process");
      expect(content).toContain("## Verification");
      expect(content).toContain("## Common Rationalizations");
      expect(content).toContain("## Red Flags");
    }

    for (const harnessDir of [
      ".claude/commands",
      ".cursor/commands",
      ".opencode/commands",
      ".codex/commands"
    ]) {
      for (const shim of ["cc.md", "cc-next.md", "cc-learn.md"]) {
        const shimPath = path.join(root, harnessDir, shim);
        const content = await fs.readFile(shimPath, "utf8");
        expect(content).toContain(".cclaw/skills/");
      }
    }
  });

  it("includes delegation pre-flight in completion protocol for stages with mandatory agents", async () => {
    const root = await createTempProject("delegation-protocol");
    await initCclaw({ projectRoot: root });

    const scopeSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/scope-shaping/SKILL.md"),
      "utf8"
    );
    const designSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/engineering-design-lock/SKILL.md"),
      "utf8"
    );
    const brainstormSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/brainstorming/SKILL.md"),
      "utf8"
    );

    expect(scopeSkill).toContain("Delegation pre-flight");
    expect(scopeSkill).toContain("delegation-log.json");
    expect(scopeSkill).toContain("`planner`");
    expect(designSkill).toContain("Delegation pre-flight");
    expect(designSkill).toContain("delegation-log.json");
    expect(brainstormSkill).not.toContain("Delegation pre-flight");
  });

  it("includes doctor pre-flight in completion protocol", async () => {
    const root = await createTempProject("doctor-protocol");
    await initCclaw({ projectRoot: root });

    const scopeSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/scope-shaping/SKILL.md"),
      "utf8"
    );
    expect(scopeSkill).toContain("Doctor pre-flight");
    expect(scopeSkill).toContain("cclaw doctor");
  });

  it("includes namedAntiPattern in spec skill", async () => {
    const root = await createTempProject("spec-anti");
    await initCclaw({ projectRoot: root });

    const specSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/specification-authoring/SKILL.md"),
      "utf8"
    );
    expect(specSkill).toContain("Implementation Will Clarify Requirements");
  });

  it("includes namedAntiPattern in plan skill", async () => {
    const root = await createTempProject("plan-anti");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    expect(planSkill).toContain("Task Details Can Be Finalized During Coding");
  });

  it("includes review sections in spec and plan skills", async () => {
    const root = await createTempProject("review-sections");
    await initCclaw({ projectRoot: root });

    const specSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/specification-authoring/SKILL.md"),
      "utf8"
    );
    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );

    expect(specSkill).toContain("Acceptance Criteria Audit");
    expect(specSkill).toContain("Testability Audit");
    expect(planSkill).toContain("Task Decomposition Audit");
    expect(planSkill).toContain("Wave Completeness Audit");
  });

  it("includes Risk-First and Diagnose Before Fix cognitive patterns in plan", async () => {
    const root = await createTempProject("plan-cognitive");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    expect(planSkill).toContain("Diagnose Before Fix");
    expect(planSkill).toContain("Scrap Signals");
    expect(planSkill).toContain("Risk-First Exploration");
  });

  it("includes Ambiguity Classification in design and spec skills", async () => {
    const root = await createTempProject("ambiguity");
    await initCclaw({ projectRoot: root });

    const designSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/engineering-design-lock/SKILL.md"),
      "utf8"
    );
    const specSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/specification-authoring/SKILL.md"),
      "utf8"
    );
    expect(designSkill).toContain("Ambiguity Classification");
    expect(specSkill).toContain("Ambiguity Classification");
  });

  it("matches golden snapshots for strict-stage content", async () => {
    const root = await createTempProject("golden");
    await initCclaw({ projectRoot: root });

    const brainstormSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/brainstorming/SKILL.md"),
      "utf8"
    );
    const reviewContract = await fs.readFile(
      path.join(root, ".cclaw/commands/review.md"),
      "utf8"
    );
    const shipContract = await fs.readFile(
      path.join(root, ".cclaw/commands/ship.md"),
      "utf8"
    );

    expect(brainstormSkill).toMatchSnapshot("brainstorm-skill");
    expect(reviewContract).toMatchSnapshot("review-contract");
    expect(shipContract).toMatchSnapshot("ship-contract");
  });

  it("matches golden snapshots for plan and tdd skills", async () => {
    const root = await createTempProject("golden-plan-tdd");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"),
      "utf8"
    );

    expect(planSkill).toMatchSnapshot("plan-skill");
    expect(tddSkill).toMatchSnapshot("tdd-skill");
  });

  it("matches golden snapshot for review skill", async () => {
    const root = await createTempProject("golden-review");
    await initCclaw({ projectRoot: root });

    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"),
      "utf8"
    );

    expect(reviewSkill).toMatchSnapshot("review-skill");
  });

  it("matches golden snapshot for ship skill", async () => {
    const root = await createTempProject("golden-ship");
    await initCclaw({ projectRoot: root });

    const shipSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/shipping-and-handoff/SKILL.md"),
      "utf8"
    );

    expect(shipSkill).toMatchSnapshot("ship-skill");
  });
});
