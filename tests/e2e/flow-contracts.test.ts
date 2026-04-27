import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSkillFolder } from "../../src/content/skills.js";
import { nextCommandContract } from "../../src/content/next-command.js";
import { startCommandContract } from "../../src/content/start-command.js";
import { SUBAGENT_CONTEXT_SKILLS } from "../../src/content/subagent-context-skills.js";
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


  it("preserves user language in generated prompts while keeping machine surfaces stable", async () => {
    const root = await createTempProject("language-policy");
    await initCclaw({ projectRoot: root });

    const paths = [
      ".cclaw/skills/using-cclaw/SKILL.md",
      ".cclaw/commands/start.md",
      ".cclaw/commands/next.md",
      ".cclaw/commands/ideate.md",
      ".cclaw/commands/view.md",
      ".cclaw/skills/brainstorming/SKILL.md",
      ".cclaw/skills/subagent-dev/SKILL.md",
      ".cclaw/agents/reviewer.md",
      "AGENTS.md"
    ];

    for (const rel of paths) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      expect(content, rel).toContain("Conversation Language Policy");
      expect(content, rel).toContain("latest substantive user message");
      expect(content, rel).toContain("Do not translate");
    }

    const codexCc = await fs.readFile(path.join(root, ".agents/skills/cc/SKILL.md"), "utf8");
    expect(codexCc).toContain("natural language");
    expect(codexCc).not.toContain("intent in English");
  });

  it("materializes subagent dispatch context skills", async () => {
    const root = await createTempProject("subagent-context-skills");
    await initCclaw({ projectRoot: root });

    for (const [skillName, expectedContent] of Object.entries(SUBAGENT_CONTEXT_SKILLS)) {
      const skillPath = path.join(root, ".cclaw/skills", skillName, "SKILL.md");
      const content = await fs.readFile(skillPath, "utf8");
      expect(content, skillName).toBe(expectedContent);
    }
  });

  it("routes /cc start and reclassification through managed start-flow helper", async () => {
    const root = await createTempProject("managed-start-flow-contract");
    await initCclaw({ projectRoot: root });

    const startCommand = await fs.readFile(path.join(root, ".cclaw/commands/start.md"), "utf8");
    const startSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-start/SKILL.md"), "utf8");

    for (const [label, content] of [["command", startCommand], ["skill", startSkill]] as const) {
      expect(content, label).toContain("node .cclaw/hooks/start-flow.mjs");
      expect(content, label).not.toContain("cclaw internal start-flow");
      expect(content, label).toContain("--reclassify");
      expect(content, label).toMatch(/do not manually edit/i);
      expect(content, label).toContain("fresh init placeholder");
      expect(content, label).toMatch(/do (?:\*\*)?not(?:\*\*)? ask/i);
    }

    expect(startCommand).not.toContain("Persist the chosen track to `.cclaw/state/flow-state.json`");
    expect(startSkill).not.toContain("Persist the chosen track in `.cclaw/state/flow-state.json`");
    expect(startCommand).not.toContain("update `flow-state.json` accordingly");
    expect(startCommand).toContain("quick track");
    expect(startSkill).toContain("`quick` track starts at `spec`");
    expect(startCommand).toContain("\"stage\":\"<currentStage>\"");
  });

  it("keeps trivial routing quick-only in generated meta skill", async () => {
    const root = await createTempProject("quick-only-meta");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "utf8");
    expect(metaSkill).toContain("| trivial software fix | `/cc <idea>` (quick track) |");
    expect(metaSkill).not.toContain("quick/medium track as recommended");
    expect(metaSkill).not.toContain("quick or medium track");
  });

  it("keeps bugfix fast path spec-first and examples placeholder-shaped", async () => {
    const root = await createTempProject("bugfix-spec-first");
    await initCclaw({ projectRoot: root });

    const startCommand = await fs.readFile(path.join(root, ".cclaw/commands/start.md"), "utf8");
    const startSkill = await fs.readFile(path.join(root, ".cclaw/skills/flow-start/SKILL.md"), "utf8");
    const nextCommand = await fs.readFile(path.join(root, ".cclaw/commands/next.md"), "utf8");

    for (const content of [startCommand, startSkill]) {
      expect(content).toMatch(/capture (?:a|the) reproduction contract first/);
      expect(content).toContain("RED reproduction test from that contract");
      expect(content).not.toContain("enter `tdd` with a RED reproduction test first");
    }

    expect(startCommandContract()).toContain('"stage":"<currentStage>"');
    expect(startCommandContract()).toContain('"track":"<track>"');
    expect(nextCommandContract()).toContain('"stage":"<currentStage>"');
    expect(nextCommandContract()).toContain('"nextStage":"<nextStage>"');
    expect(startCommand).not.toContain('"stage":"spec","payload":{"command":"/cc","track":"quick"');
    expect(nextCommand).not.toContain('"stage":"review","payload":{"command":"/cc-next","decision":"resume_or_advance","nextStage":"ship"');
  });

  it("documents cclaw-cli as installer/support and node hooks as runtime", async () => {
    const root = await createTempProject("runtime-boundary");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "utf8");
    expect(metaSkill).toContain("Installer/support surface");
    expect(metaSkill).toContain("npx cclaw-cli sync");
    expect(metaSkill).toContain("node .cclaw/hooks/stage-complete.mjs <stage>");

    const stageComplete = await fs.readFile(path.join(root, ".cclaw/hooks/stage-complete.mjs"), "utf8");
    expect(stageComplete).toContain("CCLAW_CLI_ENTRYPOINT");
    expect(stageComplete).toContain("advance-stage");
    expect(stageComplete).not.toContain("cclaw binary not found");
    expect(stageComplete).not.toContain("cmd.exe");

    const startFlow = await fs.readFile(path.join(root, ".cclaw/hooks/start-flow.mjs"), "utf8");
    expect(startFlow).toContain("CCLAW_CLI_ENTRYPOINT");
    expect(startFlow).toContain("start-flow");
    expect(startFlow).toContain("process.execPath");
    expect(startFlow).not.toContain("cclaw binary not found");
    expect(startFlow).not.toContain("cmd.exe");
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
      expect(content).toContain("## Exit Criteria");
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
    expect(scopeSkill).toContain("--waive-delegation=planner");
    expect(scopeSkill).toContain("completion helper JSON diagnostics");
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
    for (const label of ["standard:", "medium:", "quick:"]) {
      expect(metaSkill).toContain(label);
    }
    expect(metaSkill).toContain("retro -> compound -> archive");

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
    expect(metaSkill).toContain("SKILL");
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
    expect(brainstormSkill).toContain("Carrying forward: <1-3 bullets>");
    expect(brainstormSkill).toContain("Ask only decision-changing questions");
    expect(reviewSkill).toContain("Review Findings");
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
    expect(planSkill).toContain("highRisk");

    expect(tddSkill).toContain("Per-Slice Review");
    expect(tddSkill).toContain("sliceReview.enabled");
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
    expect(reviewSkill).toContain("Review Findings");
    expect(reviewSkill).toContain("Layer 1");
    expect(reviewSkill).toContain("Layer 2");
  });

  it("keeps quick-track generated templates aligned with schema contracts", async () => {
    const root = await createTempProject("quick-template-contracts");
    await initCclaw({ projectRoot: root });

    const designTemplate = await fs.readFile(path.join(root, ".cclaw/templates/03-design.md"), "utf8");
    const specTemplate = await fs.readFile(path.join(root, ".cclaw/templates/04-spec.md"), "utf8");
    const tddTemplate = await fs.readFile(path.join(root, ".cclaw/templates/06-tdd.md"), "utf8");
    const reviewTemplate = await fs.readFile(path.join(root, ".cclaw/templates/07-review.md"), "utf8");

    expect(designTemplate).toContain("## Compact-First Scaffold");
    expect(designTemplate).toContain("Compact required spine");
    expect(designTemplate).toContain("Omitted - compact design");

    expect(specTemplate).toContain("quick uses `00-idea.md` plus reproduction context");
    expect(specTemplate).toContain("## Quick Reproduction Contract");
    expect(specTemplate).toContain("Expected RED test behavior");
    expect(specTemplate).toContain("TDD turns this contract into the RED reproduction test");

    expect(tddTemplate).toContain("Quick track uses spec acceptance items / bug reproduction slices");
    expect(tddTemplate).toContain("Plan task ID or quick source");
    expect(tddTemplate).toContain("Do not invent a plan task");

    expect(reviewTemplate).toContain("Quick track reviews spec acceptance items / bug reproduction slices");
    expect(reviewTemplate).toContain("N/A - quick track has no plan artifact");
    expect(reviewTemplate).toContain("direct AC/reproduction-slice coverage");
  });

  it("keeps meta-skill utility routing limited to generated helper surfaces", async () => {
    const root = await createTempProject("honest-meta-utilities");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "utf8");
    const generatedSkillDirs = (await fs.readdir(path.join(root, ".cclaw/skills"))).sort();

    for (const expected of ["subagent-dev", "parallel-dispatch", "session", "iron-laws"]) {
      expect(generatedSkillDirs).toContain(expected);
      expect(metaSkill).toContain(expected);
    }

    for (const missingUtility of [
      "verification-before-completion",
      "finishing-a-development-branch",
      "security",
      "performance",
      "debugging",
      "docs"
    ]) {
      expect(generatedSkillDirs).not.toContain(missingUtility);
      expect(metaSkill).not.toContain(`\`${missingUtility}\``);
    }

    expect(metaSkill).toContain("Do not invent helper-skill names");
    expect(metaSkill).toContain(".cclaw/rules/lang/");
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
