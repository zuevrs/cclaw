import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("idea utility surface", () => {
  it("emits idea command and skill contracts", async () => {
    const root = await createTempProject("idea-surface");
    await initCclaw({ projectRoot: root });

    const ideaContract = await fs.readFile(path.join(root, ".cclaw/commands/idea.md"), "utf8");
    const ideaSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-idea/SKILL.md"), "utf8");

    expect(ideaContract).toContain("ranked backlog");
    expect(ideaSkill).toContain("## HARD-GATE");
  });

  it("persists idea artifact, supports resume, and ends with concrete handoff options", async () => {
    const root = await createTempProject("idea-handoff");
    await initCclaw({ projectRoot: root });

    const ideaContract = await fs.readFile(path.join(root, ".cclaw/commands/idea.md"), "utf8");
    const ideaSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-idea/SKILL.md"), "utf8");

    // Persisted artifact is a hard-gate, not a suggestion.
    expect(ideaContract).toContain(".cclaw/artifacts/idea-<YYYY-MM-DD-slug>.md");
    expect(ideaSkill).toContain(".cclaw/artifacts/idea-<YYYY-MM-DD-slug>.md");
    expect(ideaSkill).toMatch(/whenever ideation output is produced, persist the artifact file on disk/i);

    // Must not mutate flow-state (utility skill, not a stage).
    expect(ideaSkill).toMatch(/do not mutate .*flow-state\.json/i);

    // Resume check for idea-*.md younger than 30 days.
    expect(ideaSkill).toContain("idea-*.md");
    expect(ideaSkill).toContain("30 days");

    // Handoff stays concrete without pinning exact option copy.
    expect(ideaSkill).toContain("Required options");
    expect(ideaSkill).toMatch(/no bare A\/B\/C/i);

    // Handoff loads /cc in-session rather than asking the user to retype it.
    expect(ideaSkill).toContain(".cclaw/skills/using-cclaw/SKILL.md");
    expect(ideaSkill).toContain("/cc <");
  });
});
