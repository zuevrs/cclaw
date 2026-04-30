import { describe, expect, it } from "vitest";
import { questionBudgetHint, resolveTrackFromPrompt } from "../../src/track-heuristics.js";

describe("track heuristics resolver", () => {
  it("routes bugfix prompts to quick by default", () => {
    const result = resolveTrackFromPrompt("hotfix login typo in auth flow", undefined);
    expect(result.track).toBe("quick");
    expect(result.matchedTokens.length).toBeGreaterThan(0);
    expect(result.confidence).toMatch(/high|medium/);
    expect(result.overrideGuidance).toContain("quick skips ceremony, not safety");
  });

  it("routes additive prompts to medium by default", () => {
    const result = resolveTrackFromPrompt("add endpoint for internal audit export", undefined);
    expect(result.track).toBe("medium");
  });

  it("falls back to standard when no rule matches", () => {
    const result = resolveTrackFromPrompt("investigate something vague", undefined);
    expect(result.track).toBe("standard");
    expect(result.matchedTokens).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.overrideGuidance).toContain("Confirm or override");
  });

  it("honors config fallback when no rule matches", () => {
    const result = resolveTrackFromPrompt("something ambiguous", {
      fallback: "medium"
    });
    expect(result.track).toBe("medium");
  });

  it("supports veto tokens to prevent misrouting", () => {
    const result = resolveTrackFromPrompt("fix schema migration for ledger", {
      tracks: {
        quick: {
          triggers: ["fix"],
          veto: ["schema", "migration"]
        }
      }
    });
    expect(result.track).toBe("standard");
  });

  it("returns stage-aware question budget hints for adaptive elicitation stages", () => {
    expect(questionBudgetHint("quick", "brainstorm")).toEqual({
      min: 2,
      recommended: 3,
      hardCapWarning: 4
    });
    expect(questionBudgetHint("medium", "scope")).toEqual({
      min: 5,
      recommended: 6,
      hardCapWarning: 8
    });
    expect(questionBudgetHint("standard", "design")).toEqual({
      min: 10,
      recommended: 12,
      hardCapWarning: 14
    });
  });

  it("returns no budget for non-elicitation stages", () => {
    expect(questionBudgetHint("standard", "tdd")).toEqual({
      min: 0,
      recommended: 0,
      hardCapWarning: 0
    });
  });
});
