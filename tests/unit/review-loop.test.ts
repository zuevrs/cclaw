import { describe, expect, it } from "vitest";
import {
  FIVE_FAILURE_MODES,
  REVIEW_ITERATION_HARD_CAP,
  failureModesChecklist
} from "../../src/content/review-loop.js";

describe("review loop", () => {
  it("captures the five DAPLab failure modes", () => {
    expect(FIVE_FAILURE_MODES.map((mode) => mode.id)).toEqual([
      "hallucinated-actions",
      "scope-creep",
      "cascading-errors",
      "context-loss",
      "tool-misuse"
    ]);
  });

  it("hard-caps iterations at 5", () => {
    expect(REVIEW_ITERATION_HARD_CAP).toBe(5);
  });

  it("renders a checklist that includes all modes and the cap", () => {
    const md = failureModesChecklist();
    for (const mode of FIVE_FAILURE_MODES) {
      expect(md).toContain(mode.name);
    }
    expect(md).toMatch(/Hard cap/);
    expect(md).toContain("5");
  });
});
