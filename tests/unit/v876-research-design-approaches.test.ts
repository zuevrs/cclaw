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
 * v8.76 — research-design-lens + approaches-gate.
 *
 * Two adjacent research-mode deliverables landed together:
 *
 * 1. A 6th research lens (`research-design`) for UI / UX / positioning
 *    / affordances topics. Shares the seven-dimension design-quality
 *    rubric with the v8.75 plan-design specialist and the v8.70
 *    reviewer's design-quality axis (single source of truth at
 *    `src/content/design-quality-rubric.ts`). Dispatched on standard+
 *    depth when the orchestrator's design-signal heuristic fires, or
 *    when the user force-includes via `/cc research --lens=design`;
 *    force-excludeable via `--lens=-design`.
 *
 * 2. An Approaches Gate (research Phase 1.5) between the open-ended
 *    discovery dialogue and the parallel lens dispatch. The
 *    orchestrator surfaces 2-3 candidate framings of the research
 *    question and the user picks one or more (or accepts "all" — the
 *    default; every framing flows to every lens). The selected
 *    framings carry forward into every lens dispatch envelope under
 *    the new `Framing:` field.
 *
 * Tripwires below pin the v8.76 invariants so a future change that
 * drops the design lens, re-inlines the rubric, or silently un-wires
 * the Approaches Gate lights up immediately.
 */

describe("v8.76 — RESEARCH_LENSES roster grows to 6 (engineer / product / architecture / history / skeptic / design)", () => {
  it("AC-1 — RESEARCH_LENSES has exactly six entries", () => {
    expect(RESEARCH_LENSES).toHaveLength(6);
  });

  it("AC-1 — `research-design` is the 6th lens, immediately after `research-skeptic` in canonical order", () => {
    expect([...RESEARCH_LENSES]).toEqual([
      "research-engineer",
      "research-product",
      "research-architecture",
      "research-history",
      "research-skeptic",
      "research-design"
    ]);
  });

  it("AC-1 — RESEARCH_LENS_PROMPTS exposes a non-empty `research-design` prompt", () => {
    expect(typeof RESEARCH_LENS_PROMPTS["research-design"]).toBe("string");
    expect(RESEARCH_LENS_PROMPTS["research-design"].length).toBeGreaterThan(2000);
    expect(RESEARCH_LENS_PROMPTS["research-design"]).toBe(RESEARCH_DESIGN_PROMPT);
  });

  it("AC-1 — RESEARCH_LENS_TITLES contains a `Research — Design lens` entry (matches the `Research — <name> lens` shape of every sibling)", () => {
    expect(RESEARCH_LENS_TITLES["research-design"]).toBe("Research — Design lens");
  });

  it("AC-1 — RESEARCH_LENS_DESCRIPTIONS names the v8.76 lens + the shared seven-dimension rubric + the user-toggle flags (`--lens=design` / `--lens=-design`)", () => {
    const desc = RESEARCH_LENS_DESCRIPTIONS["research-design"];
    expect(desc.length).toBeGreaterThan(50);
    expect(desc).toContain("v8.76");
    expect(desc).toMatch(/seven-dimension|seven dimensions/u);
    expect(desc).toContain("--lens=design");
    expect(desc).toContain("--lens=-design");
  });

  it("AC-1 — every existing lens now references `research-design` as a sibling (the no-inter-lens-chatter test still holds the 5-of-6 sibling invariant)", () => {
    const others = RESEARCH_LENSES.filter((id) => id !== "research-design");
    for (const id of others) {
      expect(
        RESEARCH_LENS_PROMPTS[id],
        `${id} must reference its v8.76 sibling research-design in the parallel-dispatch preamble`
      ).toContain("research-design");
    }
  });
});

describe("v8.76 — research-design lens prompt body discipline (seven-dimension rubric + UI/UX scope)", () => {
  it("AC-2 — research-design declares itself a research-only sub-agent (NOT in SPECIALISTS)", () => {
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/research-only sub-agent/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/NOT\*?\*?\s+in the `SPECIALISTS`/u);
  });

  it("AC-2 — research-design embeds the SAME rendered rubric table the v8.75 plan-design + v8.70 reviewer use (single source of truth: edit `design-quality-rubric.ts` only)", () => {
    const renderedTable = renderDesignQualityRubricTable();
    expect(RESEARCH_DESIGN_PROMPT).toContain(renderedTable);
  });

  it("AC-2 — research-design embeds the SAME rendered AI-slop checklist the v8.75 plan-design + v8.70 reviewer use", () => {
    const renderedSlop = renderDesignQualityAiSlopChecklist();
    expect(RESEARCH_DESIGN_PROMPT).toContain(renderedSlop);
  });

  it("AC-2 — research-design names every one of the seven design-quality dimensions in its scope", () => {
    for (const dimension of DESIGN_QUALITY_DIMENSIONS) {
      expect(
        RESEARCH_DESIGN_PROMPT,
        `research-design must reference the ${dimension.name} dimension`
      ).toContain(dimension.name);
    }
  });

  it("AC-2 — research-design declares the four core scope sections (Design dimensions / Existing patterns / Anti-patterns / Open design questions)", () => {
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Design dimensions implicated/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Existing patterns to study/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Anti-patterns to avoid/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Open design questions/iu);
  });

  it("AC-2 — research-design declares the relevance grade (`load-bearing` / `relevant` / `tangential` / `out-of-scope`); grades for relevance, NOT for quality", () => {
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/load-bearing/u);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/relevant/u);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/tangential/u);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/out-of-scope/u);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/Grade for relevance, NOT for quality/iu);
  });

  it("AC-2 — research-design declares the first-class web-search dispatch (user-exa + user-context7)", () => {
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/first-class/iu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/user-exa/u);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/user-context7/u);
  });

  it("AC-2 — research-design distinguishes itself from plan-design (v8.75, pre-build) + reviewer's design-quality axis (v8.70, post-build) — three surfaces, same rubric", () => {
    expect(RESEARCH_DESIGN_PROMPT).toContain("plan-design");
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/v8\.75/u);
    expect(RESEARCH_DESIGN_PROMPT).toContain("reviewer");
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/v8\.70/u);
  });

  it("AC-2 — research-design names the `Framing:` envelope field (Phase 1.5 Approaches Gate handoff)", () => {
    expect(RESEARCH_DESIGN_PROMPT).toContain("Framing:");
    expect(RESEARCH_DESIGN_PROMPT).toContain("Approaches Gate");
  });

  it("AC-2 — research-design is skipped on `light` depth (narrow clarifications don't carry enough framing to ground a design pass)", () => {
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/light.{0,40}skip|skip.{0,40}light|NOT dispatched.{0,40}light|light depth/iu);
  });

  it("AC-2 — research-design declares the standard sub-agent contract sections (Sub-agent context / Role / Scope / Inputs / Outputs / Slim summary / Hard rules / Composition / Activation)", () => {
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Sub-agent context$/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Role$/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Scope/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Inputs/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Outputs/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Slim summary/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Hard rules$/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Composition$/mu);
    expect(RESEARCH_DESIGN_PROMPT).toMatch(/^## Activation$/mu);
  });

  it("AC-2 — research-design source file exists under src/content/research-lenses/", async () => {
    const lensFile = path.join(
      process.cwd(),
      "src",
      "content",
      "research-lenses",
      "research-design.ts"
    );
    await expect(fs.access(lensFile)).resolves.not.toThrow();
  });
});

describe("v8.76 — orchestrator surfaces the Approaches Gate (Phase 1.5) between Phase 1 dialogue and Phase 2 lens dispatch", () => {
  it("AC-3 — start-command body carries a `#### Phase 1.5 — approaches gate` section", () => {
    expect(START_COMMAND_BODY).toMatch(/#### Phase 1\.5 — approaches gate/u);
  });

  it("AC-3 — Approaches Gate names the 2-3 framings cap (not 1, not 5; mirrors obra Phase 2-3 + addyosmani idea-refine Phase 1.3)", () => {
    expect(START_COMMAND_BODY).toMatch(/2-3 (candidate )?FRAMINGS|2-3 framings/iu);
  });

  it("AC-3 — Approaches Gate names the user pick surface (one framing, multiple framings, or `all` default — every framing flows to every lens)", () => {
    const approachesIdx = START_COMMAND_BODY.indexOf("#### Phase 1.5 — approaches gate");
    expect(approachesIdx).toBeGreaterThan(0);
    const approachesBlock = START_COMMAND_BODY.slice(approachesIdx, approachesIdx + 6000);
    expect(approachesBlock).toMatch(/"all"|all.{0,40}every framing/iu);
    expect(approachesBlock).toMatch(/default/u);
  });

  it("AC-3 — Approaches Gate stamps `flow-state.json > approaches` (the candidate list) and `selectedApproaches` (the user's pick)", () => {
    const approachesIdx = START_COMMAND_BODY.indexOf("#### Phase 1.5 — approaches gate");
    const approachesBlock = START_COMMAND_BODY.slice(approachesIdx, approachesIdx + 6000);
    expect(approachesBlock).toContain("approaches");
    expect(approachesBlock).toContain("selectedApproaches");
  });

  it("AC-3 — Approaches Gate references the obra-superpowers brainstorming Phase 2-3 + addyosmani idea-refine Phase 1.3 reference patterns", () => {
    const approachesIdx = START_COMMAND_BODY.indexOf("#### Phase 1.5 — approaches gate");
    const approachesBlock = START_COMMAND_BODY.slice(approachesIdx, approachesIdx + 6000);
    expect(approachesBlock).toMatch(/obra/iu);
    expect(approachesBlock).toMatch(/(idea-refine|addyosmani)/iu);
  });

  it("AC-3 — Approaches Gate surfaces a concrete worked example (so the orchestrator can replicate the shape on dispatch)", () => {
    const approachesIdx = START_COMMAND_BODY.indexOf("#### Phase 1.5 — approaches gate");
    const approachesBlock = START_COMMAND_BODY.slice(approachesIdx, approachesIdx + 6000);
    expect(approachesBlock).toMatch(/(framing A|framing B|Worked example|caching|search)/iu);
  });

  it("AC-3 — Approaches Gate is wired to the v8.71 push-back machinery for mid-research re-framings (no separate revision verb)", () => {
    const approachesIdx = START_COMMAND_BODY.indexOf("#### Phase 1.5 — approaches gate");
    const approachesBlock = START_COMMAND_BODY.slice(approachesIdx, approachesIdx + 6000);
    expect(approachesBlock).toMatch(/push-back/u);
  });
});

describe("v8.76 — Phase 2 lens dispatch covers the new design lens + the `--lens=design` / `--lens=-design` user-toggle flags + the design-signal heuristic", () => {
  it("AC-4 — start-command body names `research-design` in the Phase 2 dispatch enumeration", () => {
    expect(START_COMMAND_BODY).toContain("research-design");
  });

  it("AC-4 — Phase 2 declares the `--lens=design` flag (force-include)", () => {
    expect(START_COMMAND_BODY).toContain("--lens=design");
  });

  it("AC-4 — Phase 2 declares the `--lens=-design` flag (force-exclude)", () => {
    expect(START_COMMAND_BODY).toContain("--lens=-design");
  });

  it("AC-4 — Phase 2 declares the design-signal detection heuristic (UI / UX / design / frontend / accessibility / a11y / page / component etc.)", () => {
    expect(START_COMMAND_BODY).toMatch(/Design-signal detection/u);
    expect(START_COMMAND_BODY).toMatch(/UI.*UX.*design|design.*UI.*UX/u);
  });

  it("AC-4 — Phase 2 documents the light-depth skip (design lens is NOT dispatched on light)", () => {
    const phase2Idx = START_COMMAND_BODY.indexOf("#### Phase 2 — parallel lens dispatch");
    expect(phase2Idx).toBeGreaterThan(0);
    const phase2Block = START_COMMAND_BODY.slice(phase2Idx, phase2Idx + 10000);
    expect(phase2Block).toMatch(/light.{0,50}NOT|light.{0,80}skip|skip.{0,80}light/iu);
  });

  it("AC-4 — Phase 2 envelope shape lists the new `Framing:` field (carries the Approaches-Gate selection forward)", () => {
    const phase2Idx = START_COMMAND_BODY.indexOf("#### Phase 2 — parallel lens dispatch");
    const phase2Block = START_COMMAND_BODY.slice(phase2Idx, phase2Idx + 10000);
    expect(phase2Block).toMatch(/`Framing:`|\\`Framing:\\`/u);
  });

  it("AC-4 — Phase 2 documents the standard / deep-product lens counts (5 default → 6 when design fires)", () => {
    const phase2Idx = START_COMMAND_BODY.indexOf("#### Phase 2 — parallel lens dispatch");
    const phase2Block = START_COMMAND_BODY.slice(phase2Idx, phase2Idx + 10000);
    expect(phase2Block).toMatch(/5 lenses|5 default|standard.{0,80}5|standard.{0,80}6|6 lenses/u);
  });

  it("AC-4 — Phase 2 dispatch sub-cases include `--lens=design` mutual-exclusion (`--lens=design` + `--lens=-design` last-wins) and the light-depth flag drop", () => {
    expect(START_COMMAND_BODY).toMatch(/--lens=design.{0,80}--lens=-design.{0,80}(last-wins|mutually exclusive)|mutually exclusive.{0,80}--lens=design.{0,80}--lens=-design/u);
    expect(START_COMMAND_BODY).toMatch(/--lens=design.{0,200}light/u);
  });

  it("AC-4 — final research-mode summary line states the v8.76 roster is six lenses (engineer / product / architecture / history / skeptic / design)", () => {
    expect(START_COMMAND_BODY).toMatch(/six.{0,80}(engineer|design)|6 lenses|engineer.{0,120}design/iu);
  });
});

describe("v8.76 — RESEARCH_TEMPLATE gains `## Framings considered` + `## research-design — Design dimensions`", () => {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;

  it("AC-5 — RESEARCH_TEMPLATE has `## Framings considered` section (above the per-lens sections)", () => {
    expect(tpl).toMatch(/^## Framings considered$/mu);
    const framingsIdx = tpl.indexOf("## Framings considered");
    const engineerIdx = tpl.indexOf("## Engineer lens");
    expect(framingsIdx).toBeGreaterThan(0);
    expect(engineerIdx).toBeGreaterThan(framingsIdx);
  });

  it("AC-5 — Framings considered section names the Phase 1.5 Approaches Gate + mirrors `flow-state.json > approaches` + `selectedApproaches`", () => {
    const framingsIdx = tpl.indexOf("## Framings considered");
    const framingsBlock = tpl.slice(framingsIdx, framingsIdx + 3000);
    expect(framingsBlock).toMatch(/Approaches Gate|Phase 1\.5/u);
    expect(framingsBlock).toContain("approaches");
    expect(framingsBlock).toContain("selectedApproaches");
  });

  it("AC-5 — RESEARCH_TEMPLATE has `## research-design — Design dimensions` section (between Skeptic lens and Synthesis)", () => {
    expect(tpl).toMatch(/^## research-design — Design dimensions$/mu);
    const skepticIdx = tpl.indexOf("## Skeptic lens");
    const designIdx = tpl.indexOf("## research-design — Design dimensions");
    const synthesisIdx = tpl.indexOf("## Synthesis");
    expect(skepticIdx).toBeGreaterThan(0);
    expect(designIdx).toBeGreaterThan(skepticIdx);
    expect(synthesisIdx).toBeGreaterThan(designIdx);
  });

  it("AC-5 — research-design template section grades all seven dimensions (load-bearing / relevant / tangential / out-of-scope)", () => {
    const designIdx = tpl.indexOf("## research-design — Design dimensions");
    const designBlock = tpl.slice(designIdx, designIdx + 5000);
    for (const dimension of DESIGN_QUALITY_DIMENSIONS) {
      expect(
        designBlock,
        `research-design template section must reference the ${dimension.name} dimension`
      ).toContain(dimension.name);
    }
    expect(designBlock).toContain("load-bearing");
    expect(designBlock).toContain("relevant");
    expect(designBlock).toContain("tangential");
    expect(designBlock).toContain("out-of-scope");
  });

  it("AC-5 — RESEARCH_TEMPLATE frontmatter declares the 6-lens roster including `design`", () => {
    expect(tpl).toMatch(/lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic,\s*design\]/u);
  });

  it("AC-5 — research-design template section is documented as conditional (omitted when the lens did NOT dispatch)", () => {
    const designIdx = tpl.indexOf("## research-design — Design dimensions");
    const designBlock = tpl.slice(designIdx, designIdx + 5000);
    expect(designBlock).toMatch(/(omitted|conditional|NOT dispatched|did not dispatch)/iu);
  });
});

describe("v8.76 — flow-state validators accept `approaches[]` + `selectedApproaches[]`", () => {
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

  it("AC-6 — assertFlowStateV82 accepts a state with `approaches[]` populated", () => {
    const approaches: ResearchApproach[] = [
      {
        id: "A",
        title: "Caching as infra primitive",
        summary: "Question: which substrate (Redis / in-memory / HTTP cache)."
      },
      {
        id: "B",
        title: "Caching as search-quality lever",
        summary: "Question: what we cache, how invalidation works."
      }
    ];
    const stateWith = { ...BASE_STATE, approaches };
    expect(() => assertFlowStateV82(stateWith)).not.toThrow();
  });

  it("AC-6 — assertFlowStateV82 accepts a state with both `approaches[]` and `selectedApproaches[]` populated", () => {
    const approaches: ResearchApproach[] = [
      { id: "A", title: "framing-A", summary: "framing A summary one-paragraph body" },
      { id: "B", title: "framing-B", summary: "framing B summary one-paragraph body" },
      { id: "C", title: "framing-C", summary: "framing C summary one-paragraph body" }
    ];
    const stateWith = { ...BASE_STATE, approaches, selectedApproaches: [0, 2] };
    expect(() => assertFlowStateV82(stateWith)).not.toThrow();
  });

  it("AC-6 — assertFlowStateV82 accepts the canonical `all`-selected case (selectedApproaches lists every index)", () => {
    const approaches: ResearchApproach[] = [
      { id: "A", title: "framing-A", summary: "first framing one-paragraph body" },
      { id: "B", title: "framing-B", summary: "second framing one-paragraph body" }
    ];
    const stateWith = { ...BASE_STATE, approaches, selectedApproaches: [0, 1] };
    expect(() => assertFlowStateV82(stateWith)).not.toThrow();
  });

  it("AC-6 — assertFlowStateV82 rejects `approaches[]` entries missing required fields", () => {
    const stateBad = {
      ...BASE_STATE,
      approaches: [{ id: "A", title: "", summary: "non-empty" }]
    };
    expect(() => assertFlowStateV82(stateBad)).toThrow(/approaches.*title|title.*non-empty/u);
  });

  it("AC-6 — assertFlowStateV82 rejects `selectedApproaches[]` indices that are out of bounds for the populated approaches array", () => {
    const stateBad = {
      ...BASE_STATE,
      approaches: [
        { id: "A", title: "framing-A", summary: "first framing summary one-paragraph" }
      ],
      selectedApproaches: [5]
    };
    expect(() => assertFlowStateV82(stateBad)).toThrow(/out of bounds|selectedApproaches/u);
  });

  it("AC-6 — assertFlowStateV82 rejects `selectedApproaches[]` non-integer entries", () => {
    const stateBad = {
      ...BASE_STATE,
      approaches: [
        { id: "A", title: "framing-A", summary: "first framing summary one-paragraph" }
      ],
      selectedApproaches: [0.5]
    };
    expect(() => assertFlowStateV82(stateBad)).toThrow(/non-negative integers|selectedApproaches/u);
  });

  it("AC-6 — pre-v8.76 state files (no approaches[]) validate unchanged (back-compat)", () => {
    expect(() => assertFlowStateV82(BASE_STATE)).not.toThrow();
  });
});

describe("v8.76 — RESEARCH_LENSES still NOT in SPECIALISTS / RESEARCH_AGENT_IDS (lenses are research-only)", () => {
  it("AC-7 — research-design is NOT in SPECIALISTS (the lens is research-only; flow specialists are at 9 after v8.77 added investigator)", async () => {
    const { SPECIALISTS } = await import("../../src/types.js");
    expect(SPECIALISTS as readonly string[]).not.toContain("research-design");
    expect(SPECIALISTS).toHaveLength(10);
  });

  it("AC-7 — research-design is NOT in RESEARCH_AGENT_IDS (those are read-only research helpers — repo-research / learnings-research)", async () => {
    const { RESEARCH_AGENT_IDS } = await import("../../src/types.js");
    expect(RESEARCH_AGENT_IDS as readonly string[]).not.toContain("research-design");
  });
});

describe("v8.76 — version bump + CHANGELOG", () => {
  it("AC-8 — package.json bumps to 8.76.0 (or later — v8.77 bumped to 8.77.0; this AC is satisfied by any v8.76+ version)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8")
    );
    const [major, minor] = pkg.version.split(".").map(Number);
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(76);
  });

  it("AC-8 — CHANGELOG.md carries a v8.76 entry", async () => {
    const changelog = await fs.readFile(
      path.join(process.cwd(), "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/##\s*\[?8\.76\.0\]?/);
  });
});
