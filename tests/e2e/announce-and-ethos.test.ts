import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("announce-at-start discipline and ethos principles", () => {
  it("embeds announce-at-start in stage skills and lists new principles in ethos/meta", async () => {
    const root = await createTempProject("announce-ethos");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"),
      "utf8"
    );
    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );

    expect(planSkill).toContain("Announce at start:");
    expect(reviewSkill).toContain("Announce at start:");
    expect(reviewSkill).toContain("Decision protocol: ask only decision-changing questions");
    expect(metaSkill).toContain("/cc-ideate");
    expect(metaSkill).toContain("/cc-cancel");
  });
});
