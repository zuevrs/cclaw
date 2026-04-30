import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { CCLAW_VERSION, SHIP_FINALIZATION_MODES } from "../../src/constants.js";
import { lintArtifact } from "../../src/artifact-linter.js";
import { CCLAW_AGENTS } from "../../src/content/core-agents.js";
import { stageExamples, stageFullArtifactExampleMarkdown } from "../../src/content/examples.js";
import { mandatoryDelegationsForStage, reviewStackAwareRoutingSummary, stageAutoSubagentDispatch, stageDelegationSummary, stagePolicyNeedles, stageSchema, stageTrackRenderContext } from "../../src/content/stage-schema.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { referencePatternContractsForStage, referencePatternPolicyNeedles, referencePatternsForStage } from "../../src/content/reference-patterns.js";
import { enhancedAgentBody, subagentDrivenDevSkill } from "../../src/content/subagents.js";
import { SUBAGENT_CONTEXT_SKILLS } from "../../src/content/subagent-context-skills.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/templates.js";
import { FLOW_STAGES, FLOW_TRACKS, TRACK_STAGES, type FlowStage, type FlowTrack } from "../../src/types.js";
import { createTempProject } from "../helpers/index.js";

describe("stage schema and subagent alignment", () => {
  it("exposes v2 grouped schema metadata with legacy parity", () => {
    for (const stage of FLOW_STAGES) {
      const schema = stageSchema(stage);
      expect(schema.schemaShape).toBe("v2");
      expect(["lightweight", "standard", "deep"]).toContain(schema.complexityTier);
      expect(schema.philosophy.hardGate).toBe(schema.hardGate);
      expect(schema.philosophy.ironLaw).toBe(schema.ironLaw);
      expect(schema.executionModel.checklist).toEqual(schema.checklist);
      expect(schema.executionModel.requiredGates).toEqual(schema.requiredGates);
      expect(schema.artifactRules.artifactFile).toBe(schema.artifactFile);
      expect(schema.artifactRules.artifactValidation).toEqual(schema.artifactValidation);
      expect(schema.reviewLens.reviewSections).toEqual(schema.reviewSections);
      expect(schema.reviewLens.mandatoryDelegations).toEqual(schema.mandatoryDelegations);
      expect(schema.reviewLens.reviewLoop).toEqual(schema.reviewLoop);
    }
  });

  it("resolves explicit and default complexity tiers", () => {
    expect(stageSchema("brainstorm").complexityTier).toBe("standard");
    expect(stageSchema("scope").complexityTier).toBe("standard");
    expect(stageSchema("design").complexityTier).toBe("standard");
    // Plan does not set complexityTier explicitly and should fall back.
    expect(stageSchema("plan").complexityTier).toBe("standard");
  });

  it("supports complexity-tier gates for mandatory delegations", () => {
    expect(mandatoryDelegationsForStage("scope", "lightweight")).toEqual([]);
    expect(mandatoryDelegationsForStage("scope", "standard")).toEqual(["planner", "critic"]);
    expect(mandatoryDelegationsForStage("brainstorm", "standard")).toEqual(["product-manager", "critic"]);
    expect(mandatoryDelegationsForStage("design", "standard")).toEqual(["architect", "test-author"]);
    expect(mandatoryDelegationsForStage("spec", "standard")).toEqual(["spec-validator"]);
    expect(mandatoryDelegationsForStage("review", "lightweight")).toContain("reviewer");
    expect(mandatoryDelegationsForStage("ship", "lightweight")).toContain("release-reviewer");
  });

  it("keeps adopted reference families represented in the registry", () => {
    const patternIds = new Set(referencePatternsForStage("plan").concat(
      referencePatternsForStage("tdd"),
      referencePatternsForStage("review"),
      referencePatternsForStage("ship"),
      referencePatternsForStage("design"),
      referencePatternsForStage("scope"),
      referencePatternsForStage("brainstorm"),
      referencePatternsForStage("spec")
    ).map((pattern) => pattern.id));

    expect([...patternIds]).toEqual(expect.arrayContaining([
      "socraticode_context_readiness",
      "evanflow_coder_overseer",
      "superpowers_executable_packet",
      "gstack_question_tuning",
      "superclaude_confidence_gates",
      "addy_reference_grade_contracts",
      "oh_my_worker_lifecycle",
      "gsd_hard_stop_routing",
      "everyinc_delegation_preflight",
      "ecc_worktree_control_plane",
      "walkinglabs_victory_detector"
    ]));
  });

  it("exposes canonical delegation summaries per stage", () => {
    const standard = stageDelegationSummary("standard");
    const review = standard.find((row) => row.stage === "review");
    expect(review?.mandatoryAgents).toEqual(["reviewer", "security-reviewer"]);
    expect(review?.primaryAgents).toContain("reviewer");
    const scope = standard.find((row) => row.stage === "scope");
    expect(scope?.proactiveAgents).toContain("product-strategist");
    const spec = standard.find((row) => row.stage === "spec");
    expect(spec?.proactiveAgents).toContain("spec-document-reviewer");

    const lightweight = stageDelegationSummary("lightweight");
    const lightweightScope = lightweight.find((row) => row.stage === "scope");
    expect(lightweightScope?.mandatoryAgents).toEqual([]);

    const tdd = lightweight.find((row) => row.stage === "tdd");
    expect(tdd?.mandatoryAgents).toEqual(["test-author"]);
  });

  it("keeps tdd dispatch to one mandatory test-author evidence cycle", () => {
    const testAuthorRows = stageAutoSubagentDispatch("tdd")
      .filter((row) => row.agent === "test-author");

    expect(testAuthorRows).toHaveLength(1);
    expect(testAuthorRows[0]?.mode).toBe("mandatory");
    expect(testAuthorRows[0]?.skill).toBe("tdd-cycle-evidence");
    expect(testAuthorRows[0]?.purpose).toContain("RED/GREEN/REFACTOR evidence");
    expect(mandatoryDelegationsForStage("tdd", "lightweight")).toEqual(["test-author"]);
  });

  it("renders critic multi-perspective contract with prediction fields", () => {
    const critic = CCLAW_AGENTS.find((agent) => agent.name === "critic");
    expect(critic).toBeTruthy();
    expect(critic?.returnSchema.optionalFields).toEqual([
      "predictions",
      "predictionsValidated",
      "openQuestions",
      "realistCheckResults"
    ]);
    expect(critic?.body).toContain("## Why this matters");
    expect(critic?.body).toContain("## Pre-commitment predictions");
    expect(critic?.body).toContain("## Multi-perspective angles");
    expect(critic?.body).toContain("## Gap analysis");
    expect(critic?.body).toContain("## Self-audit");
    expect(critic?.body).toContain("## Realist check");
    expect(critic?.body).toContain("## ADVERSARIAL mode escalation");
  });

  it("binds critic dispatch rows to critic-multi-perspective skill", () => {
    const brainstormCritic = stageAutoSubagentDispatch("brainstorm").find((row) => row.agent === "critic");
    const scopeCritic = stageAutoSubagentDispatch("scope").find((row) => row.agent === "critic");
    const designCritic = stageAutoSubagentDispatch("design").find((row) => row.agent === "critic");
    expect(brainstormCritic?.skill).toBe("critic-multi-perspective");
    expect(scopeCritic?.skill).toBe("critic-multi-perspective");
    expect(designCritic?.skill).toBe("critic-multi-perspective");
    expect(designCritic?.when).toContain("auth/authz trust boundaries");
  });

  it("derives policy needles from lint metadata with track transforms", () => {
    expect(stagePolicyNeedles("plan")).toContain("Dependency Batches");
    expect(stagePolicyNeedles("plan")).toContain("Calibrated Findings");
    expect(stagePolicyNeedles("tdd", "quick")).toContain("acceptance criteria");
    expect(stagePolicyNeedles("tdd", "quick")).toContain("RED");
    expect(stagePolicyNeedles("tdd")).toContain("Watched-RED Proof");
    expect(stagePolicyNeedles("tdd")).toContain("Per-Slice Review");
    expect(stagePolicyNeedles("spec")).toContain("Spec Self-Review");
    expect(stagePolicyNeedles("brainstorm")).toContain("Embedded Grill");
    expect(stagePolicyNeedles("design")).toContain("Long-Term Trajectory");
  });

  it("exposes track render context for safe wording decisions", () => {
    const quick = stageTrackRenderContext("quick");
    const standard = stageTrackRenderContext("standard");
    expect(quick.track).toBe("quick");
    expect(quick.usesPlanTerminology).toBe(false);
    expect(quick.traceabilitySliceNoun).toBe("acceptance slice");
    expect(quick.upstreamArtifactPath).toBe(".cclaw/artifacts/04-spec.md");
    expect(standard.track).toBe("standard");
    expect(standard.usesPlanTerminology).toBe(true);
    expect(standard.traceabilitySliceNoun).toBe("plan slice");
    expect(standard.upstreamArtifactPath).toBe(".cclaw/artifacts/05-plan.md");
  });

  it("keeps quick-track TDD and review traceability independent of plan artifacts", () => {
    const quickTdd = stageSkillMarkdown("tdd", "quick");
    const quickReview = stageSkillMarkdown("review", "quick");
    const standardTdd = stageSkillMarkdown("tdd", "standard");
    const standardReview = stageSkillMarkdown("review", "standard");
    const forbiddenQuickPhrases = [
      ".cclaw/artifacts/05-plan.md",
      "05-plan.md",
      "Plan task IDs",
      "Task coverage",
      "orphaned tasks",
      "plan artifact",
      "plan task",
      "plan slice",
      "plan approval",
      "plan confirmation"
    ];

    expect(stageSchema("tdd", "quick").requiredGates.map((gate) => gate.id)).not.toContain("tdd_traceable_to_plan");
    expect(quickTdd).toContain("acceptance criterion");
    expect(quickTdd).toContain("spec acceptance criterion ID");
    expect(quickReview).toContain("source item coverage");
    for (const phrase of forbiddenQuickPhrases) {
      expect(quickTdd.toLowerCase(), `quick TDD leaked ${phrase}`).not.toContain(phrase.toLowerCase());
      expect(quickReview.toLowerCase(), `quick review leaked ${phrase}`).not.toContain(phrase.toLowerCase());
    }

    expect(standardTdd).toContain(".cclaw/artifacts/05-plan.md");
    expect(standardTdd).toContain("tdd_traceable_to_plan");
    expect(standardReview).toContain(".cclaw/artifacts/05-plan.md");
  });

  it("plan stage reads spec, design, and scope artifacts", () => {
    const plan = stageSchema("plan");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/04-spec.md");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/03-design-<slug>.md");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/02-scope-<slug>.md");
    expect(plan.requiredGates.map((gate) => gate.id)).toContain("plan_dependency_batches_defined");
    expect(plan.artifactValidation.some((row) => row.section === "Execution Posture")).toBe(true);
    expect(stagePolicyNeedles("plan")).toContain("Dependency Batches");
  });

  it("filters cross-stage reads to artifacts that exist on the active track", () => {
    const artifactStage: Partial<Record<string, FlowStage>> = {
      ".cclaw/artifacts/01-brainstorm.md": "brainstorm",
      ".cclaw/artifacts/01-brainstorm-<slug>.md": "brainstorm",
      ".cclaw/artifacts/02-scope.md": "scope",
      ".cclaw/artifacts/02-scope-<slug>.md": "scope",
      ".cclaw/artifacts/03-design.md": "design",
      ".cclaw/artifacts/03-design-<slug>.md": "design",
      ".cclaw/artifacts/04-spec.md": "spec",
      ".cclaw/artifacts/05-plan.md": "plan",
      ".cclaw/artifacts/06-tdd.md": "tdd",
      ".cclaw/artifacts/07-review.md": "review",
      ".cclaw/artifacts/08-ship.md": "ship"
    };
    const stages: FlowStage[] = ["spec", "plan", "tdd", "review", "ship"];
    const tracks: FlowTrack[] = ["medium", "quick"];

    for (const track of tracks) {
      for (const stage of stages) {
        const reads = stageSchema(stage, track).crossStageTrace.readsFrom;
        const activeStages = new Set(TRACK_STAGES[track]);
        for (const artifact of reads) {
          const sourceStage = artifactStage[artifact];
          if (!sourceStage) continue;
          expect(
            activeStages.has(sourceStage),
            `${stage}:${track} must not read off-track artifact ${artifact}`
          ).toBe(true);
        }
      }
    }

    expect(stageSchema("plan", "medium").crossStageTrace.readsFrom).toEqual([
      ".cclaw/artifacts/04-spec.md"
    ]);
    expect(stageSchema("review", "quick").crossStageTrace.readsFrom).not.toContain(
      ".cclaw/artifacts/05-plan.md"
    );
  });

  it("test-author template distinguishes TEST and BUILD stage modes", () => {
    const template = enhancedAgentBody("test-author");
    expect(template).toContain("STAGE_MODE: {TEST_RED_ONLY | BUILD_GREEN_REFACTOR}");
    expect(template).toContain("Do NOT edit production code.");
    expect(template).toContain("GREEN — minimal production code");
  });

  it("subagent orchestration includes anti-drift team defaults", () => {
    const skill = subagentDrivenDevSkill();
    expect(skill).toContain("## Anti-Drift Team Defaults");
    expect(skill).toContain("One controller owns alignment");
    expect(skill).toContain("at most 3-5 parallel agents");
    expect(skill).toContain("No parallel writes to adjacent surfaces");
    expect(skill).toContain("Consensus is for hard calls only");
  });

  it("renders true harness dispatch workflow guidance", () => {
    const scope = stageSkillMarkdown("scope");
    const orchestration = subagentDrivenDevSkill();

    expect(scope).toContain("## Automatic Subagent Dispatch");
    expect(scope).toContain("### Harness Dispatch Contract");
    expect(scope).toContain(".opencode/agents/<agent>.md");
    expect(scope).toContain(".codex/agents/<agent>.toml");
    expect(scope).toContain('fulfillmentMode: "isolated"');
    expect(scope).toContain("Do not collapse OpenCode or Codex to role-switch by default");
    expect(orchestration).toContain("### Native dispatch contract");
    expect(orchestration).toContain("generated `.opencode/agents/<agent>.md` subagent");
    expect(orchestration).toContain("spawn the generated `.codex/agents/<agent>.toml` custom agent");
  });

  it("materializes every subagent dispatch skill reference", () => {
    const knownAgents = new Set(CCLAW_AGENTS.map((agent) => agent.name));
    const expectedSkillRefs = new Set<string>();

    for (const stage of FLOW_STAGES) {
      for (const row of stageAutoSubagentDispatch(stage)) {
        expect(knownAgents.has(row.agent), `${stage} dispatch references unknown agent ${row.agent}`).toBe(true);
        if (row.skill) {
          expectedSkillRefs.add(row.skill);
          expect(SUBAGENT_CONTEXT_SKILLS[row.skill], `${stage} dispatch references missing skill ${row.skill}`)
            .toBeTruthy();
        }
      }
    }

    expect([...expectedSkillRefs].sort()).toEqual(Object.keys(SUBAGENT_CONTEXT_SKILLS).sort());
    for (const [skillName, body] of Object.entries(SUBAGENT_CONTEXT_SKILLS)) {
      expect(body, `${skillName} frontmatter`).toContain(`name: ${skillName}`);
      expect(body, `${skillName} required output`).toContain("## Required Output");
      expect(body, `${skillName} guardrails`).toContain("## Guardrails");
    }
  });

  it("review stage includes review-army structured reconciliation", () => {
    const review = stageSchema("review");
    expect(review.requiredEvidence).toContain("Artifact written to `.cclaw/artifacts/07-review-army.json`.");
    expect(stagePolicyNeedles("review")).toContain("Review Findings");
  });

  it("exposes content-only reference patterns through stage skills and policy needles", () => {
    expect(referencePatternsForStage("scope").map((pattern) => pattern.id)).toEqual([
      "socraticode_context_readiness",
      "addy_reference_grade_contracts",
      "gstack_question_tuning"
    ]);
    expect(referencePatternContractsForStage("design").map((contract) => contract.artifactSections).flat())
      .toContain("Reference-Grade Contracts");
    expect(referencePatternPolicyNeedles("review")).toContain("Victory Detector");

    const scopeSkill = stageSkillMarkdown("scope");
    const designSkill = stageSkillMarkdown("design");
    const tddSkill = stageSkillMarkdown("tdd");
    const reviewSkill = stageSkillMarkdown("review");

    expect(scopeSkill).toContain("## Reference Patterns");
    expect(scopeSkill).toContain("Reference Pattern Registry");
    expect(designSkill).toContain("Reference-Grade Contracts");
    expect(tddSkill).toContain("Vertical-Slice TDD");
    expect(reviewSkill).toContain("Victory Detector");
    expect(reviewSkill).toContain("These compact pattern titles come from the internal registry");
    expect(stagePolicyNeedles("scope")).toContain("Reference Pattern Registry");
    expect(stagePolicyNeedles("tdd")).toContain("vertical slice");
  });

  it("renders context readiness and reference-grade artifact scaffolds", () => {
    const brainstorm = ARTIFACT_TEMPLATES["01-brainstorm.md"];
    const scope = ARTIFACT_TEMPLATES["02-scope.md"];
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    const tdd = ARTIFACT_TEMPLATES["06-tdd.md"];
    const review = ARTIFACT_TEMPLATES["07-review.md"];
    const ship = ARTIFACT_TEMPLATES["08-ship.md"];

    expect(stageSkillMarkdown("brainstorm")).toContain("Confirm context readiness");
    expect(brainstorm).toContain("## Reference Pattern Candidates");
    expect(brainstorm).toContain("Reuses / reference pattern");
    expect(scope).toContain("## Reference Pattern Registry");
    expect(scope).toContain("Invariant to preserve");
    expect(design).toContain("## Reference-Grade Contracts");
    expect(design).toContain("Reusable invariant");
    expect(tdd).toContain("Vertical-slice RED/GREEN/REFACTOR checkpoint plan");
    expect(review).toContain("Victory Detector: pass | fail");
    expect(ship).toContain("Victory Detector: pass | fail");
  });

  it("ship finalization enums are sourced from canonical constants", () => {
    const ship = stageSchema("ship");
    const template = ARTIFACT_TEMPLATES["08-ship.md"] ?? "";
    for (const mode of SHIP_FINALIZATION_MODES) {
      expect(stagePolicyNeedles("ship")).toContain(mode);
      expect(template).toContain(mode);
    }
    expect(stagePolicyNeedles("ship")).not.toContain("FINALIZE_HANDOFF");
    expect(stagePolicyNeedles("ship")).not.toContain("FINALIZE_QUEUE");
    expect(stagePolicyNeedles("ship")).not.toContain("FINALIZE_SKIP");
  });

  it("07-review-army.json template matches validator schema shape", () => {
    const template = ARTIFACT_TEMPLATES["07-review-army.json"];
    const parsed = JSON.parse(template) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(typeof parsed.generatedAt).toBe("string");
    expect((parsed.generatedAt as string).length).toBeGreaterThan(0);
    expect(parsed.scope).toMatchObject({ base: expect.any(String), head: expect.any(String), files: [] });
    expect(parsed.findings).toEqual([]);
    expect(parsed.reconciliation).toEqual({
      duplicatesCollapsed: 0,
      conflicts: [],
      multiSpecialistConfirmed: [],
      layerCoverage: {
        spec: false,
        correctness: false,
        security: false,
        performance: false,
        architecture: false,
        "external-safety": false
      },
      shipBlockers: []
    });
    expect(JSON.stringify(parsed)).not.toMatch(/"title"|"category"/);
  });

  it("review stage mandates reviewer and security-reviewer only by default", () => {
    const review = stageSchema("review");
    expect(review.mandatoryDelegations).toEqual(["reviewer", "security-reviewer"]);
    const adversarial = stageAutoSubagentDispatch("review").find((row) => row.skill === "adversarial-review");
    expect(adversarial?.mode).toBe("proactive");
    const stackAware = stageAutoSubagentDispatch("review").find((row) => row.skill === "stack-aware-review");
    expect(stackAware?.mode).toBe("proactive");
  });

  it("renders stack-aware review routing without making every stack mandatory", () => {
    const review = stageSchema("review");
    const summary = stageDelegationSummary("standard").find((row) => row.stage === "review");
    const markdown = stageSkillMarkdown("review");

    expect(review.mandatoryDelegations).toEqual(["reviewer", "security-reviewer"]);
    expect(summary?.stackAwareRoutes.map((route) => route.stack)).toEqual([
      "TypeScript/JavaScript",
      "Python",
      "Ruby/Rails",
      "Go",
      "Rust"
    ]);
    expect(reviewStackAwareRoutingSummary()).toContain("package.json/tsconfig.json");
    expect(reviewStackAwareRoutingSummary()).toContain("pyproject.toml/requirements.txt");
    expect(reviewStackAwareRoutingSummary()).toContain("Gemfile/config/");
    expect(reviewStackAwareRoutingSummary()).toContain("go.mod");
    expect(reviewStackAwareRoutingSummary()).toContain("Cargo.toml");
    expect(reviewStackAwareRoutingSummary()).toContain("Do not run every stack lens unconditionally");
    expect(markdown).toContain("## Stack-Aware Review Routing");
    expect(markdown).toContain("Default general review still runs");
    expect(markdown).toContain("`package.json`, `tsconfig.json` -> reviewer lens");
    expect(markdown).toContain("`Cargo.toml` -> reviewer lens");
  });

  it("security-reviewer agent registry entry is mandatory", () => {
    const agent = CCLAW_AGENTS.find((a) => a.name === "security-reviewer");
    expect(agent).toBeDefined();
    expect(agent?.activation).toBe("mandatory");
    expect(agent?.description.toLowerCase()).toMatch(/mandatory|no-change/);
  });

  it("agent registry uses the specialist roster", () => {
    expect(CCLAW_AGENTS.map((agent) => agent.name).sort()).toEqual([
      "architect",
      "compatibility-reviewer",
      "critic",
      "doc-updater",
      "fixer",
      "implementer",
      "observability-reviewer",
      "performance-reviewer",
      "planner",
      "product-manager",
      "product-strategist",
      "release-reviewer",
      "researcher",
      "reviewer",
      "security-reviewer",
      "slice-implementer",
      "spec-document-reviewer",
      "spec-validator",
      "test-author"
    ]);
  });

  it("agent registry entries declare strict return schemas", () => {
    for (const agent of CCLAW_AGENTS) {
      expect(agent.returnSchema.statusField).toBe("status");
      expect(agent.returnSchema.allowedStatuses.length).toBeGreaterThan(0);
      expect(agent.returnSchema.requiredFields).toContain("status");
      expect(agent.returnSchema.evidenceFields.length).toBeGreaterThan(0);
      expect(enhancedAgentBody(agent.name)).toContain("Task Tool Delegation");
    }
    expect(CCLAW_AGENTS.find((agent) => agent.name === "implementer")?.activation).toBe("on-demand");
    expect(CCLAW_AGENTS.find((agent) => agent.name === "slice-implementer")?.activation).toBe("on-demand");
    expect(CCLAW_AGENTS.find((agent) => agent.name === "fixer")?.activation).toBe("on-demand");
  });

  it("stage dispatch summaries expose class and return schema metadata", () => {
    const review = stageDelegationSummary("lightweight").find((row) => row.stage === "review");
    expect(review?.dispatchRules.find((rule) => rule.agent === "reviewer")).toMatchObject({
      dispatchClass: "review-lens",
      returnSchema: "review-return"
    });
    expect(review?.dispatchRules.find((rule) => rule.agent === "performance-reviewer")).toMatchObject({
      dispatchClass: "review-lens",
      returnSchema: "performance-return"
    });
    const tdd = stageDelegationSummary("lightweight").find((row) => row.stage === "tdd");
    expect(tdd?.dispatchRules.find((rule) => rule.agent === "test-author")).toMatchObject({
      returnSchema: "tdd-return"
    });
    expect(tdd?.dispatchRules.find((rule) => rule.agent === "slice-implementer")).toMatchObject({
      dispatchClass: "worker",
      returnSchema: "worker-return"
    });
    const spec = stageDelegationSummary("standard").find((row) => row.stage === "spec");
    expect(spec?.dispatchRules.find((rule) => rule.agent === "spec-document-reviewer")).toMatchObject({
      dispatchClass: "review-lens",
      returnSchema: "review-return"
    });
    expect(stageSkillMarkdown("review")).toContain("| Agent | Mode | Class | Return Schema | User Gate | Trigger | Purpose |");
  });

  it("design skill renders research playbooks instead of research personas", () => {
    const design = stageSchema("design");
    expect(stageAutoSubagentDispatch("design").map((row) => row.agent)).toEqual(expect.arrayContaining(["architect", "test-author", "researcher", "compatibility-reviewer", "observability-reviewer"]));
    expect(design.researchPlaybooks).toEqual([
      "research/research-fleet.md",
      "research/framework-docs-lookup.md",
      "research/best-practices-lookup.md"
    ]);
    const markdown = stageSkillMarkdown("design");
    expect(markdown).toContain("## Research Playbooks");
    expect(markdown).toContain(".cclaw/skills/research/research-fleet.md");
    expect(markdown).toContain(".cclaw/skills/research/framework-docs-lookup.md");
    expect(markdown).toContain(".cclaw/skills/research/best-practices-lookup.md");
    expect(markdown).not.toContain("framework-docs-researcher");
  });

  it("middle stages include prompt-level investigation and verification mechanics", () => {
    const design = stageSchema("design");
    const spec = stageSchema("spec");
    const plan = stageSchema("plan");

    expect(design.executionModel.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("Investigator pass"),
      expect.stringContaining("shadow alternative"),
      expect.stringContaining("Critic pass")
    ]));
    expect(design.artifactValidation.find((row) => row.section === "Data-Flow Shadow Paths")?.validationRule)
      .toContain("switch trigger");
    expect(spec.artifactValidation.find((row) => row.section === "Acceptance Mapping")?.validationRule)
      .toContain("observable evidence");
    expect(plan.artifactValidation.find((row) => row.section === "Task List")?.validationRule)
      .toContain("expected evidence/pass condition");
  });

  it("design stage requires research-fleet completion gate", () => {
    const design = stageSchema("design");
    const researchGate = design.requiredGates.find((gate) => gate.id === "design_research_complete");
    expect(researchGate).toBeDefined();
    expect(researchGate?.tier).toBe("required");
  });

  it("design artifact requires security, observability, and rollout sections", () => {
    const design = stageSchema("design");
    const requiredSections = [
      "Security & Threat Model",
      "Observability & Debuggability",
      "Deployment & Rollout"
    ];
    for (const section of requiredSections) {
      const rule = design.artifactValidation.find((row) => row.section === section);
      expect(rule).toBeDefined();
      expect(rule?.required).toBe(true);
    }
  });

  it("design artifact exposes tiered diagram section contracts", () => {
    const design = stageSchema("design");
    for (const section of [
      "Data-Flow Shadow Paths",
      "Error Flow Diagram"
    ] as const) {
      const rule = design.artifactValidation.find((row) => row.section === section);
      expect(rule).toBeDefined();
      expect(rule?.required).toBe(false);
    }
  });

  it("brainstorm visible guidance exposes validator-only requirements", () => {
    const brainstorm = stageSchema("brainstorm");
    const template = ARTIFACT_TEMPLATES["01-brainstorm.md"] ?? "";
    const skill = stageSkillMarkdown("brainstorm");

    expect(template).toContain("| B | challenger | high |");
    expect(template).toContain("Trace this to the prior Approach Reaction");
    expect(template).toContain("Next-stage handoff");
    expect(brainstorm.artifactValidation.find((row) => row.section === "Selected Direction")?.validationRule)
      .toContain("Approach Reaction");
    expect(brainstorm.artifactValidation.find((row) => row.section === "Approach Reaction")?.validationRule)
      .toContain("before Selected Direction");
    expect(skill).toContain("if using a structured question tool, send exactly one question object");
    expect(skill).toContain("rationale traceable to Approach Reaction");
    expect(skill).toContain("scope handoff packet with selected direction, decisions, drift, confidence");
  });

  it("brainstorm skill teaches the calibrated Self-Review Notes format, not the legacy `- None.` shortcut", () => {
    const brainstorm = stageSchema("brainstorm");
    const skill = stageSkillMarkdown("brainstorm");

    const selfReviewRule = brainstorm.artifactValidation.find(
      (row) => row.section === "Self-Review Notes"
    );
    expect(selfReviewRule).toBeDefined();
    expect(selfReviewRule?.validationRule).toContain("calibrated review format");
    expect(selfReviewRule?.validationRule).toContain("`- Status: Approved`");
    expect(selfReviewRule?.validationRule).toContain("`- Patches applied:`");
    expect(selfReviewRule?.validationRule).toContain("`- Remaining concerns:`");
    expect(selfReviewRule?.validationRule).not.toMatch(/\(or `- None\.`\)/);

    const checklistSelfReview = brainstorm.executionModel.checklist.find((line) =>
      line.startsWith("**Self-review before user approval**")
    );
    expect(checklistSelfReview).toBeDefined();
    expect(checklistSelfReview).toContain("calibrated review format");
    expect(checklistSelfReview).toContain("`- Status: Approved`");
    expect(checklistSelfReview).toContain("`- Patches applied:`");
    expect(checklistSelfReview).toContain("`- Remaining concerns:`");
    expect(checklistSelfReview).not.toMatch(/\(or `- None\.`\)/);

    expect(skill).toContain("calibrated review format");
    expect(skill).toContain("`- Status: Approved`");
    expect(skill).toContain("`- Patches applied:`");
    expect(skill).toContain("`- Remaining concerns:`");
    expect(skill).not.toMatch(/Self-Review Notes`?\s*\(or\s*`- None\.`\)/);
  });

  it("every stage skill points the agent at the canonical artifact template before drafting", () => {
    const expectedTemplates: Record<FlowStage, string> = {
      brainstorm: ".cclaw/templates/01-brainstorm.md",
      scope: ".cclaw/templates/02-scope.md",
      design: ".cclaw/templates/03-design.md",
      spec: ".cclaw/templates/04-spec.md",
      plan: ".cclaw/templates/05-plan.md",
      tdd: ".cclaw/templates/06-tdd.md",
      review: ".cclaw/templates/07-review.md",
      ship: ".cclaw/templates/08-ship.md"
    };

    for (const stage of FLOW_STAGES) {
      const skill = stageSkillMarkdown(stage);
      expect(skill).toContain("Read the canonical artifact template");
      expect(skill).toContain(expectedTemplates[stage]);
      expect(skill).toContain("per-row tables");
      expect(skill).toContain("calibrated review block");
    }
  });

  it("canonical templates include every required artifact validation section", () => {
    const templateByStage: Record<FlowStage, keyof typeof ARTIFACT_TEMPLATES> = {
      brainstorm: "01-brainstorm.md",
      scope: "02-scope.md",
      design: "03-design.md",
      spec: "04-spec.md",
      plan: "05-plan.md",
      tdd: "06-tdd.md",
      review: "07-review.md",
      ship: "08-ship.md"
    };

    for (const stage of FLOW_STAGES) {
      const templateName = templateByStage[stage];
      const template = ARTIFACT_TEMPLATES[templateName] ?? "";
      for (const rule of stageSchema(stage).artifactValidation) {
        if (!rule.required) continue;
        expect(
          template,
          `${templateName} must expose required validator section ## ${rule.section}`
        ).toContain(`## ${rule.section}`);
      }
    }
  });

  it("brainstorm artifact requires tier and reaction sections", () => {
    const brainstorm = stageSchema("brainstorm");
    for (const section of ["Approach Tier", "Approach Reaction"] as const) {
      const rule = brainstorm.artifactValidation.find((row) => row.section === section);
      expect(rule).toBeDefined();
      expect(rule?.required).toBe(true);
    }
    expect(brainstorm.trivialOverrideSections).toEqual([
      "Context",
      "Problem Decision Record",
      "Approach Tier",
      "Short-Circuit Decision",
      "Selected Direction"
    ]);
  });

  it("scope right-sizing keeps required gates while marking deep workshop sections optional", () => {
    const scope = stageSchema("scope");
    const scopeTemplate = ARTIFACT_TEMPLATES["02-scope.md"];

    expect(scope.requiredGates.filter((gate) => gate.tier === "required").map((gate) => gate.id)).toEqual([
      "scope_mode_selected",
      "scope_contract_written",
      "scope_user_approved"
    ]);
    expect(scope.executionModel.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("draft the in-scope/out-of-scope/deferred/discretion contract"),
      expect.stringContaining("lite keeps the selected-mode row compact")
    ]));
    expect(scope.artifactValidation.find((row) => row.section === "Dream State Mapping")).toBeUndefined();
    expect(scope.artifactValidation.find((row) => row.section === "Temporal Interrogation")).toBeUndefined();
    expect(scope.artifactValidation.find((row) => row.section === "Mode-Specific Analysis")?.validationRule)
      .toContain("one selected-mode row with rationale");
    expect(scopeTemplate).not.toContain("## Dream State Mapping");
    expect(scopeTemplate).not.toContain("## Temporal Interrogation");
    expect(scopeTemplate).toContain("| Selected mode | Rationale | Depth |");
  });

  it("design right-sizing keeps gates and treats heavy diagrams as add-ons", () => {
    const design = stageSchema("design");
    const designTemplate = ARTIFACT_TEMPLATES["03-design.md"];

    expect(design.requiredGates.filter((gate) => gate.tier === "required").map((gate) => gate.id)).toEqual([
      "design_research_complete",
      "design_architecture_locked",
      "design_diagram_freshness",
      "design_data_flow_mapped",
      "design_failure_modes_mapped",
      "design_test_and_perf_defined"
    ]);
    expect(design.requiredGates.find((gate) => gate.id === "design_research_complete")?.description)
      .toContain("compact inline synthesis by default");
    expect(design.requiredEvidence).toEqual(expect.arrayContaining([
      expect.stringContaining("Research Fleet Synthesis is filled in `.cclaw/artifacts/03-design-<slug>.md`")
    ]));
    for (const section of [
      "Data-Flow Shadow Paths",
      "Error Flow Diagram",
      "Data-Flow Shadow Paths",
      "Error Flow Diagram"
    ] as const) {
      expect(design.artifactValidation.find((row) => row.section === section)?.validationRule)
        .toMatch(/add-on/);
    }
    expect(designTemplate).toContain("compact inline synthesis here");
    expect(designTemplate).toContain("Standard/Deep add-on; omit");
  });

  it("review contract aligns required layer coverage and blocked route gates", () => {
    const review = stageSchema("review", "quick");
    const requiredGateIds = review.requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);

    expect(requiredGateIds).toContain("review_layer_coverage_complete");
    expect(review.requiredGates.find((gate) => gate.id === "review_criticals_resolved")?.description)
      .toContain("BLOCKED routes use review_verdict_blocked instead");
    expect(review.requiredEvidence).toEqual(expect.arrayContaining([
      expect.stringContaining("correctness, security, performance, architecture, and external-safety")
    ]));
    expect(ARTIFACT_TEMPLATES["07-review.md"]).toContain("correctness/security/performance/architecture/external-safety");
  });

  it("brainstorm and scope default to compact user-facing flow", () => {
    const brainstorm = stageSchema("brainstorm");
    const scope = stageSchema("scope");

    expect(brainstorm.executionModel.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("Use compact discovery for low-risk asks"),
      expect.stringContaining("Problem Decision Record plus short-circuit handoff")
    ]));
    expect(brainstorm.executionModel.interactionProtocol).toEqual(expect.arrayContaining([
      expect.stringContaining("Ask at most one question per turn")
    ]));
    expect(scope.executionModel.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("Scope contract first")
    ]));
    expect(scope.executionModel.interactionProtocol).toEqual(expect.arrayContaining([
      expect.stringContaining("Do not walk the full checklist by default"),
      expect.stringContaining("STOP for one explicit approval before finalizing the artifact")
    ]));
    expect(scope.executionModel.requiredEvidence).toEqual(expect.arrayContaining([
      expect.stringContaining("does not satisfy user approval")
    ]));
  });

  it("stage skill completion parameters use track-aware next stage", () => {
    const mediumBrainstorm = stageSkillMarkdown("brainstorm", "medium");
    const standardBrainstorm = stageSkillMarkdown("brainstorm", "standard");

    expect(mediumBrainstorm).toContain("`next`: `spec`");
    expect(mediumBrainstorm).not.toContain("`next`: `scope`");
    expect(standardBrainstorm).toContain("`next`: `scope`");
  });

  it("scope and design expose shared review-loop config", () => {
    const scope = stageSchema("scope");
    const design = stageSchema("design");
    const spec = stageSchema("spec");
    expect(scope.reviewLoop).toMatchObject({
      stage: "scope",
      maxIterations: 3,
      targetScore: 0.8
    });
    expect(scope.reviewLoop?.checklist).toHaveLength(5);
    expect(design.reviewLoop).toMatchObject({
      stage: "design",
      maxIterations: 3,
      targetScore: 0.8
    });
    expect(design.reviewLoop?.checklist).toHaveLength(5);
    expect(spec.reviewLoop).toBeUndefined();
  });

  it("design template renders architecture diagram with clean triple-backtick fences", () => {
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(design).toContain("## Architecture Diagram");
    expect(design).not.toMatch(/\\`\\`\\`/);
    const diagramBlock = design.split("## Architecture Diagram")[1];
    expect(diagramBlock).toMatch(/\n```\n[\s\S]*?\n```\n/);
  });

  it("design template includes tiered diagram markers", () => {
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(design).toContain("<!-- diagram: architecture -->");
    expect(design).toContain("<!-- diagram: data-flow-shadow-paths -->");
    expect(design).toContain("<!-- diagram: error-flow -->");
    expect(design).toContain("<!-- diagram: state-machine -->");
    expect(design).toContain("<!-- diagram: rollback-flowchart -->");
    expect(design).toContain("<!-- diagram: deployment-sequence -->");
  });

  it("design template includes interaction edge-case matrix rows", () => {
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(design).toContain("### Interaction Edge Case Matrix");
    expect(design).toContain("| double-click |");
    expect(design).toContain("| nav-away-mid-request |");
    expect(design).toContain("| 10K-result dataset |");
    expect(design).toContain("| background-job abandonment |");
    expect(design).toContain("| zombie connection |");
  });

  it("design template includes stale diagram audit section", () => {
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(design).toContain("## Stale Diagram Audit");
    expect(design).toContain("| Diagram marker baseline |");
  });

  it("brainstorm and design templates include wave-8 sections", () => {
    const brainstorm = ARTIFACT_TEMPLATES["01-brainstorm.md"];
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(brainstorm).toContain("## Embedded Grill");
    expect(design).toContain("## Long-Term Trajectory");
  });

  it("scope template includes pre-scope system audit section", () => {
    const scope = ARTIFACT_TEMPLATES["02-scope.md"];
    expect(scope).toContain("## Pre-Scope System Audit");
    expect(scope).toContain("git log -30 --oneline");
    expect(scope).toContain("git diff --stat");
    expect(scope).toContain("git stash list");
    expect(scope).toContain('rg -n "TODO|FIXME|XXX|HACK"');
  });

  it("scope and design templates include review-loop artifact sections", () => {
    const scopeTemplate = ARTIFACT_TEMPLATES["02-scope.md"];
    const designTemplate = ARTIFACT_TEMPLATES["03-design.md"];
    expect(scopeTemplate).toContain("## Outside Voice Findings");
    expect(scopeTemplate).toContain("## Scope Outside Voice Loop");
    expect(designTemplate).toContain("## Outside Voice Findings");
    expect(designTemplate).toContain("## Design Outside Voice Loop");
    expect(scopeTemplate).not.toContain("Spec review loop summary");
  });

  it("brainstorm scope and design templates expose seed shelf section", () => {
    const brainstorm = ARTIFACT_TEMPLATES["01-brainstorm.md"];
    const scope = ARTIFACT_TEMPLATES["02-scope.md"];
    const design = ARTIFACT_TEMPLATES["03-design.md"];
    expect(brainstorm).toContain("## Seed Shelf Candidates (optional)");
    expect(scope).toContain("## Seed Shelf Candidates (optional)");
    expect(design).toContain("## Seed Shelf Candidates (optional)");
    expect(scope).toContain(".cclaw/seeds/SEED-YYYY-MM-DD-<slug>.md");
  });

  it("downstream stage templates expose an upstream handoff section", () => {
    for (const templateName of [
      "02-scope.md",
      "03-design.md",
      "04-spec.md",
      "05-plan.md",
      "06-tdd.md",
      "07-review.md",
      "08-ship.md"
    ] as const) {
      expect(ARTIFACT_TEMPLATES[templateName]).toContain("## Upstream Handoff");
      expect(ARTIFACT_TEMPLATES[templateName]).toContain("Drift from upstream");
    }

    for (const stage of ["scope", "design", "spec", "plan", "tdd", "review", "ship"] as const) {
      const schema = stageSchema(stage);
      expect(schema.artifactValidation.some((row) => row.section === "Upstream Handoff")).toBe(true);
    }
  });

  it("artifact templates use run frontmatter after feature cleanup", () => {
    for (const [templateName, template] of Object.entries(ARTIFACT_TEMPLATES)) {
      if (!templateName.endsWith(".md")) continue;
      expect(template).toContain("run: <run-id>");
      expect(template).not.toContain("feature: <feature-id>");
    }
  });

  it("markdown artifact templates render complete frontmatter consistently", () => {
    const templateStages: Record<string, string> = {
      "01-brainstorm.md": "brainstorm",
      "02-scope.md": "scope",
      "02a-research.md": "design",
      "03-design.md": "design",
      "04-spec.md": "spec",
      "05-plan.md": "plan",
      "06-tdd.md": "tdd",
      "07-review.md": "review",
      "08-ship.md": "ship",
      "09-retro.md": "retro"
    };

    for (const [templateName, stage] of Object.entries(templateStages)) {
      const expectedFrontmatter = [
        "---",
        `stage: ${stage}`,
        "schema_version: 1",
        `version: ${CCLAW_VERSION}`,
        "run: <run-id>",
        "locked_decisions: []",
        "inputs_hash: sha256:pending",
        "---",
        ""
      ].join("\n");

      expect(
        ARTIFACT_TEMPLATES[templateName]?.startsWith(expectedFrontmatter),
        `${templateName} frontmatter`
      ).toBe(true);
    }
  });

  it("artifact templates do not leak source escaping helpers into generated content", () => {
    for (const [templateName, template] of Object.entries(ARTIFACT_TEMPLATES)) {
      expect(template, `${templateName} should not contain escaped markdown fences`).not.toContain("\\`\\`\\`");
      expect(template, `${templateName} should not leak template variables`).not.toMatch(/\$\{[A-Z_]+\}/);
    }
  });

  it("seed shelf section renders identically in early-stage templates", () => {
    const expectedSeedShelf = [
      "## Seed Shelf Candidates (optional)",
      "| Seed file | Trigger when | Suggested action | Status (planted/deferred/ignored) |",
      "|---|---|---|---|",
      "| .cclaw/seeds/SEED-YYYY-MM-DD-<slug>.md |  |  |  |"
    ].join("\n");

    for (const templateName of ["01-brainstorm.md", "02-scope.md", "03-design.md"] as const) {
      expect(ARTIFACT_TEMPLATES[templateName]).toContain(expectedSeedShelf);
    }
  });

  it("stage skills render explicit when-not-to-use guidance", () => {
    const review = stageSchema("review");
    expect(review.whenNotToUse.length).toBeGreaterThan(0);
    const markdown = stageSkillMarkdown("review");
    expect(markdown).toContain("## When Not to Use");
  });

  it("tdd quick track drops the plan-trace gate and plan artifact dependency", () => {
    const tddQuick = stageSchema("tdd", "quick");
    const requiredQuickGates = tddQuick.requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    expect(requiredQuickGates).not.toContain("tdd_traceable_to_plan");
    expect(tddQuick.requiredGates.find((gate) => gate.id === "tdd_traceable_to_plan")).toBeUndefined();
    expect(tddQuick.crossStageTrace.readsFrom).not.toContain(".cclaw/artifacts/05-plan.md");
    expect(tddQuick.crossStageTrace.readsFrom).toEqual([".cclaw/artifacts/04-spec.md"]);

    const markdown = stageSkillMarkdown("tdd", "quick");
    expect(markdown).not.toContain(".cclaw/artifacts/05-plan.md");
    expect(markdown).toContain(".cclaw/artifacts/04-spec.md");
    expect(markdown).toContain("Track render context: `quick` (acceptance-first wording)");
  });

  it("tdd verification ladder is required and explicit", () => {
    const tdd = stageSchema("tdd");
    const ladder = tdd.artifactValidation.find((row) => row.section === "Verification Ladder");
    expect(ladder).toBeDefined();
    expect(ladder?.required).toBe(true);
    expect(ladder?.tier).toBe("required");
    expect(ladder?.validationRule).toMatch(/highest tier reached/i);
  });

  it("flow mechanics stages render discovery assumptions and posture guidance", () => {
    const spec = stageSchema("spec");
    const plan = stageSchema("plan");
    const tdd = stageSchema("tdd");

    expect(spec.requiredGates.map((gate) => gate.id)).toContain("spec_assumptions_surfaced");
    expect(spec.requiredGates.map((gate) => gate.id)).toContain("spec_self_review_complete");
    expect(spec.artifactValidation.find((row) => row.section === "Assumptions Before Finalization"))
      .toMatchObject({ required: true, tier: "required" });
    expect(spec.artifactValidation.find((row) => row.section === "Spec Self-Review"))
      .toMatchObject({ required: true, tier: "required" });
    expect(spec.artifactValidation.find((row) => row.section === "Synthesis Sources"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(spec.artifactValidation.find((row) => row.section === "Behavior Contract"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(spec.artifactValidation.find((row) => row.section === "Architecture Modules"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(stageSkillMarkdown("spec")).toContain("Before final spec approval, present the assumptions section");
    expect(ARTIFACT_TEMPLATES["04-spec.md"]).toContain("## Assumptions Before Finalization");
    expect(ARTIFACT_TEMPLATES["04-spec.md"]).toContain("## Spec Self-Review");
    expect(ARTIFACT_TEMPLATES["04-spec.md"]).not.toContain("## Testing Strategy");
    expect(ARTIFACT_TEMPLATES["04-spec.md"]).not.toContain("## Reviewer Concerns");
    expect(ARTIFACT_TEMPLATES["04-spec.md"]).toContain("Source / confidence");

    expect(plan.requiredGates.find((gate) => gate.id === "plan_dependency_batches_defined")?.description)
      .toContain("execution posture");
    expect(plan.artifactValidation.find((row) => row.section === "Execution Posture"))
      .toMatchObject({ required: true, tier: "required" });
    expect(plan.artifactValidation.find((row) => row.section === "Implementation Units"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(plan.artifactValidation.find((row) => row.section === "Calibrated Findings"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(plan.artifactValidation.find((row) => row.section === "Regression Iron Rule"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(stageSkillMarkdown("plan")).toContain("Expose execution posture");
    expect(ARTIFACT_TEMPLATES["05-plan.md"]).toContain("## Execution Posture");
    expect(ARTIFACT_TEMPLATES["05-plan.md"]).toContain("## Calibrated Findings");
    expect(ARTIFACT_TEMPLATES["05-plan.md"]).toContain("## Regression Iron Rule");
    expect(ARTIFACT_TEMPLATES["05-plan.md"]).not.toContain("## High-Level Technical Design");
    expect(ARTIFACT_TEMPLATES["05-plan.md"]).not.toContain("## Plan Self-Review");
    expect(ARTIFACT_TEMPLATES["05-plan.md"]).toContain("RED commit/checkpoint -> GREEN commit/checkpoint -> REFACTOR commit/checkpoint");

    expect(tdd.requiredGates.map((gate) => gate.id)).toEqual(expect.arrayContaining([
      "tdd_test_discovery_complete",
      "tdd_impact_check_complete",
      "tdd_iron_law_acknowledged",
      "tdd_watched_red_observed",
      "tdd_slice_cycle_complete"
    ]));
    expect(tdd.artifactValidation.find((row) => row.section === "Test Discovery"))
      .toMatchObject({ required: true, tier: "required" });
    expect(tdd.artifactValidation.find((row) => row.section === "System-Wide Impact Check"))
      .toMatchObject({ required: true, tier: "required" });
    expect(tdd.artifactValidation.find((row) => row.section === "Iron Law Acknowledgement"))
      .toMatchObject({ required: true, tier: "required" });
    expect(tdd.artifactValidation.find((row) => row.section === "Watched-RED Proof"))
      .toMatchObject({ required: true, tier: "required" });
    expect(tdd.artifactValidation.find((row) => row.section === "Vertical Slice Cycle"))
      .toMatchObject({ required: true, tier: "required" });
    expect(tdd.artifactValidation.find((row) => row.section === "Mock Preference Order"))
      .toMatchObject({ required: false, tier: "recommended" });
    expect(stageSkillMarkdown("tdd")).toContain("Before writing RED tests, discover relevant existing tests");
    expect(stageSkillMarkdown("tdd")).toContain("system-wide impact check across callbacks, state, interfaces, schemas, and external contracts");
    expect(ARTIFACT_TEMPLATES["06-tdd.md"]).toContain("## Test Discovery");
    expect(ARTIFACT_TEMPLATES["06-tdd.md"]).toContain("## System-Wide Impact Check");
    expect(ARTIFACT_TEMPLATES["06-tdd.md"]).toContain("## Per-Slice Review");
    expect(ARTIFACT_TEMPLATES["06-tdd.md"]).toContain("## TDD Blocker Taxonomy");
    expect(ARTIFACT_TEMPLATES["06-tdd.md"]).not.toContain("## Anti-Rationalization Checks");
    expect(ARTIFACT_TEMPLATES["06-tdd.md"]).not.toContain("## Learning Capture Hint");
  });

  it("every declared gate is marked required on at least one track (single source of truth)", () => {
    const allowedRecommendedOnly = new Set<string>([
      "review_layer_coverage_complete"
    ]);
    const offenders: Array<{ stage: FlowStage; gateId: string }> = [];
    for (const stage of FLOW_STAGES) {
      const idsByTrack = new Map<FlowTrack, Map<string, "required" | "recommended">>();
      for (const track of FLOW_TRACKS) {
        const schema = stageSchema(stage, track);
        const tiers = new Map(schema.requiredGates.map((gate) => [gate.id, gate.tier] as const));
        idsByTrack.set(track, tiers);
      }
      const allGateIds = new Set<string>();
      for (const tiers of idsByTrack.values()) {
        for (const id of tiers.keys()) allGateIds.add(id);
      }
      for (const gateId of allGateIds) {
        let requiredAnywhere = false;
        for (const track of FLOW_TRACKS) {
          const activeStages = new Set(TRACK_STAGES[track]);
          if (!activeStages.has(stage)) continue;
          const tier = idsByTrack.get(track)?.get(gateId);
          if (tier === "required") {
            requiredAnywhere = true;
            break;
          }
        }
        if (!requiredAnywhere && !allowedRecommendedOnly.has(gateId)) {
          offenders.push({ stage, gateId });
        }
      }
    }
    expect(
      offenders,
      `gate declared in a stage but never marked required on any track (probably missing from REQUIRED_GATE_IDS in src/content/stage-schema.ts)`
    ).toEqual([]);
  });

  it("tdd docs-drift gate is required across all tracks", () => {
    for (const track of FLOW_TRACKS) {
      const tdd = stageSchema("tdd", track);
      const drift = tdd.requiredGates.find((gate) => gate.id === "tdd_docs_drift_check");
      expect(drift, `tdd_docs_drift_check must exist on track=${track}`).toBeDefined();
      expect(drift?.tier, `tdd_docs_drift_check must be required on track=${track}`).toBe("required");
    }
  });

  it("brainstorm example is a valid artifact when copy-pasted verbatim", async () => {
    const inlinePointer = stageExamples("brainstorm");
    expect(inlinePointer).toContain("Shape cues to follow");

    const fullExample = stageFullArtifactExampleMarkdown("brainstorm");
    expect(fullExample, "stage full example should exist").toBeTruthy();
    const fenceMatch = /```markdown\n([\s\S]+?)\n```/u.exec(fullExample!);
    expect(fenceMatch, "example should be wrapped in a markdown fence").toBeTruthy();
    const body = fenceMatch![1]!;
    expect(body).toMatch(/^## Context/);

    const root = await createTempProject("examples-brainstorm");
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      `# Brainstorm Artifact\n\n${body}\n`,
      "utf8"
    );
    const result = await lintArtifact(root, "brainstorm");
    const failed = result.findings.filter((f) => f.required && !f.found);
    expect(failed.map((f) => f.section)).toEqual([]);
  });
});
