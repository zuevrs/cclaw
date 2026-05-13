import { describe, expect, it } from "vitest";
import { FLOW_STAGES, HARNESS_IDS, SPECIALISTS } from "../../src/types.js";

describe("types", () => {
  it("flow stages: v8.42 inserts critic between review and ship (5 stages total)", () => {
    expect(FLOW_STAGES).toEqual(["plan", "build", "review", "critic", "ship"]);
  });

  it("supports four harnesses", () => {
    expect(HARNESS_IDS).toEqual(["claude", "cursor", "opencode", "codex"]);
  });

  it("ships exactly six specialists (v8.42 added the adversarial critic between security-reviewer and slice-builder)", () => {
    expect(SPECIALISTS).toHaveLength(6);
    expect(SPECIALISTS).toEqual([
      "design",
      "ac-author",
      "reviewer",
      "security-reviewer",
      "critic",
      "slice-builder"
    ]);
  });
});
