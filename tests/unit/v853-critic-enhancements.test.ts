import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  DEFAULT_AMBIGUITY_THRESHOLD,
  ambiguityThresholdOf,
  type CclawConfig
} from "../../src/config.js";

/**
 * v8.53 — critic enhancements anchors (slimmed in v8.54).
 *
 * Two additive refinements (lens sweep in critic.ts §3; ambiguity score in
 * the architect's Compose phase). v8.62 unified flow: dead `design`
 * specialist's Phase 6 absorbed into `architect`'s Compose phase. Per-row
 * prose checks and cross-deliverable invariants retired; what stays is
 * ONE anchor per contract.
 */

describe("v8.53 AC-1 critic — Human-perspective lenses sub-section", () => {
  it("critic §3 declares the lens sub-section and ≥3-finding output contract gated to adversarial mode", () => {
    expect(CRITIC_PROMPT).toMatch(/###\s+Human-perspective lenses/u);
    expect(CRITIC_PROMPT).toMatch(/at least three|≥\s*3|>=\s*3/i);
    expect(CRITIC_PROMPT).toMatch(/adversarial/i);
  });

  it("critic lists the six concrete reader-shoes (3 plan-stage + 3 code-stage)", () => {
    for (const lens of ["executor", "stakeholder", "skeptic", "security", "new-hire", "ops"]) {
      expect(CRITIC_PROMPT, `critic must name lens "${lens}"`).toMatch(new RegExp(`\\b${lens}\\b`, "i"));
    }
  });

  it("critic credits OMC as the source pattern and cites v8.53 for changelog reverse-lookup", () => {
    expect(CRITIC_PROMPT).toMatch(/OMC/u);
    expect(CRITIC_PROMPT).toMatch(/Human-perspective lenses/u);
  });
});

describe("v8.53 AC-2 ambiguity score — template-level surface retained (v8.62 unified flow: dead `design`'s Phase 6 procedural lock retired with the specialist; only the artifact template's `ambiguity_score` / `ambiguity_dimensions` / `ambiguity_threshold` frontmatter fields persist for downstream gating compatibility)", () => {
  it("plan template frontmatter still declares the three ambiguity fields (back-compat surface for the v8.53 brownfield gates)", () => {
    const planTpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!.body;
    expect(planTpl).toMatch(/ambiguity_score:/);
    expect(planTpl).toMatch(/ambiguity_dimensions:/);
    expect(planTpl).toMatch(/ambiguity_threshold:/);
  });

  it("research template frontmatter still declares the ambiguity fields (research mode reuses the gate)", () => {
    const researchTpl = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;
    expect(researchTpl).toMatch(/ambiguity_score:/);
  });

  it("v8.62 — the procedural ambiguity-score authoring beat (the v8.53 design Phase 6 / Phase 7 picker) is GONE from the architect; the unified-flow architect runs silently with no mid-plan dialogue, and the field stays null unless a future surface re-introduces it", () => {
    // v8.62 retired the Phase 7 picker entirely (v8.61 always-auto
    // removed mid-plan dialogue; v8.62 collapsed the design specialist
    // into the architect). The procedural authoring lock for
    // ambiguity_score was specific to design's Phase 6 + Phase 7 picker
    // and does not survive the unified-flow collapse. The architect
    // does NOT carry the ambiguity-score computation; if any future
    // slug needs the field populated it does so via an explicit
    // template author pass, not via the architect's silent dispatch.
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7 — Sign-off/);
    expect(ARCHITECT_PROMPT).not.toMatch(/`approve` \/ `request-changes` \/ `reject`/);
  });
});

describe("v8.53 AC-2 config — ambiguity threshold", () => {
  it("DEFAULT_AMBIGUITY_THRESHOLD is 0.2 (the v8.53 default)", () => {
    expect(DEFAULT_AMBIGUITY_THRESHOLD).toBe(0.2);
  });

  it("ambiguityThresholdOf returns the config-supplied value when set, else the default", () => {
    expect(ambiguityThresholdOf({} as CclawConfig)).toBe(DEFAULT_AMBIGUITY_THRESHOLD);
    expect(
      ambiguityThresholdOf({ design: { ambiguity_threshold: 0.5 } } as CclawConfig)
    ).toBe(0.5);
  });

  it("ambiguityThresholdOf rejects out-of-range values by falling back to the default", () => {
    expect(
      ambiguityThresholdOf({ design: { ambiguity_threshold: 1.5 } } as CclawConfig)
    ).toBe(DEFAULT_AMBIGUITY_THRESHOLD);
    expect(
      ambiguityThresholdOf({ design: { ambiguity_threshold: -0.1 } } as CclawConfig)
    ).toBe(DEFAULT_AMBIGUITY_THRESHOLD);
  });
});

describe("v8.53 AC-2 plan.md template — ambiguity frontmatter", () => {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan");
  const fmMatch = tpl?.body.match(/^---\n([\s\S]+?)\n---/m);
  const frontmatter = fmMatch ? YAML.parse(fmMatch[1]) : null;

  it("plan template includes ambiguity fields in frontmatter (composite + per-dim + threshold)", () => {
    expect(frontmatter).toBeTruthy();
    expect(tpl!.body).toMatch(/ambiguity/i);
    expect(tpl!.body).toMatch(/threshold/i);
  });
});

describe("v8.53 anti-rationalization rows — lens dodges", () => {
  it("critic anti-rationalization table calls out skipping or rubber-stamping lenses", () => {
    expect(CRITIC_PROMPT).toMatch(/anti-rationalization/i);
    expect(CRITIC_PROMPT).toMatch(/lens/i);
  });
});
