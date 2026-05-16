import { describe, expect, it } from "vitest";
import { FLOW_STAGES, HARNESS_IDS, SPECIALISTS } from "../../src/types.js";

describe("types", () => {
  it("flow stages: v8.42 inserts critic between review and ship (5 stages total); v8.52 inserts qa between build and review (6 stages total)", () => {
    expect(FLOW_STAGES).toEqual(["plan", "build", "qa", "review", "critic", "ship"]);
  });

  it("supports four harnesses", () => {
    expect(HARNESS_IDS).toEqual(["claude", "cursor", "opencode", "codex"]);
  });

  it("ships exactly seven specialists (v8.62 unified flow: collapsed `design` into `architect` (renamed from `ac-author`), renamed `slice-builder` to `builder`, and folded `security-reviewer`'s threat-model / taint / secrets / supply-chain coverage into `reviewer`'s `security` axis; v8.42 added the adversarial critic; v8.51 added the pre-implementation plan-critic; v8.52 added the behavioural-QA qa-runner; v8.61 added the lightweight-router triage; the array order traces the canonical pipeline triage → plan → build → qa → review → critic → ship)", () => {
    expect(SPECIALISTS).toHaveLength(7);
    expect(SPECIALISTS).toEqual([
      "triage",
      "architect",
      "builder",
      "plan-critic",
      "qa-runner",
      "reviewer",
      "critic"
    ]);
  });
});
