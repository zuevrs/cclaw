import { describe, expect, it } from "vitest";
import {
  RESEARCH_LENS_DESCRIPTIONS,
  RESEARCH_LENS_PROMPTS,
  RESEARCH_LENS_TITLES
} from "../../src/content/research-lenses/index.js";
import { RESEARCH_LENSES, type ResearchLensId } from "../../src/types.js";

/**
 * v8.65 / v8.76 — research-only sub-agent lens prompts. Slimmed in v8.99
 * test-slim-down A2: one cross-cutting registry test + one per-lens
 * "name + lens-id + canonical contract" assertion per lens (the canonical
 * lens-output contract every lens must declare) + a small number of
 * independence / web-search invariants the orchestrator relies on.
 */

const LENS_IDS: readonly ResearchLensId[] = RESEARCH_LENSES;

describe("v8.65 research lenses — registry surfaces", () => {
  it("RESEARCH_LENS_{PROMPTS,TITLES,DESCRIPTIONS} are all keyed by RESEARCH_LENSES (6 lens entries each)", () => {
    const expected = [...LENS_IDS].sort();
    expect(Object.keys(RESEARCH_LENS_PROMPTS).sort()).toEqual(expected);
    expect(Object.keys(RESEARCH_LENS_TITLES).sort()).toEqual(expected);
    expect(Object.keys(RESEARCH_LENS_DESCRIPTIONS).sort()).toEqual(expected);
    for (const id of LENS_IDS) {
      expect(RESEARCH_LENS_TITLES[id]).toMatch(/^Research — /u);
      expect(RESEARCH_LENS_DESCRIPTIONS[id].length).toBeGreaterThan(20);
    }
  });
});

describe("v8.65 research lenses — per-lens name + lens-id + canonical contract", () => {
  for (const id of LENS_IDS) {
    it(`${id}: prompt opens with H1 matching lens-id, declares it is in the RESEARCH_LENSES set, and contains the canonical lens-output contract sections`, () => {
      expect(LENS_IDS).toContain(id);
      const prompt = RESEARCH_LENS_PROMPTS[id];
      expect(prompt).toMatch(new RegExp(`^# ${id}\\b`, "u"));
      expect(prompt).toMatch(/research-only sub-agent/iu);
      expect(prompt).toMatch(/^## Role$/mu);
      expect(prompt).toMatch(/^## Outputs/mu);
      expect(prompt).toMatch(/^## Slim summary/mu);
      expect(prompt).toMatch(/^## Composition$/mu);
      expect(prompt).toMatch(/^## Activation$/mu);
      expect(prompt).toMatch(/Findings:/u);
    });
  }
});

describe("v8.65 research lenses — independence + web-search fallback", () => {
  it("every lens declares the no-inter-lens-chatter rule (cross-lens synthesis is the orchestrator's job)", () => {
    for (const id of LENS_IDS) {
      const prompt = RESEARCH_LENS_PROMPTS[id];
      expect(
        prompt,
        `${id} must declare the no-inter-lens-chatter rule`
      ).toMatch(/(No inter-lens chatter|do NOT cite or reference[\s\S]{0,200}lens(es)?)/iu);
    }
  });

  it("research-engineer + research-architecture may dispatch `repo-research` (brownfield helper)", () => {
    expect(RESEARCH_LENS_PROMPTS["research-engineer"]).toMatch(/dispatch `repo-research`|`repo-research` helper/u);
    expect(RESEARCH_LENS_PROMPTS["research-architecture"]).toMatch(/dispatch `repo-research`|`repo-research` helper/u);
  });

  it("each lens (except memory-only research-history) mentions optional web-search MCP fallback", () => {
    for (const id of ["research-engineer", "research-product", "research-architecture", "research-skeptic"] as const) {
      const prompt = RESEARCH_LENS_PROMPTS[id];
      expect(prompt).toMatch(/web[- ]search|web-search MCP|user-exa|MCP/iu);
      expect(prompt).toMatch(/fall back|training knowledge|optional|when one is available|when available/iu);
    }
  });
});
