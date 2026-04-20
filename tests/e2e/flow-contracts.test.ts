import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSkillFolder } from "../../src/content/skills.js";
import { initCclaw } from "../../src/install.js";
import { FLOW_STAGES } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

describe("flow command contracts", () => {
  it("creates thin command contracts with required sections", async () => {
    const root = await createTempProject("flow");
    await initCclaw({ projectRoot: root });

    for (const stage of FLOW_STAGES) {
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

    for (const stage of FLOW_STAGES) {
      const skillPath = path.join(root, ".cclaw/skills", stageSkillFolder(stage), "SKILL.md");
      const content = await fs.readFile(skillPath, "utf8");
      expect(content).toContain("## Process");
      expect(content).toContain("## Verification");
      expect(content).toContain("## Completion Parameters");
      expect(content).toContain("## Shared Stage Guidance");
      expect(content).toContain("## Anti-Patterns & Red Flags");
    }

    for (const harnessDir of [
      ".claude/commands",
      ".cursor/commands",
      ".opencode/commands"
    ]) {
      for (const shim of ["cc.md", "cc-next.md", "cc-ideate.md", "cc-view.md", "cc-ops.md"]) {
        const shimPath = path.join(root, harnessDir, shim);
        const content = await fs.readFile(shimPath, "utf8");
        expect(content).toContain(".cclaw/skills/");
      }
    }

    // Codex uses skill-kind shims under `.agents/skills/cc*/SKILL.md`
    // since v0.40.0 (renamed from `cclaw-cc*` in v0.39.x). Codex CLI
    // reads that path, not `.codex/commands/`.
    for (const skillName of ["cc", "cc-next", "cc-ideate", "cc-view", "cc-ops"]) {
      const skillPath = path.join(root, ".agents/skills", skillName, "SKILL.md");
      const content = await fs.readFile(skillPath, "utf8");
      expect(content).toContain(`name: ${skillName}`);
      expect(content).toContain(".cclaw/skills/");
    }

    // Codex hooks are managed again since v0.40.0.
    const codexHooksPath = path.join(root, ".codex/hooks.json");
    const codexHooksRaw = await fs.readFile(codexHooksPath, "utf8");
    const codexHooks = JSON.parse(codexHooksRaw) as { hooks: Record<string, unknown> };
    expect(codexHooks.hooks).toHaveProperty("SessionStart");
    expect(codexHooks.hooks).toHaveProperty("PreToolUse");
    expect(codexHooks.hooks).toHaveProperty("PostToolUse");
    expect(codexHooks.hooks).toHaveProperty("Stop");

    // Legacy v0.39.x skill layout must be absent (fresh install writes
    // `cc*`, not `cclaw-cc*`).
    for (const legacySkill of ["cclaw-cc", "cclaw-cc-next", "cclaw-cc-view"]) {
      await expect(
        fs.stat(path.join(root, ".agents/skills", legacySkill))
      ).rejects.toThrow(/ENOENT/);
    }

    // The legacy `.codex/commands/` directory must not be created.
    await expect(fs.stat(path.join(root, ".codex/commands"))).rejects.toThrow(/ENOENT/);
  });

  it("keeps completion protocol externalized and stage parameters explicit", async () => {
    const root = await createTempProject("delegation-protocol");
    await initCclaw({ projectRoot: root });

    const completionProtocol = await fs.readFile(
      path.join(root, ".cclaw/references/protocols/completion.md"),
      "utf8"
    );
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

    expect(completionProtocol).toContain("mandatory delegations are completed");
    expect(completionProtocol).toContain("Run `npx cclaw doctor`");
    expect(scopeSkill).toContain("`.cclaw/references/protocols/completion.md`");
    expect(scopeSkill).toContain("`mandatory delegations`");
    expect(scopeSkill).toContain("`planner`");
    expect(designSkill).toContain("`mandatory delegations`");
    expect(designSkill).toContain("`planner`");
    expect(brainstormSkill).toContain("`mandatory delegations`: none");
  });

  it("routes meta skill to shared protocol references", async () => {
    const root = await createTempProject("doctor-protocol");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );
    const decisionProtocol = await fs.readFile(
      path.join(root, ".cclaw/references/protocols/decision.md"),
      "utf8"
    );
    expect(metaSkill).toContain("Protocol references");
    expect(metaSkill).toContain(".cclaw/references/protocols/decision.md");
    expect(metaSkill).toContain(".cclaw/references/protocols/completion.md");
    expect(decisionProtocol).toContain("# Decision Protocol");
  });

  it("requires spec skill to chunk acceptance criteria for sign-off", async () => {
    const root = await createTempProject("spec-chunking");
    await initCclaw({ projectRoot: root });

    const specSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/specification-authoring/SKILL.md"),
      "utf8"
    );

    expect(specSkill).toContain("Chunk acceptance criteria for review");
    expect(specSkill).toContain("batches of 3-5");
    expect(specSkill).toContain("pause for explicit ACK");
    expect(specSkill).toContain(
      "Present acceptance criteria to the user in 3-5-item batches"
    );
  });

  it("encodes the Decision Protocol skeleton and completeness calibration", async () => {
    const root = await createTempProject("decision-skeleton");
    await initCclaw({ projectRoot: root });

    const decisionProtocol = await fs.readFile(
      path.join(root, ".cclaw/references/protocols/decision.md"),
      "utf8"
    );

    expect(decisionProtocol).toContain("## Decision skeleton");
    expect(decisionProtocol).toContain("Re-ground");
    expect(decisionProtocol).toContain("Simplify");
    expect(decisionProtocol).toContain("RECOMMENDATION: Choose [Letter]");
    expect(decisionProtocol).toContain("Completeness: X/10");

    expect(decisionProtocol).toContain("## Completeness calibration");
    expect(decisionProtocol).toContain("**10** = complete implementation");
    expect(decisionProtocol).toContain("**3** = shortcut");

    expect(decisionProtocol).toContain(
      "Log the chosen letter into the stage artifact's decision log"
    );
  });

  it("requires the meta-skill to declare a skill-before-response gate", async () => {
    const root = await createTempProject("skill-gate");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );

    expect(metaSkill).toContain("## Skill-before-response gate");
    expect(metaSkill).toContain("load the matching stage SKILL before producing");
    expect(metaSkill).toContain("Substantive");
    expect(metaSkill).toContain("Non-substantive");
    expect(metaSkill).toContain("/cc");
  });

  it("includes shared guidance references in spec and plan skills", async () => {
    const root = await createTempProject("spec-anti");
    await initCclaw({ projectRoot: root });

    const specSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/specification-authoring/SKILL.md"),
      "utf8"
    );
    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    expect(specSkill).toContain("common-guidance.md");
    expect(planSkill).toContain("common-guidance.md");
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
    expect(planSkill).toContain("Batch Completeness Audit");
  });

  it("includes completion parameters in plan skill", async () => {
    const root = await createTempProject("plan-cognitive");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    expect(planSkill).toContain("## Completion Parameters");
    expect(planSkill).toContain("`mandatory delegations`");
  });

  it("references decision protocol in design and spec skills", async () => {
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
    expect(designSkill).toContain(".cclaw/references/protocols/decision.md");
    expect(specSkill).toContain(".cclaw/references/protocols/decision.md");
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

  it("emits conditional slice-review guidance in plan and tdd skills", async () => {
    const root = await createTempProject("slice-review-guidance");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"),
      "utf8"
    );

    expect(planSkill).toContain("sliceReview.enabled");
    expect(planSkill).toContain("touchCount");
    expect(planSkill).toContain("touchPaths");
    expect(planSkill).toContain("highRisk");

    expect(tddSkill).toContain("Per-Slice Review");
    expect(tddSkill).toContain("sliceReview.enabled");
    expect(tddSkill).toContain("filesChangedThreshold");
    expect(tddSkill).toContain("touchTriggers");
    expect(tddSkill).toContain("enforceOnTracks");
    expect(tddSkill).toContain("Spec-Compliance");
    expect(tddSkill).toContain("Quality");
    expect(tddSkill).toContain("fulfillmentMode");
    expect(tddSkill).toContain("reviewer");
    expect(tddSkill).toContain("Per-Slice Review Audit (conditional)");
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
