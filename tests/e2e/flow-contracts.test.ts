import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_FILE_ORDER } from "../../src/constants.js";
import { stageSkillFolder } from "../../src/content/skills.js";
import { initCclaw } from "../../src/install.js";

describe("flow command contracts", () => {
  it("creates thin command contracts with required sections", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-flow-"));
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tdd-"));
    await initCclaw({ projectRoot: root });

    const testSkill = await fs.readFile(path.join(root, ".cclaw/skills/red-first-testing/SKILL.md"), "utf8");
    const buildSkill = await fs.readFile(path.join(root, ".cclaw/skills/incremental-implementation/SKILL.md"), "utf8");
    const reviewSkill = await fs.readFile(path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"), "utf8");
    const shipSkill = await fs.readFile(path.join(root, ".cclaw/skills/shipping-and-handoff/SKILL.md"), "utf8");

    expect(testSkill).toContain("RED");
    expect(buildSkill).toContain("GREEN");
    expect(reviewSkill).toContain("Layer 1");
    expect(reviewSkill).toContain("Layer 2");
    expect(shipSkill).toContain("finalization mode");
  });

  it("generates full skill set and harness flow commands", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-skills-"));
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

  it("matches golden snapshots for strict-stage content", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-golden-"));
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
});
