import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESIGN_QUALITY_DIMENSIONS,
  renderDesignQualityAiSlopChecklist,
  renderDesignQualityRubricTable
} from "../../src/content/design-quality-rubric.js";
import {
  RESEARCH_DESIGN_PROMPT,
  RESEARCH_LENS_DESCRIPTIONS,
  RESEARCH_LENS_PROMPTS,
  RESEARCH_LENS_TITLES
} from "../../src/content/research-lenses/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { RESEARCH_LENSES, type ResearchApproach } from "../../src/types.js";
import {
  FLOW_STATE_SCHEMA_VERSION,
  assertFlowStateV82,
  type FlowState
} from "../../src/flow-state.js";

/**
 * v8.76 — research-design-lens + approaches-gate. Slimmed in v8.99
 * test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT
 * test covering the v8.76 6th lens + the Approaches Gate handoff into
 * flow-state.
 */

describe("v8.76 — research-design-lens + approaches-gate wiring", () => {
  it("WIRING — RESEARCH_LENSES grows to 6 (research-design 6th in canonical order), exposes prompt/title/description with the v8.76 marker + user-toggle flags + shared rubric, and assertFlowStateV82 accepts approaches[] + selectedApproaches[] (rejects bad titles + out-of-bounds + non-integer indices); research-design stays out of SPECIALISTS + RESEARCH_AGENT_IDS", async () => {
    // Roster shape
    expect(RESEARCH_LENSES).toHaveLength(6);
    expect([...RESEARCH_LENSES]).toEqual([
      "research-engineer",
      "research-product",
      "research-architecture",
      "research-history",
      "research-skeptic",
      "research-design"
    ]);
    expect(RESEARCH_LENS_PROMPTS["research-design"]).toBe(RESEARCH_DESIGN_PROMPT);
    expect(RESEARCH_LENS_PROMPTS["research-design"].length).toBeGreaterThan(2000);
    expect(RESEARCH_LENS_TITLES["research-design"]).toBe("Research — Design lens");
    const desc = RESEARCH_LENS_DESCRIPTIONS["research-design"];
    expect(desc).toContain("v8.76");
    expect(desc).toMatch(/seven-dimension|seven dimensions/u);
    expect(desc).toContain("--lens=design");
    expect(desc).toContain("--lens=-design");
    for (const id of RESEARCH_LENSES.filter((l) => l !== "research-design")) {
      expect(RESEARCH_LENS_PROMPTS[id]).toContain("research-design");
    }

    // research-design source file is on disk
    await expect(
      fs.access(path.join(process.cwd(), "src", "content", "research-lenses", "research-design.ts"))
    ).resolves.not.toThrow();

    // flow-state validators accept approaches[] / selectedApproaches[]; reject bad shapes
    const BASE_STATE: FlowState = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "20260517-research-redis-cache",
      currentStage: "plan",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-17T12:00:00Z",
      triage: {
        complexity: "large-risky",
        ceremonyMode: "strict",
        path: ["plan"],
        mode: "research",
        rationale: "research-mode entry point",
        decidedAt: "2026-05-17T12:00:00Z",
        runMode: null,
        research_depth: "standard"
      },
      reviewIterations: 0,
      securityFlag: false
    };
    const approaches: ResearchApproach[] = [
      { id: "A", title: "Caching as infra primitive", summary: "summary one-paragraph body" },
      { id: "B", title: "Caching as search-quality lever", summary: "summary one-paragraph body" }
    ];
    expect(() => assertFlowStateV82({ ...BASE_STATE, approaches })).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...BASE_STATE, approaches, selectedApproaches: [0, 1] })
    ).not.toThrow();
    expect(() => assertFlowStateV82(BASE_STATE)).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...BASE_STATE,
        approaches: [{ id: "A", title: "", summary: "non-empty" }]
      })
    ).toThrow(/approaches.*title|title.*non-empty/u);
    expect(() =>
      assertFlowStateV82({ ...BASE_STATE, approaches, selectedApproaches: [5] })
    ).toThrow(/out of bounds|selectedApproaches/u);
    expect(() =>
      assertFlowStateV82({ ...BASE_STATE, approaches, selectedApproaches: [0.5] })
    ).toThrow(/non-negative integers|selectedApproaches/u);

    // research-design stays out of SPECIALISTS + RESEARCH_AGENT_IDS
    const { SPECIALISTS, RESEARCH_AGENT_IDS } = await import("../../src/types.js");
    expect(SPECIALISTS as readonly string[]).not.toContain("research-design");
    expect(RESEARCH_AGENT_IDS as readonly string[]).not.toContain("research-design");
  });
});

describe("v8.76 — research-design-lens + approaches-gate behavior (orchestrator dispatch)", () => {
  it("BEHAVIOR — start-command body wires (a) Phase 1.5 Approaches Gate with 2-3 framings cap + `all` default + flow-state.approaches/selectedApproaches stamp + push-back loop + reference patterns (obra / idea-refine), and (b) Phase 2 dispatch of research-design with `--lens=design` / `--lens=-design` toggles + mutual-exclusion last-wins + light-depth skip + `Framing:` envelope + design-signal detection. v8.103 — Phase 1.5 + Phase 2 detail moved to runbooks/research-mode.md; start-command keeps the one-paragraph research-mode pointer.", async () => {
    const { ON_DEMAND_RUNBOOKS } = await import("../../src/content/runbooks-on-demand.js");
    const researchMode = ON_DEMAND_RUNBOOKS.find((r) => r.id === "research-mode")?.body ?? "";

    // Phase 1.5 — approaches gate (v8.103 lift)
    expect(researchMode).toMatch(/Phase 1\.5.*?approaches gate/iu);
    const approachesIdx = researchMode.search(/Phase 1\.5.*?approaches gate/iu);
    expect(approachesIdx).toBeGreaterThan(0);
    const approachesBlock = researchMode.slice(approachesIdx, approachesIdx + 6000);
    expect(approachesBlock).toMatch(/2-3 (candidate )?FRAMINGS|2-3 framings/iu);
    expect(approachesBlock).toMatch(/"all"|all.{0,40}every framing/iu);
    expect(approachesBlock).toMatch(/default/u);
    expect(approachesBlock).toContain("approaches");
    expect(approachesBlock).toContain("selectedApproaches");
    expect(approachesBlock).toMatch(/obra/iu);
    expect(approachesBlock).toMatch(/(idea-refine|addyosmani)/iu);
    expect(approachesBlock).toMatch(/push-back/u);

    // Phase 2 dispatch (v8.103 lift)
    expect(researchMode).toContain("research-design");
    expect(researchMode).toContain("--lens=design");
    expect(researchMode).toContain("--lens=-design");
    expect(researchMode).toMatch(/Design-signal detection/u);
    expect(researchMode).toMatch(
      /--lens=design.{0,80}--lens=-design.{0,80}(last-wins|mutually exclusive)|mutually exclusive.{0,80}--lens=design.{0,80}--lens=-design/u
    );
    const phase2Idx = researchMode.search(/Phase 2.*?parallel lens dispatch/iu);
    expect(phase2Idx).toBeGreaterThan(0);
    const phase2Block = researchMode.slice(phase2Idx, phase2Idx + 10000);
    expect(phase2Block).toMatch(/`Framing:`|\\`Framing:\\`/u);
    expect(phase2Block).toMatch(/light.{0,50}NOT|light.{0,80}skip|skip.{0,80}light/iu);
    expect(phase2Block).toMatch(/5 lenses|5 default|standard.{0,80}5|standard.{0,80}6|6 lenses/u);
    expect(researchMode).toMatch(/six.{0,80}(engineer|design)|6 lenses|engineer.{0,120}design/iu);
  });
});

describe("v8.76 — research-design-lens + approaches-gate section contract (prompt + research template)", () => {
  it("SECTION CONTRACT — RESEARCH_DESIGN_PROMPT embeds the shared rubric table + AI-slop checklist (single source of truth), names every one of the seven design dimensions + the relevance grades + first-class web-search dispatch + Framing handoff + standard sub-agent contract sections (Sub-agent context / Role / Scope / Inputs / Outputs / Slim summary / Hard rules / Composition / Activation); RESEARCH_TEMPLATE gains `## Framings considered` + `## research-design — Design dimensions` (between Skeptic and Synthesis) + 6-lens frontmatter roster", () => {
    // research-design prompt
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/research-only sub-agent/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/NOT\*?\*?\s+in the `SPECIALISTS`/u);
    expect(RESEARCH_DESIGN_PROMPT).toContain(renderDesignQualityRubricTable());
    expect(RESEARCH_DESIGN_PROMPT).toContain(renderDesignQualityAiSlopChecklist());
    for (const dim of DESIGN_QUALITY_DIMENSIONS) {
      expect(RESEARCH_DESIGN_PROMPT).toContain(dim.name);
    }
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Design dimensions implicated/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Existing patterns to study/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Anti-patterns to avoid/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Open design questions/iu);
    for (const grade of ["load-bearing", "relevant", "tangential", "out-of-scope"]) {
      expect(RESEARCH_DESIGN_PROMPT).toContain(grade);
    }
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Grade for relevance, NOT for quality/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/first-class/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/user-exa/u);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/user-context7/u);
    expect(RESEARCH_DESIGN_PROMPT).toContain("Framing:");
    expect(RESEARCH_DESIGN_PROMPT).toContain("Approaches Gate");
    for (const section of [
      /^## Sub-agent context$/mu,
      /^## Role$/mu,
      /^## Scope/mu,
      /^## Inputs/mu,
      /^## Outputs/mu,
      /^## Slim summary/mu,
      /^## Hard rules$/mu,
      /^## Composition$/mu,
      /^## Activation$/mu
    ]) {
      expect(RESEARCH_DESIGN_PROMPT).toMatch(section);
    }

    // RESEARCH_TEMPLATE
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;
    expect(tpl).toMatch(/^## Framings considered$/mu);
    const framingsIdx = tpl.indexOf("## Framings considered");
    const engineerIdx = tpl.indexOf("## Engineer lens");
    const skepticIdx = tpl.indexOf("## Skeptic lens");
    const designIdx = tpl.indexOf("## research-design — Design dimensions");
    const synthesisIdx = tpl.indexOf("## Synthesis");
    expect(engineerIdx).toBeGreaterThan(framingsIdx);
    expect(designIdx).toBeGreaterThan(skepticIdx);
    expect(synthesisIdx).toBeGreaterThan(designIdx);
    const framingsBlock = tpl.slice(framingsIdx, framingsIdx + 3000);
    expect(framingsBlock).toMatch(/Approaches Gate|Phase 1\.5/u);
    expect(framingsBlock).toContain("approaches");
    expect(framingsBlock).toContain("selectedApproaches");
    const designBlock = tpl.slice(designIdx, designIdx + 5000);
    for (const dim of DESIGN_QUALITY_DIMENSIONS) {
      expect(designBlock).toContain(dim.name);
    }
    for (const grade of ["load-bearing", "relevant", "tangential", "out-of-scope"]) {
      expect(designBlock).toContain(grade);
    }
    expect(designBlock).toMatch(/(omitted|conditional|NOT dispatched|did not dispatch)/iu);
    expect(tpl).toMatch(
      /lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic,\s*design\]/u
    );
  });
});
