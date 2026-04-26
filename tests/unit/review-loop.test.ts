import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  REVIEW_LOOP_CHECKLISTS,
  reviewLoopPolicySummary,
  reviewLoopSecondOpinionSummary,
  aggregateQualityScore,
  buildOutsideVoiceReviewPrompt,
  createSecondOpinionDispatcher,
  createOutsideVoiceDispatcher,
  extractReviewLoopEnvelopeFromArtifact,
  mergeSecondOpinionResults,
  parseReviewLoopDispatcherResult,
  renderReviewLoopHeader,
  renderReviewLoopSummarySection,
  runReviewLoop,
  runReviewLoopIteration,
  toSkillEnvelope,
  upsertReviewLoopHeader,
  upsertReviewLoopSummary
} from "../../src/content/review-loop.js";
import { validateSkillEnvelope } from "../../src/content/stage-schema.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

describe("review-loop contracts", () => {
  it("keeps exactly five checklist dimensions for scope and design", () => {
    const scope = REVIEW_LOOP_CHECKLISTS.scope;
    const design = REVIEW_LOOP_CHECKLISTS.design;
    expect(scope).toHaveLength(5);
    expect(design).toHaveLength(5);
    expect(new Set(scope.map((row) => row.id)).size).toBe(5);
    expect(new Set(design.map((row) => row.id)).size).toBe(5);
  });

  it("renders compact outside-voice policy summaries", () => {
    expect(reviewLoopPolicySummary("scope")).toContain("quality score >= 0.8");
    expect(reviewLoopPolicySummary("design")).toContain("max 3 iterations");
    expect(reviewLoopSecondOpinionSummary("scope")).toContain("externalSecondOpinion.enabled");
  });

  it("aggregates weighted quality scores per checklist dimension", () => {
    const checklist = REVIEW_LOOP_CHECKLISTS.scope;
    const score = aggregateQualityScore(
      [
        { dimensionId: checklist[0]!.id, score: 0.8, weight: 2 },
        { dimensionId: checklist[1]!.id, score: 0.6, weight: 1 },
        { dimensionId: checklist[2]!.id, score: 0.4, weight: 1 },
        { dimensionId: checklist[3]!.id, score: 1.0, weight: 1 },
        { dimensionId: checklist[4]!.id, score: 0.2, weight: 1 }
      ],
      checklist
    );
    // (0.8*2 + 0.6 + 0.4 + 1.0 + 0.2) / 6
    expect(score).toBeCloseTo(0.6333, 3);
  });

  it("serializes artifact to a temp file before dispatch", async () => {
    const root = await createTempProject("review-loop-iteration");
    const artifactPath = await writeProjectFile(
      root,
      ".cclaw/artifacts/02-scope-contract.md",
      "# Scope Contract\n\nThin draft."
    );

    const dispatcher = vi.fn(async (request: { artifactPath: string; checklist: readonly { id: string }[] }) => {
      const copied = await fs.readFile(request.artifactPath, "utf8");
      expect(copied).toContain("Thin draft.");
      return {
        findings: [
          {
            id: "F-1",
            severity: "important",
            dimensionId: request.checklist[0]!.id,
            summary: "Premise fit is underspecified."
          }
        ],
        dimensionScores: request.checklist.map((dimension) => ({
          dimensionId: dimension.id,
          score: dimension.id === request.checklist[0]!.id ? 0.2 : 0.7
        }))
      };
    });

    const result = await runReviewLoopIteration(
      {
        artifactPath,
        stage: "scope",
        iteration: 1,
        budget: { targetScore: 0.8, maxIterations: 3 }
      },
      dispatcher
    );

    expect(dispatcher).toHaveBeenCalledTimes(1);
    const call = dispatcher.mock.calls[0]![0] as { artifactPath: string };
    expect(call.artifactPath).not.toBe(artifactPath);
    expect(result.qualityScore).toBeLessThan(0.8);
    expect(result.shouldContinue).toBe(true);
    expect(result.findings).toHaveLength(1);
  });

  it("builds dispatcher prompt with checklist and prior iterations context", () => {
    const checklist = REVIEW_LOOP_CHECKLISTS.scope;
    const prompt = buildOutsideVoiceReviewPrompt({
      stage: "scope",
      artifactPath: "/tmp/artifact.md",
      checklist,
      priorIterations: [
        { iteration: 1, qualityScore: 0.42, findingsCount: 5 },
        { iteration: 2, qualityScore: 0.67, findingsCount: 3 }
      ],
      iteration: 3,
      budget: { maxIterations: 3, targetScore: 0.8 }
    });
    expect(prompt).toContain("Outside Voice adversarial reviewer");
    expect(prompt).toContain("Iteration: 3/3");
    expect(prompt).toContain("[premise_fit]");
    expect(prompt).toContain("iteration 2: score=0.670, findings=3");
    expect(prompt).toContain("\"dimensionScores\"");
  });

  it("parses nested payload responses from a dispatcher adapter", () => {
    const checklist = REVIEW_LOOP_CHECKLISTS.design;
    const parsed = parseReviewLoopDispatcherResult(
      {
        version: "1",
        kind: "stage-output",
        payload: {
          findings: [
            {
              id: "F-9",
              dimensionId: checklist[1]!.id,
              severity: "critical",
              summary: "Failure mode rescue is missing."
            }
          ],
          dimensionScores: checklist.map((dimension) => ({
            dimensionId: dimension.id,
            score: dimension.id === checklist[1]!.id ? 0.1 : 0.8
          }))
        }
      },
      checklist
    );
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({
      id: "F-9",
      severity: "critical",
      dimensionId: checklist[1]!.id
    });
    expect(parsed.dimensionScores).toHaveLength(5);
  });

  it("adapts outside-voice adapter into dispatcher shape", async () => {
    const adapter = vi.fn(async () => ({
      findings: [{ id: "F-1", dimensionId: "premise_fit", severity: "important", summary: "Gap" }],
      dimensionScores: [{ dimensionId: "premise_fit", score: 0.5 }]
    }));
    const dispatcher = createOutsideVoiceDispatcher(adapter);
    const result = await dispatcher({
      stage: "scope",
      artifactPath: "/tmp/scope.md",
      checklist: REVIEW_LOOP_CHECKLISTS.scope,
      priorIterations: [],
      iteration: 1,
      budget: { maxIterations: 3, targetScore: 0.8 }
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    const payload = adapter.mock.calls[0]![0] as { prompt: string; responseSchema: string };
    expect(payload.prompt).toContain("Stage: scope");
    expect(payload.responseSchema).toContain("\"findings\"");
    expect(result).toBeTruthy();
  });

  it("merges primary and second-opinion findings with averaged scores", () => {
    const checklist = REVIEW_LOOP_CHECKLISTS.scope;
    const merged = mergeSecondOpinionResults(
      {
        findings: [
          {
            id: "F-1",
            dimensionId: checklist[0]!.id,
            severity: "important",
            summary: "Primary says premise fit needs tightening."
          }
        ],
        dimensionScores: checklist.map((dimension) => ({
          dimensionId: dimension.id,
          score: 0.9
        }))
      },
      {
        findings: [
          {
            id: "F-2",
            dimensionId: checklist[1]!.id,
            severity: "critical",
            summary: "Second opinion sees alternatives coverage gap."
          }
        ],
        dimensionScores: checklist.map((dimension) => ({
          dimensionId: dimension.id,
          score: 0.4
        }))
      },
      checklist,
      { enabled: true, scoreDeltaThreshold: 0.2, modelLabel: "external-model" }
    );

    expect(merged.findings.some((finding) => finding.id === "F-1")).toBe(true);
    expect(merged.findings.some((finding) => finding.id === "F-2")).toBe(true);
    expect(
      merged.findings.some((finding) => finding.id === "F-cross-model-disagreement")
    ).toBe(true);
    expect(merged.dimensionScores).toHaveLength(5);
    expect(merged.dimensionScores[0]?.score).toBeCloseTo(0.65, 6);
    expect(merged.secondOpinion.enabled).toBe(true);
    expect(merged.secondOpinion.modelLabel).toBe("external-model");
    expect(merged.secondOpinion.scoreDelta).toBeCloseTo(0.5, 6);
  });

  it("createSecondOpinionDispatcher falls back to primary when disabled", async () => {
    const primary = vi.fn(async () => ({
      findings: [{ id: "F-1", dimensionId: "premise_fit", severity: "important", summary: "Gap" }],
      dimensionScores: [{ dimensionId: "premise_fit", score: 0.5 }]
    }));
    const second = vi.fn(async () => ({
      findings: [{ id: "F-2", dimensionId: "premise_fit", severity: "critical", summary: "Deeper gap" }],
      dimensionScores: [{ dimensionId: "premise_fit", score: 0.1 }]
    }));
    const dispatcher = createSecondOpinionDispatcher({
      primary,
      secondOpinion: second,
      policy: { enabled: false }
    });
    const result = await dispatcher({
      stage: "scope",
      artifactPath: "/tmp/scope.md",
      checklist: REVIEW_LOOP_CHECKLISTS.scope,
      priorIterations: [],
      iteration: 1,
      budget: { maxIterations: 3, targetScore: 0.8 }
    });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(0);
    const parsed = parseReviewLoopDispatcherResult(result, REVIEW_LOOP_CHECKLISTS.scope);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.id).toBe("F-1");
  });

  it("createSecondOpinionDispatcher merges when enabled", async () => {
    const checklist = REVIEW_LOOP_CHECKLISTS.scope;
    const primary = vi.fn(async (request: { checklist: readonly { id: string }[] }) => ({
      findings: [
        {
          id: "F-1",
          dimensionId: request.checklist[0]!.id,
          severity: "important",
          summary: "Primary finding"
        }
      ],
      dimensionScores: request.checklist.map((dimension) => ({
        dimensionId: dimension.id,
        score: 0.9
      }))
    }));
    const second = vi.fn(async (request: { checklist: readonly { id: string }[] }) => ({
      findings: [
        {
          id: "F-2",
          dimensionId: request.checklist[1]!.id,
          severity: "critical",
          summary: "Second finding"
        }
      ],
      dimensionScores: request.checklist.map((dimension) => ({
        dimensionId: dimension.id,
        score: 0.3
      }))
    }));
    const dispatcher = createSecondOpinionDispatcher({
      primary,
      secondOpinion: second,
      policy: { enabled: true, scoreDeltaThreshold: 0.2, modelLabel: "external-reviewer" }
    });
    const raw = await dispatcher({
      stage: "scope",
      artifactPath: "/tmp/scope.md",
      checklist,
      priorIterations: [],
      iteration: 1,
      budget: { maxIterations: 3, targetScore: 0.8 }
    });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    const merged = raw as {
      findings?: Array<{ id?: string }>;
      secondOpinion?: { modelLabel?: string };
    };
    expect(merged.findings?.some((finding) => finding.id === "F-cross-model-disagreement")).toBe(
      true
    );
    expect(merged.secondOpinion?.modelLabel).toBe("external-reviewer");
  });

  it("runs until retry budget is exhausted when score stays below target", async () => {
    const root = await createTempProject("review-loop-max-iterations");
    const artifactPath = await writeProjectFile(
      root,
      ".cclaw/artifacts/03-design-contract.md",
      "# Design Contract\n\nInitial weak draft."
    );
    const perIterationScore = [0.42, 0.61, 0.74];
    const applyFindings = vi.fn(async () => {});
    const dispatcher = vi.fn(
      async (request: {
        iteration: number;
        checklist: readonly { id: string }[];
      }) => ({
        findings: [
          {
            id: `F-${request.iteration}`,
            severity: "important",
            dimensionId: request.checklist[0]!.id,
            summary: `Iteration ${request.iteration} still has unresolved gaps.`
          }
        ],
        dimensionScores: request.checklist.map((dimension) => ({
          dimensionId: dimension.id,
          score: perIterationScore[request.iteration - 1]!
        }))
      })
    );

    const result = await runReviewLoop(
      {
        artifactPath,
        stage: "design",
        budget: { maxIterations: 3, targetScore: 0.8 }
      },
      {
        dispatcher,
        applyFindings
      }
    );

    expect(result.stopReason).toBe("max_iterations_reached");
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations[0]!.qualityScore).toBeCloseTo(0.42, 6);
    expect(result.iterations[1]!.qualityScore).toBeCloseTo(0.61, 6);
    expect(result.iterations[2]!.qualityScore).toBeCloseTo(0.74, 6);
    expect(result.iterations[1]!.qualityScore).toBeGreaterThan(
      result.iterations[0]!.qualityScore
    );
    expect(result.iterations[2]!.qualityScore).toBeGreaterThan(
      result.iterations[1]!.qualityScore
    );
    expect(applyFindings).toHaveBeenCalledTimes(3);
    expect(result.envelope.iterations).toHaveLength(3);
  });

  it("early-exits at threshold and emits a valid skill envelope payload", async () => {
    const root = await createTempProject("review-loop-early-exit");
    const artifactPath = await writeProjectFile(
      root,
      ".cclaw/artifacts/02-scope-contract.md",
      "# Scope Contract\n\nStrong draft."
    );
    const dispatcher = vi.fn(
      async (request: { checklist: readonly { id: string }[] }) => ({
        findings: [],
        dimensionScores: request.checklist.map((dimension) => ({
          dimensionId: dimension.id,
          score: 0.92
        }))
      })
    );
    const emitEnvelope = vi.fn();
    const result = await runReviewLoop(
      {
        artifactPath,
        stage: "scope",
        budget: { maxIterations: 3, targetScore: 0.8 }
      },
      {
        dispatcher,
        applyFindings: async () => {},
        emitEnvelope
      }
    );

    expect(result.stopReason).toBe("quality_threshold_met");
    expect(result.iterations).toHaveLength(1);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0.8);
    expect(emitEnvelope).toHaveBeenCalledTimes(1);

    const envelope = toSkillEnvelope(
      result.envelope,
      "2026-01-01T00:00:00Z",
      "reviewer"
    );
    const validation = validateSkillEnvelope(envelope);
    expect(validation.ok).toBe(true);
    expect(envelope.payload).toMatchObject({
      type: "review-loop",
      stage: "scope",
      stopReason: "quality_threshold_met"
    });
  });

  it("renders and upserts outside voice loop summary section", () => {
    const envelope = {
      type: "review-loop",
      version: "1",
      stage: "scope",
      artifactPath: ".cclaw/artifacts/02-scope-demo.md",
      targetScore: 0.8,
      maxIterations: 3,
      stopReason: "quality_threshold_met",
      iterations: [
        { iteration: 1, qualityScore: 0.62, findingsCount: 4 },
        { iteration: 2, qualityScore: 0.81, findingsCount: 1 }
      ]
    } as const;
    const section = renderReviewLoopSummarySection(envelope);
    expect(section).toContain("## Scope Outside Voice Loop");
    expect(section).toContain("| 2 | 0.810 | 1 |");
    expect(section).toContain("Stop reason: quality_threshold_met");
    const header = renderReviewLoopHeader(envelope);
    expect(header).toContain("Review Loop Quality: 0.810");
    expect(header).toContain("iterations: 2/3");

    const baseArtifact = `# Scope Artifact

## Scope Mode
- [x] selective

## Completion Dashboard
- Checklist findings: open
`;
    const withHeaderOnly = upsertReviewLoopHeader(baseArtifact, {
      type: "review-loop",
      version: "1",
      stage: "scope",
      artifactPath: ".cclaw/artifacts/02-scope-demo.md",
      targetScore: 0.8,
      maxIterations: 3,
      stopReason: "max_iterations_reached",
      iterations: [{ iteration: 1, qualityScore: 0.5, findingsCount: 5 }]
    });
    expect(withHeaderOnly).toContain("> Review Loop Quality: 0.500");

    const withSection = upsertReviewLoopSummary(baseArtifact, {
      type: "review-loop",
      version: "1",
      stage: "scope",
      artifactPath: ".cclaw/artifacts/02-scope-demo.md",
      targetScore: 0.8,
      maxIterations: 3,
      stopReason: "max_iterations_reached",
      iterations: [{ iteration: 1, qualityScore: 0.5, findingsCount: 5 }]
    });
    expect(withSection).toContain("> Review Loop Quality: 0.500");
    expect(withSection).toContain("## Scope Outside Voice Loop");

    const replaced = upsertReviewLoopSummary(withSection, {
      type: "review-loop",
      version: "1",
      stage: "scope",
      artifactPath: ".cclaw/artifacts/02-scope-demo.md",
      targetScore: 0.8,
      maxIterations: 3,
      stopReason: "quality_threshold_met",
      iterations: [{ iteration: 1, qualityScore: 0.82, findingsCount: 1 }]
    });
    expect((replaced.match(/Review Loop Quality:/g) ?? []).length).toBe(1);
    expect((replaced.match(/## Scope Outside Voice Loop/g) ?? []).length).toBe(1);
    expect(replaced).toContain("> Review Loop Quality: 0.820");
    expect(replaced).toContain("| 1 | 0.820 | 1 |");
    expect(replaced).toContain("Stop reason: quality_threshold_met");
  });

  it("extracts review-loop envelope from artifact markdown", () => {
    const markdown = `# Scope Artifact

> Review Loop Quality: 0.830 | stop: quality_threshold_met | iterations: 2/3

## Scope Mode
- selective

## Spec Review Loop
| Iteration | Quality Score | Findings | Stop decision |
|---|---|---|---|
| 1 | 0.610 | 4 | continue |
| 2 | 0.830 | 1 | stop |
- Stop reason: quality_threshold_met
- Target score: 0.800
- Max iterations: 3
- Unresolved concerns: None
`;
    const envelope = extractReviewLoopEnvelopeFromArtifact(
      markdown,
      "scope",
      ".cclaw/artifacts/02-scope-demo.md"
    );
    expect(envelope).toBeTruthy();
    expect(envelope?.type).toBe("review-loop");
    expect(envelope?.stage).toBe("scope");
    expect(envelope?.iterations).toHaveLength(2);
    expect(envelope?.iterations[1]).toMatchObject({
      iteration: 2,
      qualityScore: 0.83,
      findingsCount: 1
    });
    expect(envelope?.stopReason).toBe("quality_threshold_met");
  });

  it("extracts review-loop envelope from practical markdown cells", () => {
    const markdown = `# Scope Artifact

## Spec Review Loop
| Iteration | Quality Score | Findings | Notes |
|---|---|---|---|
| Iteration 1 | 61% | 4 findings | first pass |
| Iteration 2 | score: 0.83 | no findings | threshold met |
- Stop reason: quality_threshold_met
- Target score: 80%
- Max iterations: 3
`;
    const envelope = extractReviewLoopEnvelopeFromArtifact(
      markdown,
      "scope",
      ".cclaw/artifacts/02-scope-demo.md"
    );
    expect(envelope).toBeTruthy();
    expect(envelope?.targetScore).toBe(0.8);
    expect(envelope?.iterations).toEqual([
      { iteration: 1, qualityScore: 0.61, findingsCount: 4 },
      { iteration: 2, qualityScore: 0.83, findingsCount: 0 }
    ]);
  });

  it("returns null when artifact has no valid spec review loop table", () => {
    const markdown = `# Design Artifact

## Spec Review Loop
- Stop reason: quality_threshold_met
`;
    const envelope = extractReviewLoopEnvelopeFromArtifact(
      markdown,
      "design",
      ".cclaw/artifacts/03-design-demo.md"
    );
    expect(envelope).toBeNull();
  });
});
