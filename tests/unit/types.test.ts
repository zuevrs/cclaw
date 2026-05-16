import { describe, expect, it } from "vitest";
import { FLOW_STAGES, HARNESS_IDS, SPECIALISTS } from "../../src/types.js";

describe("types", () => {
  it("flow stages: v8.42 inserts critic between review and ship (5 stages total); v8.52 inserts qa between build and review (6 stages total)", () => {
    expect(FLOW_STAGES).toEqual(["plan", "build", "qa", "review", "critic", "ship"]);
  });

  it("supports four harnesses", () => {
    expect(HARNESS_IDS).toEqual(["claude", "cursor", "opencode", "codex"]);
  });

  it("ships exactly nine specialists (v8.42 added the adversarial critic between security-reviewer and slice-builder; v8.51 added the pre-implementation plan-critic between ac-author and reviewer; v8.52 added the behavioural-QA qa-runner between critic and slice-builder; v8.61 added the lightweight-router triage at the end of the list)", () => {
    expect(SPECIALISTS).toHaveLength(9);
    expect(SPECIALISTS).toEqual([
      "design",
      "ac-author",
      "plan-critic",
      "reviewer",
      "security-reviewer",
      "critic",
      "qa-runner",
      "slice-builder",
      "triage"
    ]);
  });
});
