import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { SHIP_FINALIZATION_MODES } from "../../src/constants.js";
import { lintArtifact } from "../../src/artifact-linter.js";
import { CCLAW_AGENTS } from "../../src/content/core-agents.js";
import { stageExamples, stageFullArtifactExampleMarkdown } from "../../src/content/examples.js";
import { mandatoryDelegationsForStage, stageAutoSubagentDispatch, stagePolicyNeedles, stageSchema } from "../../src/content/stage-schema.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { enhancedAgentBody } from "../../src/content/subagents.js";
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
    expect(stageSchema("design").complexityTier).toBe("deep");
    // Plan does not set complexityTier explicitly and should fall back.
    expect(stageSchema("plan").complexityTier).toBe("standard");
  });

  it("supports complexity-tier gates for mandatory delegations", () => {
    expect(mandatoryDelegationsForStage("scope", "lightweight")).toEqual([]);
    expect(mandatoryDelegationsForStage("scope", "standard")).toContain("planner");
    expect(mandatoryDelegationsForStage("review", "lightweight")).toContain("reviewer");
    expect(mandatoryDelegationsForStage("ship", "lightweight")).toContain("doc-updater");
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

  it("derives policy needles from lint metadata with track transforms", () => {
    expect(stagePolicyNeedles("plan")).toContain("Dependency Batches");
    expect(stagePolicyNeedles("tdd", "quick")).toContain("traceable to acceptance slice");
    expect(stagePolicyNeedles("tdd", "quick")).not.toContain("traceable to plan slice");
  });

  it("plan stage reads spec, design, and scope artifacts", () => {
    const plan = stageSchema("plan");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/04-spec.md");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/03-design-<slug>.md");
    expect(plan.crossStageTrace.readsFrom).toContain(".cclaw/artifacts/02-scope-<slug>.md");
    expect(plan.requiredGates.map((gate) => gate.id)).toContain("plan_dependency_batches_defined");
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

  it("review stage includes review-army structured reconciliation", () => {
    const review = stageSchema("review");
    expect(review.requiredEvidence).toContain("Artifact written to `.cclaw/artifacts/07-review-army.json`.");
    expect(stagePolicyNeedles("review")).toContain("Review Army");
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

  it("review stage mandates reviewer and security-reviewer", () => {
    const review = stageSchema("review");
    expect(review.mandatoryDelegations).toContain("reviewer");
    expect(review.mandatoryDelegations).toContain("security-reviewer");
  });

  it("security-reviewer agent registry entry is mandatory", () => {
    const agent = CCLAW_AGENTS.find((a) => a.name === "security-reviewer");
    expect(agent).toBeDefined();
    expect(agent?.activation).toBe("mandatory");
    expect(agent?.description.toLowerCase()).toMatch(/mandatory|no-change/);
  });

  it("agent registry uses the core-5 roster", () => {
    expect(CCLAW_AGENTS.map((agent) => agent.name).sort()).toEqual([
      "doc-updater",
      "planner",
      "reviewer",
      "security-reviewer",
      "test-author"
    ]);
  });

  it("design skill renders research playbooks instead of research personas", () => {
    const design = stageSchema("design");
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
      "Error Flow Diagram",
      "State Machine Diagram",
      "Rollback Flowchart",
      "Deployment Sequence Diagram"
    ] as const) {
      const rule = design.artifactValidation.find((row) => row.section === section);
      expect(rule).toBeDefined();
      expect(rule?.required).toBe(false);
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
      "Problem",
      "Approach Tier",
      "Short-Circuit Decision",
      "Selected Direction"
    ]);
  });

  it("brainstorm and scope default to compact user-facing flow", () => {
    const brainstorm = stageSchema("brainstorm");
    const scope = stageSchema("scope");

    expect(brainstorm.executionModel.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("compact brainstorm stub")
    ]));
    expect(brainstorm.executionModel.interactionProtocol).toEqual(expect.arrayContaining([
      expect.stringContaining("Ask at most one question per turn")
    ]));
    expect(scope.executionModel.checklist).toEqual(expect.arrayContaining([
      expect.stringContaining("Default path first")
    ]));
    expect(scope.executionModel.interactionProtocol).toEqual(expect.arrayContaining([
      expect.stringContaining("Do not walk the full checklist by default")
    ]));
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
    expect(scopeTemplate).toContain("## Spec Review Loop");
    expect(designTemplate).toContain("## Outside Voice Findings");
    expect(designTemplate).toContain("## Spec Review Loop");
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
    expect(markdown).not.toContain("plan slice");
    expect(markdown).toContain("acceptance slice");
  });

  it("tdd verification ladder is required and explicit", () => {
    const tdd = stageSchema("tdd");
    const ladder = tdd.artifactValidation.find((row) => row.section === "Verification Ladder");
    expect(ladder).toBeDefined();
    expect(ladder?.required).toBe(true);
    expect(ladder?.tier).toBe("required");
    expect(ladder?.validationRule).toMatch(/highest tier reached/i);
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

  it("review trace matrix gate is required on standard and recommended on quick", () => {
    const reviewStandard = stageSchema("review", "standard");
    const reviewQuick = stageSchema("review", "quick");
    const standardGate = reviewStandard.requiredGates.find((gate) => gate.id === "review_trace_matrix_clean");
    const quickGate = reviewQuick.requiredGates.find((gate) => gate.id === "review_trace_matrix_clean");

    expect(standardGate).toBeDefined();
    expect(standardGate?.tier).toBe("required");
    expect(quickGate).toBeDefined();
    expect(quickGate?.tier).toBe("recommended");
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
