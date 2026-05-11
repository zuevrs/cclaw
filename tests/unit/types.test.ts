import { describe, expect, it } from "vitest";
import { FLOW_STAGES, HARNESS_IDS, SPECIALISTS } from "../../src/types.js";

describe("types", () => {
  it("flow stages collapse to plan/build/review/ship", () => {
    expect(FLOW_STAGES).toEqual(["plan", "build", "review", "ship"]);
  });

  it("supports four harnesses", () => {
    expect(HARNESS_IDS).toEqual(["claude", "cursor", "opencode", "codex"]);
  });

  it("ships exactly five specialists (v8.14 collapsed brainstormer+architect into design)", () => {
    expect(SPECIALISTS).toHaveLength(5);
    expect(SPECIALISTS).toEqual([
      "design",
      "planner",
      "reviewer",
      "security-reviewer",
      "slice-builder"
    ]);
  });
});
