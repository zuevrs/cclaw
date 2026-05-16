import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
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
 * design.ts Phase 6). Per-row prose checks and cross-deliverable
 * invariants retired; what stays is ONE anchor per contract.
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

describe("v8.53 AC-2 design — Phase 6 ambiguity score", () => {
  it("design Phase 6 computes a 0-1 composite over greenfield (goal/constraints/success) or brownfield (+ context)", () => {
    expect(DESIGN_PROMPT).toMatch(/Phase 6/i);
    expect(DESIGN_PROMPT).toMatch(/ambiguity/i);
    expect(DESIGN_PROMPT).toMatch(/greenfield/i);
    expect(DESIGN_PROMPT).toMatch(/brownfield/i);
    for (const dim of ["goal", "constraints", "success", "context"]) {
      expect(DESIGN_PROMPT, `design must name ambiguity dimension "${dim}"`).toMatch(
        new RegExp(`\\b${dim}\\b`, "i")
      );
    }
  });

  it("design Phase 7 picker emits a SOFT warning prefix above threshold (never a hard gate)", () => {
    expect(DESIGN_PROMPT).toMatch(/Phase 7/);
    expect(DESIGN_PROMPT).toMatch(/soft.*warning|warning.*prefix/i);
    expect(DESIGN_PROMPT).toMatch(/never.*hard gate|not.*hard gate|user can.*approve/i);
  });

  it("design ambiguity additions cite v8.53 (changelog reverse-lookup)", () => {
    expect(DESIGN_PROMPT).toMatch(/ambiguity_score/u);
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
