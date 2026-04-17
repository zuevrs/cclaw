import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("phase 4-6 regression surfaces", () => {
  it("keeps utility command parity across harness shims", async () => {
    const root = await createTempProject("phase46-harness");
    await initCclaw({ projectRoot: root });

    for (const harnessDir of [
      ".claude/commands",
      ".cursor/commands",
      ".opencode/commands",
      ".codex/commands"
    ]) {
      for (const shim of ["cc.md", "cc-next.md", "cc-learn.md", "cc-ops.md", "cc-ideate.md"]) {
        const shimPath = path.join(root, harnessDir, shim);
        const content = await fs.readFile(shimPath, "utf8");
        expect(content).toContain(".cclaw/skills/");
      }
    }
  });

  it("routes ops compound and emits ideate/compound utility surfaces", async () => {
    const root = await createTempProject("phase46-commands");
    await initCclaw({ projectRoot: root });

    const opsContract = await fs.readFile(path.join(root, ".cclaw/commands/ops.md"), "utf8");
    const ideateContract = await fs.readFile(path.join(root, ".cclaw/commands/ideate.md"), "utf8");
    const compoundContract = await fs.readFile(path.join(root, ".cclaw/commands/compound.md"), "utf8");
    const ideateSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-ideate/SKILL.md"), "utf8");
    const compoundSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-compound/SKILL.md"), "utf8");

    expect(opsContract).toContain("compound");
    expect(ideateContract).toContain("ranked backlog");
    expect(compoundContract).toContain("knowledge.jsonl");
    expect(ideateSkill).toContain("## HARD-GATE");
    expect(compoundSkill).toContain("## HARD-GATE");
  });

  it("keeps announce discipline and expanded ethos references", async () => {
    const root = await createTempProject("phase46-announce");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"),
      "utf8"
    );
    const ethos = await fs.readFile(
      path.join(root, ".cclaw/references/protocols/ethos.md"),
      "utf8"
    );
    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );

    expect(planSkill).toContain("Announce at start:");
    expect(reviewSkill).toContain("Announce at start:");
    expect(ethos).toContain("Boil the Lake");
    expect(ethos).toContain("User Sovereignty");
    expect(metaSkill).toContain("/cc-ideate");
    expect(metaSkill).toContain("/cc-ops [feature|tdd-log|retro|compound|archive|rewind]");
  });
});
