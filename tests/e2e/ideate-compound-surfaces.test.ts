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

  it("persists ideation artifact, supports resume, and ends with concrete handoff options", async () => {
    const root = await createTempProject("ideate-handoff");
    await initCclaw({ projectRoot: root });

    const ideateContract = await fs.readFile(path.join(root, ".cclaw/commands/ideate.md"), "utf8");
    const ideateSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-ideate/SKILL.md"), "utf8");

    // Persisted artifact is a hard-gate, not a suggestion.
    expect(ideateContract).toContain(".cclaw/artifacts/ideation-<YYYY-MM-DD-slug>.md");
    expect(ideateSkill).toContain(".cclaw/artifacts/ideation-<YYYY-MM-DD-slug>.md");
    expect(ideateSkill).toMatch(/always produce the artifact file on disk/i);

    // Must not mutate flow-state (utility skill, not a stage).
    expect(ideateSkill).toMatch(/do not mutate .*flow-state\.json/i);

    // Resume check for ideation-*.md younger than 30 days.
    expect(ideateSkill).toContain("ideation-*.md");
    expect(ideateSkill).toContain("30 days");
    expect(ideateSkill).toMatch(/Continue the existing backlog/i);
    expect(ideateSkill).toMatch(/Start a fresh scan/i);

    // Handoff prompt has four named options, not bare A/B/C.
    expect(ideateSkill).toMatch(/Start \/cc on the top recommendation/);
    expect(ideateSkill).toMatch(/Pick a different candidate/);
    expect(ideateSkill).toMatch(/Save and close/);
    expect(ideateSkill).toMatch(/Discard/);
    expect(ideateSkill).toMatch(/no bare A\/B\/C/i);

    // Handoff loads /cc in-session rather than asking the user to retype it.
    expect(ideateSkill).toContain(".cclaw/skills/using-cclaw/SKILL.md");
    expect(ideateSkill).toMatch(/Handing off to \/cc/);
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
