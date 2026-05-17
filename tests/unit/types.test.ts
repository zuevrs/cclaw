import { describe, expect, it } from "vitest";
import {
  FLOW_STAGES,
  HARNESS_IDS,
  RESEARCH_AGENT_IDS,
  RESEARCH_LENSES,
  SPECIALISTS,
  type InstallableAgentId
} from "../../src/types.js";

describe("types", () => {
  it("flow stages: v8.42 inserts critic between review and ship (5 stages total); v8.52 inserts qa between build and review (6 stages total)", () => {
    expect(FLOW_STAGES).toEqual(["plan", "build", "qa", "review", "critic", "ship"]);
  });

  it("supports four harnesses", () => {
    expect(HARNESS_IDS).toEqual(["claude", "cursor", "opencode", "codex"]);
  });

  it("ships exactly nine specialists (v8.62 unified flow: collapsed `design` into `architect` (renamed from `ac-author`), renamed `slice-builder` to `builder`, and folded `security-reviewer`'s threat-model / taint / secrets / supply-chain coverage into `reviewer`'s `security` axis; v8.42 added the adversarial critic; v8.51 added the pre-implementation plan-critic; v8.52 added the behavioural-QA qa-runner; v8.61 added the lightweight-router triage; v8.75 added the pre-implementation plan-design specialist; v8.77 added the debug-branch `investigator` specialist between triage and architect on bug-shaped flows; the array order traces the canonical pipeline triage → investigator? → plan → build → qa → review → critic → ship)", () => {
    expect(SPECIALISTS).toHaveLength(9);
    expect(SPECIALISTS).toEqual([
      "triage",
      "investigator",
      "architect",
      "builder",
      "plan-critic",
      "plan-design",
      "qa-runner",
      "reviewer",
      "critic"
    ]);
  });

  it("v8.65 (+v8.76) — RESEARCH_LENSES enumerates exactly six research-only sub-agents (engineer / product / architecture / history / skeptic / design) in the canonical order the orchestrator dispatches and the research.md template renders; v8.76 added `research-design` as the 6th lens, conditionally dispatched on standard+ depth when the topic touches UI / UX / design / frontend surfaces", () => {
    expect(RESEARCH_LENSES).toHaveLength(6);
    expect(RESEARCH_LENSES).toEqual([
      "research-engineer",
      "research-product",
      "research-architecture",
      "research-history",
      "research-skeptic",
      "research-design"
    ]);
  });

  it("v8.65 — RESEARCH_LENSES are NOT in SPECIALISTS (lenses are research-only and live in a separate collection so they don't bloat the flow specialist surface)", () => {
    for (const lens of RESEARCH_LENSES) {
      expect(SPECIALISTS as readonly string[]).not.toContain(lens);
    }
  });

  it("v8.65 — RESEARCH_LENSES are NOT in RESEARCH_AGENT_IDS (those are read-only research helpers — repo-research / learnings-research — dispatched by specialists or lenses)", () => {
    for (const lens of RESEARCH_LENSES) {
      expect(RESEARCH_AGENT_IDS as readonly string[]).not.toContain(lens);
    }
  });

  it("v8.65 — InstallableAgentId admits research-lens ids alongside specialist + research-agent ids (compile-time check via direct assignment)", () => {
    const samples: InstallableAgentId[] = [
      "architect",
      "repo-research",
      "research-engineer",
      "research-skeptic"
    ];
    expect(samples).toHaveLength(4);
  });
});
