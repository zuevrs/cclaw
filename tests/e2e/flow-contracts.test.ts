import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSkillFolder } from "../../src/content/skills.js";
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
  it("does not create flow-state placeholder during init", async () => {
    const root = await createTempProject("flow-init-no-placeholder");
    await initCclaw({ projectRoot: root });

    await expect(
      fs.stat(path.join(root, ".cclaw/state/flow-state.json"))
    ).rejects.toThrow(/ENOENT/);
  });

  it("creates user-facing command contracts and thin stage shims", async () => {
    const root = await createTempProject("flow");
    await initCclaw({ projectRoot: root });

    const entries = (await fs.readdir(path.join(root, ".cclaw/commands"))).sort();
    expect(entries).toEqual([
      "brainstorm.md",
      "cancel.md",
      "design.md",
      "idea.md",
      "plan.md",
      "review.md",
      "scope.md",
      "ship.md",
      "spec.md",
      "start.md",
      "tdd.md",
      "view.md"
    ]);

    for (const fileName of ["idea.md", "start.md", "view.md"]) {
      const content = await fs.readFile(path.join(root, ".cclaw/commands", fileName), "utf8");
      expect(content).toContain("## HARD-GATE");
      expect(content).toContain("SKILL.md");
    }
    await expect(fs.stat(path.join(root, ".cclaw/commands/finish.md"))).rejects.toThrow(/ENOENT/);
    const cancelCommand = await fs.readFile(path.join(root, ".cclaw/commands/cancel.md"), "utf8");
    expect(cancelCommand).toContain("node .cclaw/hooks/cancel-run.mjs --reason");
    expect(cancelCommand).toContain("required reason");
    expect(cancelCommand).not.toContain("cclaw archive");

    for (const legacyFolder of [
      "brainstorming",
      "scope-shaping",
      "engineering-design-lock",
      "specification-authoring",
      "planning-and-task-breakdown",
      "test-driven-development",
      "two-layer-review",
      "shipping-and-handoff"
    ]) {
      await expect(fs.stat(path.join(root, ".cclaw/skills", legacyFolder))).rejects.toThrow(/ENOENT/);
    }

    for (const stage of FLOW_STAGES) {
      const content = await fs.readFile(path.join(root, ".cclaw/commands", `${stage}.md`), "utf8");
      expect(content).toContain(`.cclaw/skills/${stageSkillFolder(stage)}/SKILL.md`);
      expect(content).toContain("Normal stage resume and advancement uses `/cc`");
      expect(content).toContain("Do not duplicate the stage protocol here");
      expect(content).not.toContain("## Process");
      expect(content).not.toContain("## Required Gates");
    }
  });


  it("preserves user language in generated prompts while keeping machine surfaces stable", async () => {
    const root = await createTempProject("language-policy");
    await initCclaw({ projectRoot: root });

    const fullPolicyPaths = [
      ".cclaw/skills/using-cclaw/SKILL.md",
      ".cclaw/commands/start.md",
      ".cclaw/commands/idea.md",
      ".cclaw/commands/view.md",
      ".cclaw/skills/subagent-dev/SKILL.md",
      ".cclaw/agents/reviewer.md",
      "AGENTS.md"
    ];
    const pointerPolicyPaths = [
      ".cclaw/skills/brainstorm/SKILL.md"
    ];

    for (const rel of fullPolicyPaths) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      expect(content, rel).toContain("Conversation Language Policy");
      expect(content, rel).toContain("latest substantive user message");
      expect(content, rel).toContain("Do not translate");
    }
    for (const rel of pointerPolicyPaths) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      expect(content, rel).toContain("Conversation Language Policy");
      expect(content, rel).toContain("using-cclaw");
      expect(content, rel).not.toContain("latest substantive user message");
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

    for (const content of [startCommand, startSkill]) {
      expect(content).toMatch(/capture (?:a|the) reproduction contract first/);
      expect(content).toContain("RED reproduction test from that contract");
      expect(content).not.toContain("enter `tdd` with a RED reproduction test first");
    }

    expect(startCommandContract()).toContain('"stage":"<currentStage>"');
    expect(startCommandContract()).toContain('"track":"<track>"');
    expect(startCommand).not.toContain('"stage":"spec","payload":{"command":"/cc","track":"quick"');
  });

  it("documents cclaw-cli as installer/support and node hooks as runtime", async () => {
    const root = await createTempProject("runtime-boundary");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "utf8");
    expect(metaSkill).toContain("Installer/support surface");
    expect(metaSkill).toContain("npx cclaw-cli sync");
    expect(metaSkill).toContain("Main workflow");
    expect(metaSkill).toContain("`/cc-cancel`");
    expect(metaSkill).not.toContain("npx cclaw-cli archive");

    const stageComplete = await fs.readFile(path.join(root, ".cclaw/hooks/stage-complete.mjs"), "utf8");
    expect(stageComplete).toContain("CCLAW_CLI_ENTRYPOINT");
    expect(stageComplete).toContain("advance-stage");
    expect(stageComplete).not.toContain("cclaw binary not found");
    expect(stageComplete).not.toContain("cmd.exe");

    const startFlow = await fs.readFile(path.join(root, ".cclaw/hooks/start-flow.mjs"), "utf8");
    expect(startFlow).toContain("CCLAW_CLI_ENTRYPOINT");
    expect(startFlow).toContain("start-flow");
    expect(startFlow).toContain("CCLAW_START_FLOW_QUIET");
    expect(startFlow).toContain("--quiet");
    expect(startFlow).toContain("process.execPath");
    expect(startFlow).not.toContain("cclaw binary not found");
    expect(startFlow).not.toContain("cmd.exe");

    const cancelRun = await fs.readFile(path.join(root, ".cclaw/hooks/cancel-run.mjs"), "utf8");
    expect(cancelRun).toContain("CCLAW_CLI_ENTRYPOINT");
    expect(cancelRun).toContain("cancel-run");
    expect(cancelRun).toContain("process.execPath");
    expect(cancelRun).not.toContain("cclaw binary not found");
  });

  it("enforces TDD and two-layer review semantics in skills", async () => {
    const root = await createTempProject("tdd");
    await initCclaw({ projectRoot: root });

    const tddSkill = await fs.readFile(path.join(root, ".cclaw/skills/tdd/SKILL.md"), "utf8");
    const reviewSkill = await fs.readFile(path.join(root, ".cclaw/skills/review/SKILL.md"), "utf8");
    const shipSkill = await fs.readFile(path.join(root, ".cclaw/skills/ship/SKILL.md"), "utf8");

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
      for (const shim of ["cc.md", "cc-idea.md", "cc-cancel.md"]) {
        const shimPath = path.join(root, harnessDir, shim);
        const content = await fs.readFile(shimPath, "utf8");
        expect(content).toContain(".cclaw/skills/");
      }
      for (const staleShim of ["cc-view.md", "cc-finish.md", ...FLOW_STAGES.map((stage) => `cc-${stage}.md`)]) {
        await expect(fs.stat(path.join(root, harnessDir, staleShim))).rejects.toThrow(/ENOENT/);
      }
    }

    // Codex uses skill-kind shims under `.agents/skills/cc*/SKILL.md`
    // since v0.40.0 (renamed from `cclaw-cc*` in v0.39.x). Codex CLI
    // reads that path, not `.codex/commands/`.
    for (const skillName of ["cc", "cc-idea", "cc-cancel"]) {
      const skillPath = path.join(root, ".agents/skills", skillName, "SKILL.md");
      const content = await fs.readFile(skillPath, "utf8");
      expect(content).toContain(`name: ${skillName}`);
      expect(content).toContain(".cclaw/skills/");
    }
    for (const staleSkill of ["cc-view", "cc-finish", ...FLOW_STAGES.map((stage) => `cc-${stage}`)]) {
      await expect(fs.stat(path.join(root, ".agents/skills", staleSkill))).rejects.toThrow(/ENOENT/);
    }

    for (const agentName of [
      "researcher",
      "architect",
      "spec-validator",
      "spec-document-reviewer",
      "coherence-reviewer",
      "scope-guardian-reviewer",
      "feasibility-reviewer",
      "slice-implementer",
      "release-reviewer",
      "product-discovery",
      "critic",
      "planner",
      "reviewer",
      "security-reviewer",
      "test-author",
      "doc-updater",
      "divergent-thinker",
      "fixer",
      "integration-overseer"
    ]) {
      const opencodeAgent = await fs.readFile(path.join(root, ".opencode/agents", `${agentName}.md`), "utf8");
      const codexAgent = await fs.readFile(path.join(root, ".codex/agents", `${agentName}.toml`), "utf8");
      expect(opencodeAgent).toContain(`# ${agentName}`);
      expect(codexAgent).toContain(`name = "${agentName}"`);
      expect(codexAgent).toContain("developer_instructions");
    }

    const generatedDiscovery = await fs.readFile(path.join(root, ".cclaw/agents/product-discovery.md"), "utf8");
    const generatedCritic = await fs.readFile(path.join(root, ".cclaw/agents/critic.md"), "utf8");
    const generatedDivergentThinker = await fs.readFile(path.join(root, ".cclaw/agents/divergent-thinker.md"), "utf8");
    const generatedIntegrationOverseer = await fs.readFile(path.join(root, ".cclaw/agents/integration-overseer.md"), "utf8");
    expect(generatedDiscovery).toContain("Mode: discovery");
    expect(generatedCritic).toContain("Pre-commitment predictions");
    expect(generatedDivergentThinker).toContain("Generate 3-5 alternative framings");
    expect(generatedIntegrationOverseer).toContain("integration overseer");
    const generatedSliceImplementer = await fs.readFile(path.join(root, ".cclaw/agents/slice-implementer.md"), "utf8");
    expect(generatedSliceImplementer).toContain("STRICT_RETURN_SCHEMA");

    // Codex hooks are managed again since v0.40.0.
    const codexHooksPath = path.join(root, ".codex/hooks.json");
    const codexHooksRaw = await fs.readFile(codexHooksPath, "utf8");
    const codexHooks = JSON.parse(codexHooksRaw) as { hooks: Record<string, unknown> };
    expect(codexHooks.hooks).toHaveProperty("SessionStart");
    expect(codexHooks.hooks).toHaveProperty("PreToolUse");
    expect(codexHooks.hooks).toHaveProperty("PostToolUse");
    expect(codexHooks.hooks).toHaveProperty("Stop");
    expect(codexHooksRaw).toContain("statusMessage");

    // Legacy v0.39.x skill layout must be absent (fresh install writes
    // `cc*`, not `cclaw-cc*`).
    for (const legacySkill of ["cclaw-cc", "cclaw-cc-view"]) {
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
      path.join(root, ".cclaw/skills/scope/SKILL.md"),
      "utf8"
    );
    const designSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/design/SKILL.md"),
      "utf8"
    );
    const brainstormSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/brainstorm/SKILL.md"),
      "utf8"
    );

    expect(scopeSkill).toContain("Completion protocol: verify required gates");
    expect(scopeSkill).toContain("`mandatory delegations`");
    expect(scopeSkill).toContain("`planner`");
    expect(scopeSkill).toContain("--waive-delegation=planner");
    expect(scopeSkill).toContain("completion helper JSON diagnostics");
    expect(scopeSkill).toContain("read brainstorm handoff");
    expect(scopeSkill).toContain("in-scope/out-of-scope/deferred/discretion contract");
    expect(scopeSkill).not.toContain("For simple web-app flows, default to HOLD SCOPE");
    expect(designSkill).toContain("`mandatory delegations`");
    expect(designSkill).toContain("`architect`");
    expect(designSkill).toContain("`test-author`");
    expect(brainstormSkill).toContain("`mandatory delegations`: `product-discovery`, `critic`");
  });

  it("routes meta skill to inline protocol behavior", async () => {
    const root = await createTempProject("sync-protocol");
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
      path.join(root, ".cclaw/skills/spec/SKILL.md"),
      "utf8"
    );

    expect(specSkill).toContain("Chunk acceptance criteria for review");
    expect(specSkill).toContain("batches of 3-5");
    expect(specSkill).toContain("pause for explicit ACK");
    expect(specSkill).toContain(
      "Present acceptance criteria to the user in 3-5-item batches"
    );
  });

  it("keeps compact orientation pointers in meta-skill and progression command", async () => {
    const root = await createTempProject("flow-map-ref");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"),
      "utf8"
    );
    expect(metaSkill).toContain(".cclaw/state/flow-state.json");
    expect(metaSkill).toContain("## Whole flow map");
    expect(metaSkill).not.toContain("/cc-finish");
    for (const label of ["standard:", "medium:", "quick:"]) {
      expect(metaSkill).toContain(label);
    }
    expect(metaSkill).toContain("post_ship_review -> archive");

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
      path.join(root, ".cclaw/skills/spec/SKILL.md"),
      "utf8"
    );
    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
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
      path.join(root, ".cclaw/skills/spec/SKILL.md"),
      "utf8"
    );
    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
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
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
      "utf8"
    );
    expect(planSkill).toContain("## Completion Parameters");
    expect(planSkill).toContain("`mandatory delegations`");
  });

  it("inlines decision protocol in design and spec skills", async () => {
    const root = await createTempProject("ambiguity");
    await initCclaw({ projectRoot: root });

    const designSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/design/SKILL.md"),
      "utf8"
    );
    const specSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/spec/SKILL.md"),
      "utf8"
    );
    expect(designSkill).toContain("Decision protocol: ask only decision-changing questions");
    expect(specSkill).toContain("Decision protocol: ask only decision-changing questions");
  });

  it("keeps contract anchors for strict-stage content", async () => {
    const root = await createTempProject("strict-stage-anchors");
    await initCclaw({ projectRoot: root });

    const brainstormSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/brainstorm/SKILL.md"),
      "utf8"
    );
    const reviewSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/review/SKILL.md"),
      "utf8"
    );
    const shipSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/ship/SKILL.md"),
      "utf8"
    );

    expectStageSkillContract(brainstormSkill);
    expectStageSkillContract(reviewSkill);
    expectStageSkillContract(shipSkill);
    expect(brainstormSkill).toContain("Selected Direction");
    expect(brainstormSkill).toContain("Carrying forward: <1-3 bullets>");
    expect(brainstormSkill).toContain("Ask only decision-changing questions");
    expect(brainstormSkill).toContain("never overwrite the artifact wholesale from the template");
    expect(reviewSkill).toContain("Review Findings");
    expect(shipSkill).toContain("finalization mode");
  });

  it("materializes adaptive elicitation skill and Q&A log contracts", async () => {
    const root = await createTempProject("adaptive-elicitation-contracts");
    await initCclaw({ projectRoot: root });

    const adaptiveSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/adaptive-elicitation/SKILL.md"),
      "utf8"
    );
    expect(adaptiveSkill).toContain("one-question-at-a-time");
    expect(adaptiveSkill).toContain("AskUserQuestion");
    expect(adaptiveSkill).toContain("request_user_input");
    expect(adaptiveSkill).toContain("ask_user");
    expect(adaptiveSkill).toContain("AskQuestion");
    expect(adaptiveSkill).toContain("Stop Signals");
    expect(adaptiveSkill).toContain("Q&A Log");
    expect(adaptiveSkill).toContain("Don't tell it what to do, give it success criteria and watch it go.");
    expect(adaptiveSkill).toContain("User does not run cclaw manually");
    expect(adaptiveSkill).toContain("questionBudgetHint(track, stage)");

    const brainstormSkill = await fs.readFile(path.join(root, ".cclaw/skills/brainstorm/SKILL.md"), "utf8");
    const scopeSkill = await fs.readFile(path.join(root, ".cclaw/skills/scope/SKILL.md"), "utf8");
    const designSkill = await fs.readFile(path.join(root, ".cclaw/skills/design/SKILL.md"), "utf8");
    expect(brainstormSkill).toContain(".cclaw/skills/adaptive-elicitation/SKILL.md");
    expect(scopeSkill).toContain(".cclaw/skills/adaptive-elicitation/SKILL.md");
    expect(designSkill).toContain(".cclaw/skills/adaptive-elicitation/SKILL.md");
    expect(brainstormSkill).toContain("If something is unclear, stop. Name what's confusing. Ask.");
    expect(scopeSkill).toContain("Strong success criteria let you loop independently.");
    expect(designSkill).toContain("Constrain, don't micromanage - enforce invariants, separate the doer from the checker.");
    expect(brainstormSkill).toContain("what pain are we solving");
    expect(scopeSkill).toContain("what is definitely in/out");
    expect(designSkill).toContain("what is the end-to-end data flow");

    const brainstormTemplate = await fs.readFile(path.join(root, ".cclaw/templates/01-brainstorm.md"), "utf8");
    const scopeTemplate = await fs.readFile(path.join(root, ".cclaw/templates/02-scope.md"), "utf8");
    const designTemplate = await fs.readFile(path.join(root, ".cclaw/templates/03-design.md"), "utf8");
    for (const template of [brainstormTemplate, scopeTemplate, designTemplate]) {
      expect(template).toContain("## Q&A Log");
      expect(template).toContain("| Turn | Question | User answer (1-line) | Decision impact |");
      expect(template).toContain("Append-only by turn");
    }
  });

  it("emits conditional slice-review guidance in plan and tdd skills", async () => {
    const root = await createTempProject("slice-review-guidance");
    await initCclaw({ projectRoot: root });

    const planSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/tdd/SKILL.md"),
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
      path.join(root, ".cclaw/skills/plan/SKILL.md"),
      "utf8"
    );
    const tddSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/tdd/SKILL.md"),
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
      path.join(root, ".cclaw/skills/review/SKILL.md"),
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
    const shipTemplate = await fs.readFile(path.join(root, ".cclaw/templates/08-ship.md"), "utf8");
    const cohesionContractTemplate = await fs.readFile(path.join(root, ".cclaw/templates/cohesion-contract.md"), "utf8");
    const cohesionContractJsonTemplate = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/templates/cohesion-contract.json"), "utf8")
    ) as Record<string, unknown>;

    expect(designTemplate).toContain("## Compact-First Scaffold");
    expect(designTemplate).toContain("Compact required spine");
    expect(designTemplate).toContain("Omitted - compact design");

    expect(specTemplate).toContain("quick uses `00-idea.md` plus reproduction context");
    expect(specTemplate).toContain("## Quick Reproduction Contract");
    expect(specTemplate).toContain("Expected RED test behavior");
    expect(specTemplate).toContain("TDD turns this contract into the RED reproduction test");

    expect(tddTemplate).toContain("active track's upstream source item");
    expect(tddTemplate).toContain("Source item ID");
    expect(tddTemplate).toContain("Quick Reproduction Contract");

    expect(reviewTemplate).toContain("active track's upstream source item");
    expect(reviewTemplate).toContain("N/A - direct spec/reproduction coverage");
    expect(reviewTemplate).toContain("AC/source-item/slice coverage rationale");
    expect(shipTemplate).toContain("## Architect Cross-Stage Verification");
    expect(shipTemplate).toContain("architect-cross-stage-verification");
    expect(cohesionContractTemplate).toContain("# Cohesion Contract");
    expect(cohesionContractTemplate).toContain("## Integration Touchpoints");
    expect(Array.isArray(cohesionContractJsonTemplate.sharedTypes)).toBe(true);
    expect(Array.isArray(cohesionContractJsonTemplate.touchpoints)).toBe(true);
    expect(Array.isArray(cohesionContractJsonTemplate.slices)).toBe(true);
    for (const phrase of ["05-plan.md", "Plan task IDs", "Task coverage", "orphaned tasks", "Do not invent a plan task"]) {
      expect(tddTemplate, `TDD template leaked ${phrase}`).not.toContain(phrase);
      expect(reviewTemplate, `review template leaked ${phrase}`).not.toContain(phrase);
    }
  });

  it("materializes executing-waves skill and wave-plan scaffold", async () => {
    const root = await createTempProject("executing-waves-skill");
    await initCclaw({ projectRoot: root });

    const executingWavesSkill = await fs.readFile(
      path.join(root, ".cclaw/skills/executing-waves/SKILL.md"),
      "utf8"
    );
    expect(executingWavesSkill).toContain("## Process");
    expect(executingWavesSkill).toContain("## Status Markers");
    expect(executingWavesSkill).toContain("wave.drift_unaddressed");
    expect(executingWavesSkill).toContain("scope LD# hash references still valid");
    expect(executingWavesSkill).toContain("Never create a second `## Locked Decisions` heading in brainstorm");

    await expect(
      fs.stat(path.join(root, ".cclaw/wave-plans/.gitkeep"))
    ).resolves.toBeTruthy();
  });

  it("keeps meta-skill utility routing limited to generated helper surfaces", async () => {
    const root = await createTempProject("honest-meta-utilities");
    await initCclaw({ projectRoot: root });

    const metaSkill = await fs.readFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "utf8");
    const generatedSkillDirs = (await fs.readdir(path.join(root, ".cclaw/skills"))).sort();

    const helperMatches = [...metaSkill.matchAll(/`([a-z][a-z0-9-]*)`/gu)]
      .map((match) => match[1]!)
      .filter((name) => ["subagent-dev", "parallel-dispatch", "session", "iron-laws"].includes(name));
    expect(new Set(helperMatches)).toEqual(new Set(["subagent-dev", "parallel-dispatch", "session", "iron-laws"]));

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
      path.join(root, ".cclaw/skills/ship/SKILL.md"),
      "utf8"
    );

    expectStageSkillContract(shipSkill);
    expect(shipSkill).toContain("FINALIZE_OPEN_PR");
    expect(shipSkill).toContain("Rollback Plan");
  });
});
