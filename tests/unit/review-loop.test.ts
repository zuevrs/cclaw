import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  REVIEW_LOOP_CHECKLISTS,
  aggregateQualityScore,
  runReviewLoop,
  runReviewLoopIteration,
  toSkillEnvelope
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
});
