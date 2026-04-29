import { describe, expect, it } from "vitest";
import {
  evaluateIdeateCandidate,
  isCritiquedOut,
  rankIdeateCandidates,
  scoreIdeateCandidate
} from "../../src/content/ideate-ranking.js";

describe("ideate ranking and critique model", () => {
  it("critiques out ideas where counter-argument is stronger", () => {
    expect(isCritiquedOut(0.6, 0.61)).toBe(true);
    expect(isCritiquedOut(0.6, 0.6)).toBe(false);
    expect(isCritiquedOut(0.8, 0.3)).toBe(false);
  });

  it("scores candidates by impact/effort/confidence", () => {
    const highLeverage = scoreIdeateCandidate("high", "s", "high");
    const mediumSameEffort = scoreIdeateCandidate("medium", "s", "high");
    const highButExpensive = scoreIdeateCandidate("high", "l", "high");
    const uncertain = scoreIdeateCandidate("high", "s", "low");

    expect(highLeverage).toBeGreaterThan(mediumSameEffort);
    expect(highLeverage).toBeGreaterThan(highButExpensive);
    expect(highLeverage).toBeGreaterThan(uncertain);
  });

  it("marks survivor disposition and ranking score on evaluation", () => {
    const survivor = evaluateIdeateCandidate({
      id: "I-1",
      title: "Harden gate-evidence diagnostics",
      impact: "high",
      effort: "m",
      confidence: "high",
      whyNow: "visible operator friction",
      expectedImpact: "faster recovery",
      risk: "overfitting to one path",
      nextCcPrompt: "/cc Harden gate-evidence diagnostics",
      rationaleStrength: 0.8,
      counterArgumentStrength: 0.4
    });
    const dropped = evaluateIdeateCandidate({
      id: "I-2",
      title: "Rewrite the entire workflow system",
      impact: "high",
      effort: "l",
      confidence: "low",
      rationaleStrength: 0.45,
      counterArgumentStrength: 0.8
    });

    expect(survivor.disposition).toBe("survivor");
    expect(survivor.rankingScore).toBeGreaterThan(0);
    expect(survivor.whyNow).toBe("visible operator friction");
    expect(survivor.nextCcPrompt).toContain("/cc");
    expect(dropped.disposition).toBe("critiqued-out");
  });

  it("returns ranked survivors, critiqued-out list, and recommendation", () => {
    const result = rankIdeateCandidates([
      {
        id: "I-1",
        title: "Strengthen trace diagnostics",
        impact: "high",
        effort: "s",
        confidence: "high",
        rationaleStrength: 0.8,
        counterArgumentStrength: 0.4
      },
      {
        id: "I-2",
        title: "Improve frame dispatch telemetry",
        impact: "medium",
        effort: "s",
        confidence: "high",
        rationaleStrength: 0.74,
        counterArgumentStrength: 0.5
      },
      {
        id: "I-3",
        title: "Large risky rewrite",
        impact: "high",
        effort: "l",
        confidence: "low",
        rationaleStrength: 0.4,
        counterArgumentStrength: 0.7
      }
    ]);

    expect(result.survivors.map((candidate) => candidate.id)).toEqual(["I-1", "I-2"]);
    expect(result.recommendationId).toBe("I-1");
    expect(result.critiquedOut.map((candidate) => candidate.id)).toContain("I-3");
  });

  it("respects max survivor cap while preserving critiqued-out visibility", () => {
    const result = rankIdeateCandidates(
      [
        {
          id: "I-1",
          title: "A",
          impact: "high",
          effort: "s",
          confidence: "high",
          rationaleStrength: 0.8,
          counterArgumentStrength: 0.3
        },
        {
          id: "I-2",
          title: "B",
          impact: "medium",
          effort: "s",
          confidence: "high",
          rationaleStrength: 0.8,
          counterArgumentStrength: 0.3
        },
        {
          id: "I-3",
          title: "C",
          impact: "low",
          effort: "s",
          confidence: "high",
          rationaleStrength: 0.8,
          counterArgumentStrength: 0.3
        }
      ],
      2
    );

    expect(result.survivors).toHaveLength(2);
    expect(result.critiquedOut.map((candidate) => candidate.id)).toContain("I-3");
  });
});
