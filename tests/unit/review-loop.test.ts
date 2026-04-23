import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  REVIEW_LOOP_CHECKLISTS,
  aggregateQualityScore,
  buildOutsideVoiceReviewPrompt,
  createOutsideVoiceDispatcher,
  parseReviewLoopDispatcherResult,
  renderReviewLoopSummarySection,
  runReviewLoop,
  runReviewLoopIteration,
  toSkillEnvelope,
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

  it("renders and upserts spec review loop summary section", () => {
    const section = renderReviewLoopSummarySection({
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
    });
    expect(section).toContain("## Spec Review Loop");
    expect(section).toContain("| 2 | 0.810 | 1 |");
    expect(section).toContain("Stop reason: quality_threshold_met");

    const baseArtifact = `# Scope Artifact

## Scope Mode
- [x] selective

## Completion Dashboard
- Checklist findings: open
`;
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
    expect(withSection).toContain("## Spec Review Loop");

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
    expect((replaced.match(/## Spec Review Loop/g) ?? []).length).toBe(1);
    expect(replaced).toContain("| 1 | 0.820 | 1 |");
    expect(replaced).toContain("Stop reason: quality_threshold_met");
  });
});
