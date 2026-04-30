import { describe, expect, it } from "vitest";
import {
  evaluateIdeaCandidate,
  rankIdeaCandidates,
  scoreIdeaCandidate
} from "../../src/content/idea.js";

describe("idea ranking and critique model", () => {
  it("scores candidates by impact/effort/confidence", () => {
    const highLeverage = scoreIdeaCandidate("high", "s", "high");
    const mediumSameEffort = scoreIdeaCandidate("medium", "s", "high");
    const highButExpensive = scoreIdeaCandidate("high", "l", "high");
    const uncertain = scoreIdeaCandidate("high", "s", "low");

    expect(highLeverage).toBeGreaterThan(mediumSameEffort);
    expect(highLeverage).toBeGreaterThan(highButExpensive);
    expect(highLeverage).toBeGreaterThan(uncertain);
  });

  it("marks survivor disposition and ranking score on evaluation", () => {
    const survivor = evaluateIdeaCandidate({
      id: "I-1",
      title: "Harden gate-evidence diagnostics",
      impact: "high",
      effort: "m",
      confidence: "high",
      whyNow: "visible operator friction",
      expectedImpact: "faster recovery",
      risk: "overfitting to one path",
      nextCcPrompt: "/cc Harden gate-evidence diagnostics"
    });
    const dropped = evaluateIdeaCandidate({
      id: "I-2",
      title: "Rewrite the entire workflow system",
      impact: "high",
      effort: "l",
      confidence: "low"
    });

    expect(survivor.disposition).toBe("survivor");
    expect(survivor.rankingScore).toBeGreaterThan(0);
    expect(survivor.whyNow).toBe("visible operator friction");
    expect(survivor.nextCcPrompt).toContain("/cc");
    expect(dropped.disposition).toBe("rejected");
  });

  it("returns ranked survivors, rejected list, and recommendation", () => {
    const result = rankIdeaCandidates([
      {
        id: "I-1",
        title: "Strengthen trace diagnostics",
        impact: "high",
        effort: "s",
        confidence: "high"
      },
      {
        id: "I-2",
        title: "Improve frame dispatch telemetry",
        impact: "medium",
        effort: "s",
        confidence: "high"
      },
      {
        id: "I-3",
        title: "Large risky rewrite",
        impact: "high",
        effort: "l",
        confidence: "low"
      }
    ]);

    expect(result.survivors.map((candidate) => candidate.id)).toEqual(["I-1", "I-2"]);
    expect(result.recommendationId).toBe("I-1");
    expect(result.rejected.map((candidate) => candidate.id)).toContain("I-3");
  });

  it("respects max survivor cap while preserving rejected visibility", () => {
    const result = rankIdeaCandidates(
      [
        {
          id: "I-1",
          title: "A",
          impact: "high",
          effort: "s",
          confidence: "high"
        },
        {
          id: "I-2",
          title: "B",
          impact: "medium",
          effort: "s",
          confidence: "high"
        },
        {
          id: "I-3",
          title: "C",
          impact: "low",
          effort: "l",
          confidence: "low"
        }
      ],
      2
    );

    expect(result.survivors).toHaveLength(2);
    expect(result.rejected.map((candidate) => candidate.id)).toContain("I-3");
  });
});
