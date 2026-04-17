import { describe, expect, it } from "vitest";
import { resolveTrackFromPrompt } from "../../src/track-heuristics.js";

describe("track heuristics resolver", () => {
  it("routes bugfix prompts to quick by default", () => {
    const result = resolveTrackFromPrompt("hotfix login typo in auth flow", undefined);
    expect(result.track).toBe("quick");
    expect(result.matchedTokens.length).toBeGreaterThan(0);
  });

  it("routes additive prompts to medium by default", () => {
    const result = resolveTrackFromPrompt("add endpoint for internal audit export", undefined);
    expect(result.track).toBe("medium");
  });

  it("falls back to standard when no rule matches", () => {
    const result = resolveTrackFromPrompt("investigate something vague", undefined);
    expect(result.track).toBe("standard");
    expect(result.matchedTokens).toEqual([]);
  });

  it("honors config fallback and custom priority", () => {
    const result = resolveTrackFromPrompt("something ambiguous", {
      fallback: "medium",
      priority: ["quick", "medium", "standard"]
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
});
