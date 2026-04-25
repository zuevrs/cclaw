import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSkillFolder } from "../../src/content/skills.js";
import { initCclaw } from "../../src/install.js";
import { FLOW_STAGES } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

function expectStageSkillContract(content: string): void {
  for (const anchor of [
    "## Process",
    "## Context Loading",
    "## Required Gates",
    "## Required Evidence",
    "## Completion Parameters",
    "## Artifact Validation",
    "## Shared Stage Guidance"
  ]) {
    expect(content).toContain(anchor);
  }
  expect(content).toContain("Carry upstream decisions forward explicitly");
  expect(content).toContain("stage-complete.mjs");
}

describe("flow command contracts", () => {
  it("creates only the four user-facing command contracts", async () => {
    const root = await createTempProject("flow");
    await initCclaw({ projectRoot: root });

    const entries = (await fs.readdir(path.join(root, ".cclaw/commands"))).sort();
    expect(entries).toEqual(["ideate.md", "next.md", "start.md", "view.md"]);

    for (const fileName of entries) {
      const content = await fs.readFile(path.join(root, ".cclaw/commands", fileName), "utf8");
      expect(content).toContain("## HARD-GATE");
      expect(content).toContain("SKILL.md");
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
      for (const shim of ["cc.md", "cc-next.md", "cc-ideate.md", "cc-view.md"]) {
        const shimPath = path.join(root, harnessDir, shim);
        const content = await fs.readFile(shimPath, "utf8");
        expect(content).toContain(".cclaw/skills/");
      }
    }

    // Codex uses skill-kind shims under `.agents/skills/cc*/SKILL.md`
    // since v0.40.0 (renamed from `cclaw-cc*` in v0.39.x). Codex CLI
    // reads that path, not `.codex/commands/`.
    for (const skillName of ["cc", "cc-next", "cc-ideate", "cc-view"]) {
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

  it("keeps completion protocol inline and stage parameters explicit", async () => {
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

    expect(scopeSkill).toContain("Completion protocol: verify required gates");
    expect(scopeSkill).toContain("`mandatory delegations`");
    expect(scopeSkill).toContain("`planner`");
    expect(designSkill).toContain("`mandatory delegations`");
    expect(designSkill).toContain("`planner`");
    expect(brainstormSkill).toContain("`mandatory delegations`: none");
  });

  it("routes meta skill to inline protocol behavior", async () => {
    const root = await createTempProject("doctor-protocol");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );
    expect(metaSkill).toContain("Protocol Behavior");
    expect(metaSkill).toContain("ask only decision-changing questions");
    expect(metaSkill).toContain("verify gates before advancing");
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

  it("keeps compact orientation pointers in meta-skill and /cc-next", async () => {
    const root = await createTempProject("flow-map-ref");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );
    expect(metaSkill).toContain(".cclaw/state/flow-state.json");
    expect(metaSkill).toContain("## Whole flow map");
    expect(metaSkill).toContain("standard: brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship -> retro -> compound -> archive");
    expect(metaSkill).toContain("medium: brainstorm -> spec -> plan -> tdd -> review -> ship -> retro -> compound -> archive");
    expect(metaSkill).toContain("quick: spec -> tdd -> review -> ship -> retro -> compound -> archive");

    const nextCommand = await fs.readFile(
      path.join(root, ".cclaw/commands/next.md"),
      "utf8"
    );
    expect(nextCommand).toContain(".cclaw/state/flow-state.json");
    expect(nextCommand).toContain("closeout.shipSubstate");
    expect(nextCommand).toContain("retro -> compound -> archive");
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

  it("includes inline shared guidance in spec and plan skills", async () => {
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
    expect(specSkill).toContain("## Shared Stage Guidance");
    expect(specSkill).toContain("Keep decisions explicit");
    expect(planSkill).toContain("## Shared Stage Guidance");
    expect(planSkill).toContain("Keep decisions explicit");
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

  it("inlines decision protocol in design and spec skills", async () => {
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
    expect(designSkill).toContain("Decision protocol: ask only decision-changing questions");
    expect(specSkill).toContain("Decision protocol: ask only decision-changing questions");
  });

  it("keeps contract anchors for strict-stage content", async () => {
    const root = await createTempProject("strict-stage-anchors");
    await initCclaw({ projectRoot: root });

    const brainstormSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/brainstorming/SKILL.md"),
      "utf8"
    );
    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"),
      "utf8"
    );
    const shipSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/shipping-and-handoff/SKILL.md"),
      "utf8"
    );

    expectStageSkillContract(brainstormSkill);
    expectStageSkillContract(reviewSkill);
    expectStageSkillContract(shipSkill);
    expect(brainstormSkill).toContain("Selected Direction");
    expect(reviewSkill).toContain("Review Army");
    expect(shipSkill).toContain("finalization mode");
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

  it("keeps contract anchors for plan and tdd skills", async () => {
    const root = await createTempProject("plan-tdd-anchors");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/planning-and-task-breakdown/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/test-driven-development/SKILL.md"),
      "utf8"
    );

    expectStageSkillContract(planSkill);
    expectStageSkillContract(tddSkill);
    expect(planSkill).toContain("Dependency Batches");
    expect(tddSkill).toContain("RED -> GREEN -> REFACTOR");
  });

  it("keeps review skill contract anchors", async () => {
    const root = await createTempProject("review-anchors");
    await initCclaw({ projectRoot: root });

    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/two-layer-review/SKILL.md"),
      "utf8"
    );

    expectStageSkillContract(reviewSkill);
    expect(reviewSkill).toContain("Review Army");
    expect(reviewSkill).toContain("Layer 1");
    expect(reviewSkill).toContain("Layer 2");
  });

  it("keeps ship skill contract anchors", async () => {
    const root = await createTempProject("ship-anchors");
    await initCclaw({ projectRoot: root });

    const shipSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/shipping-and-handoff/SKILL.md"),
      "utf8"
    );

    expectStageSkillContract(shipSkill);
    expect(shipSkill).toContain("FINALIZE_OPEN_PR");
    expect(shipSkill).toContain("Rollback Plan");
  });
});
