import { describe, expect, it } from "vitest";
import {
  AUTO_TRIGGER_DISPATCH_STAGES,
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  buildAutoTriggerBlockForStage,
  type AutoTriggerStage
} from "../../src/content/skills.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";

/**
 * v8.19 skill-windowing — stage-scoped skill loading. Slimmed in v8.99
 * test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT.
 */

describe("v8.19 skill-windowing wiring (data shape + canonical stage mapping)", () => {
  it("WIRING — AUTO_TRIGGER_SKILLS ships ≥17 entries with unique fileNames + non-empty bodies, every skill carries a stages array drawn from the known AutoTriggerStage union, and the canonical per-skill stage mapping is intact (triage-gate=triage; flow-resume/conversation-language/anti-slop/summary-format=always; pre-flight-assumptions=triage+plan; plan-authoring=plan; ac-discipline=plan+build+review; tdd-and-verification=build+review+ship; commit-hygiene=build+ship; review-discipline=review; documentation-and-adrs=plan+ship; api-evolution=plan+review; refinement=triage+plan)", () => {
    expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(17);

    const fileNames = AUTO_TRIGGER_SKILLS.map((s) => s.fileName);
    expect(new Set(fileNames).size).toBe(fileNames.length);
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(skill.body.length).toBeGreaterThan(0);
      expect(skill.stages, `${skill.id} missing stages tag`).toBeDefined();
    }

    const known = new Set<AutoTriggerStage>([
      "triage", "plan", "build", "qa", "review", "ship", "compound", "always"
    ]);
    for (const skill of AUTO_TRIGGER_SKILLS) {
      for (const stage of skill.stages ?? []) {
        expect(known.has(stage), `${skill.id}: unknown stage ${stage}`).toBe(true);
      }
    }

    const stagesById = (id: string): ReadonlyArray<AutoTriggerStage> =>
      AUTO_TRIGGER_SKILLS.find((s) => s.id === id)!.stages ?? ["always"];

    const expected: Record<string, AutoTriggerStage[]> = {
      "triage-gate": ["triage"],
      "flow-resume": ["always"],
      "conversation-language": ["always"],
      "anti-slop": ["always"],
      "summary-format": ["always"],
      "pre-flight-assumptions": ["triage", "plan"],
      "plan-authoring": ["plan"],
      "ac-discipline": ["plan", "build", "review"],
      "tdd-and-verification": ["build", "review", "ship"],
      "commit-hygiene": ["build", "ship"],
      "review-discipline": ["review"],
      "documentation-and-adrs": ["plan", "ship"],
      "api-evolution": ["plan", "review"],
      "refinement": ["triage", "plan"]
    };
    for (const [id, want] of Object.entries(expected)) {
      expect(stagesById(id), `${id} stages drift`).toEqual(want);
    }
  });
});

describe("v8.19 skill-windowing behavior (buildAutoTriggerBlock filter + always-on inclusion + 20% token reduction)", () => {
  it("BEHAVIOR — buildAutoTriggerBlock() with no arg returns the legacy full block (all skills), with a stage filter returns the stage-tagged + always-tagged subset (verified for triage and review), always-on skills appear in every dispatch-stage block, unknown stage falls back to the full block, buildAutoTriggerBlockForStage matches buildAutoTriggerBlock, and every dispatch-stage block is ≥20% smaller than the legacy full block", () => {
    const fullBlock = buildAutoTriggerBlock();
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(fullBlock).toContain(`**${skill.id}**`);
    }

    // triage-stage filter
    const triageBlock = buildAutoTriggerBlock("triage");
    for (const s of ["**triage-gate**", "**pre-flight-assumptions**", "**flow-resume**", "**conversation-language**"]) {
      expect(triageBlock).toContain(s);
    }
    for (const s of ["**commit-hygiene**", "**review-discipline**", "**tdd-and-verification**", "**parallel-build**"]) {
      expect(triageBlock).not.toContain(s);
    }

    // review-stage filter
    const reviewBlock = buildAutoTriggerBlock("review");
    for (const s of ["**review-discipline**", "**ac-discipline**", "**tdd-and-verification**", "**anti-slop**"]) {
      expect(reviewBlock).toContain(s);
    }
    for (const s of ["**triage-gate**", "**plan-authoring**", "**pre-flight-assumptions**"]) {
      expect(reviewBlock).not.toContain(s);
    }

    // always-on skills appear in every dispatch stage block
    const alwaysSkills = AUTO_TRIGGER_SKILLS.filter((s) => (s.stages ?? []).includes("always"));
    expect(alwaysSkills.length).toBeGreaterThan(0);
    for (const stage of AUTO_TRIGGER_DISPATCH_STAGES) {
      const block = buildAutoTriggerBlock(stage);
      for (const skill of alwaysSkills) {
        expect(block, `${skill.id} should ride stage ${stage}`).toContain(`**${skill.id}**`);
      }
    }

    // unknown stage falls back
    // @ts-expect-error — exercising the JS-callable runtime fallback path.
    const fallback = buildAutoTriggerBlock("not-a-stage");
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(fallback).toContain(`**${skill.id}**`);
    }

    // alias
    expect(buildAutoTriggerBlockForStage("plan")).toBe(buildAutoTriggerBlock("plan"));

    // 20% reduction per dispatch stage
    const fullLength = fullBlock.length;
    for (const stage of AUTO_TRIGGER_DISPATCH_STAGES) {
      const stageBlock = buildAutoTriggerBlock(stage);
      const ratio = stageBlock.length / fullLength;
      expect(ratio, `stage ${stage} should be ≤ 80% of full`).toBeLessThanOrEqual(0.8);
      expect(stageBlock.length).toBeGreaterThan(50);
    }
  });
});

describe("v8.19 skill-windowing section contract (specialist prompts embed the right stage block)", () => {
  it("SECTION CONTRACT — architect prompt embeds `## Active skills (stage: `plan`)` and lists pre-flight-assumptions; reviewer prompt embeds the `review` stage block and excludes plan-only skills; builder prompt embeds the `build` stage block and excludes plan-only skills", () => {
    expect(ARCHITECT_PROMPT).toContain("## Active skills (stage: `plan`)");
    expect(ARCHITECT_PROMPT).toContain("**pre-flight-assumptions**");
    expect(REVIEWER_PROMPT).toContain("## Active skills (stage: `review`)");
    expect(REVIEWER_PROMPT).not.toContain("**plan-authoring**");
    expect(BUILDER_PROMPT).toContain("## Active skills (stage: `build`)");
    expect(BUILDER_PROMPT).not.toContain("**pre-flight-assumptions**");
  });
});
