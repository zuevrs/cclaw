import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("ideate utility surface", () => {
  it("emits ideate command and skill contracts", async () => {
    const root = await createTempProject("ideate-surface");
    await initCclaw({ projectRoot: root });

    const ideateContract = await fs.readFile(path.join(root, ".cclaw/commands/ideate.md"), "utf8");
    const ideateSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-ideate/SKILL.md"), "utf8");

    expect(ideateContract).toContain("ranked backlog");
    expect(ideateSkill).toContain("## HARD-GATE");
  });

  it("persists ideate artifact, supports resume, and ends with concrete handoff options", async () => {
    const root = await createTempProject("ideate-handoff");
    await initCclaw({ projectRoot: root });

    const ideateContract = await fs.readFile(path.join(root, ".cclaw/commands/ideate.md"), "utf8");
    const ideateSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-ideate/SKILL.md"), "utf8");

    // Persisted artifact is a hard-gate, not a suggestion.
    expect(ideateContract).toContain(".cclaw/artifacts/ideate-<YYYY-MM-DD-slug>.md");
    expect(ideateSkill).toContain(".cclaw/artifacts/ideate-<YYYY-MM-DD-slug>.md");
    expect(ideateSkill).toMatch(/always produce the artifact file on disk/i);

    // Must not mutate flow-state (utility skill, not a stage).
    expect(ideateSkill).toMatch(/do not mutate .*flow-state\.json/i);

    // Resume check for ideate-*.md younger than 30 days.
    expect(ideateSkill).toContain("ideate-*.md");
    expect(ideateSkill).toContain("30 days");

    // Handoff stays concrete without pinning exact option copy.
    expect(ideateSkill).toContain("Required options");
    expect(ideateSkill).toMatch(/no bare A\/B\/C/i);

    // Handoff loads /cc in-session rather than asking the user to retype it.
    expect(ideateSkill).toContain(".cclaw/skills/using-cclaw/SKILL.md");
    expect(ideateSkill).toContain("/cc <");
  });
});
