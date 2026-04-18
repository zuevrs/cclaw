import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("ideate and compound utility surfaces", () => {
  it("emits ops router, ideate and compound command + skill contracts", async () => {
    const root = await createTempProject("ideate-compound");
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

  it("embeds a drift checklist in the compound skill and contract", async () => {
    const root = await createTempProject("compound-drift");
    await initCclaw({ projectRoot: root });

    const compoundContract = await fs.readFile(path.join(root, ".cclaw/commands/compound.md"), "utf8");
    const compoundSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-compound/SKILL.md"), "utf8");

    expect(compoundContract).toContain("Drift check");
    expect(compoundSkill).toContain("Drift check");
    expect(compoundSkill).toContain("Read the lift target");
    expect(compoundSkill).toContain("Grep for contradictions");
    expect(compoundSkill).toContain("last_seen_ts");
    expect(compoundSkill).toContain("superseding");
    expect(compoundSkill).toContain("Cite line IDs");
    expect(compoundSkill).toContain("Freshness:");
  });
});
