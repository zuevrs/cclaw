import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RESEARCH_LENS_PROMPTS } from "../../src/content/research-lenses/index.js";
import { TRIAGE_PROMPT, REVIEWER_PROMPT } from "../../src/content/specialist-prompts/index.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";

/**
 * v8.70 — Founder/product-taste tier + design-quality reviewer axis.
 *
 * Tripwires:
 *   1. `research-product` lens prompt declares Founder mode firing on
 *      `deep-product` depth: premise challenge (right problem? actual
 *      outcome? what if we did nothing? inversion), strategic
 *      consequences (trajectory / identity / adoption / opportunity cost
 *      / compounding), 10-star reframing.
 *   2. `reviewer` prompt declares the gated `design-quality` axis with all
 *      seven dimensions (visual hierarchy / type system / color system /
 *      spacing rhythm / interaction affordances / accessibility (WCAG AA) /
 *      responsive behavior); below-6 grades become findings; explicit
 *      "what a 10 looks like" framing.
 *   3. `triage` prompt detects ui / design / frontend / ux surfaces and
 *      emits the new `Design surface:` line on the slim summary.
 *   4. Orchestrator (`start-command`) sets `walkDesignQualityAxis: true`
 *      on the reviewer dispatch envelope when the design-surface gate
 *      fires.
 *   5. Version bump: `package.json` ≥ 8.70.0 via `major === 8 && minor >=
 *      70` semver parse (forward-compat).
 *   6. CHANGELOG.md contains a v8.70 entry with founder-mode + design-
 *      quality framing.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const RESEARCH_PRODUCT_PROMPT = RESEARCH_LENS_PROMPTS["research-product"];

describe("v8.70 — research-product founder mode (deep-product depth)", () => {
  it("research-product mentions Founder mode and triggers on deep-product depth", () => {
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/Founder mode/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/deep-product/);
  });

  it("research-product premise challenge covers all four questions", () => {
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/Premise challenge/i);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/Right problem\?/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/Actual outcome\?/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/What if we did nothing\?/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/Inversion/);
  });

  it("research-product strategic consequences walks all five lenses", () => {
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/Strategic consequences/i);
    for (const lens of [
      "Trajectory",
      "Identity impact",
      "Adoption dynamics",
      "Opportunity cost",
      "Compounding direction"
    ]) {
      expect(
        RESEARCH_PRODUCT_PROMPT,
        `Strategic consequences must walk the ${lens} lens`
      ).toMatch(new RegExp(lens));
    }
  });

  it("research-product carries the 10-star reframing technique (gstack /plan-ceo-review)", () => {
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/10-star/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/reframing/i);
  });

  it("research-product findings block carries Premise challenge / Strategic consequences / 10-star sections (deep-product only)", () => {
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/### Premise challenge/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/### Strategic consequences/);
    expect(RESEARCH_PRODUCT_PROMPT).toMatch(/### 10-star reframing/);
  });

  it("research-product standard / light depths skip founder-mode sections (gating preserved)", () => {
    expect(
      RESEARCH_PRODUCT_PROMPT,
      "Standard depth must keep the existing five-section shape; founder mode is gated on deep-product"
    ).toMatch(/Skip section entirely on `light` and `standard` depths/);
  });
});

describe("v8.70 — reviewer design-quality axis (gated)", () => {
  it("reviewer prompt declares the design-quality axis", () => {
    expect(REVIEWER_PROMPT).toMatch(/design-quality/);
  });

  it("reviewer prompt covers all seven design dimensions", () => {
    for (const dimension of [
      "visual hierarchy",
      "type system",
      "color system",
      "spacing rhythm",
      "interaction affordances",
      "accessibility",
      "responsive behavior"
    ]) {
      expect(
        REVIEWER_PROMPT,
        `design-quality axis must cover the ${dimension} dimension`
      ).toMatch(new RegExp(dimension, "i"));
    }
  });

  it("reviewer mentions WCAG AA accessibility baseline", () => {
    expect(REVIEWER_PROMPT).toMatch(/WCAG AA/);
  });

  it("reviewer grades 0-10 with explicit 'what a 10 looks like' framing", () => {
    expect(REVIEWER_PROMPT).toMatch(/0-10/);
    expect(REVIEWER_PROMPT).toMatch(/what a 10 looks like/i);
  });

  it("reviewer escalates below-6 grades to findings", () => {
    expect(REVIEWER_PROMPT).toMatch(/[Bb]elow-6 grades become findings/);
  });

  it("reviewer carries the AI-slop check (gstack /plan-design-review pattern)", () => {
    expect(REVIEWER_PROMPT).toMatch(/AI-slop/i);
  });

  it("reviewer's design-quality axis is gated (skips on non-design slugs)", () => {
    expect(REVIEWER_PROMPT).toMatch(/design-quality.*gated/i);
    expect(REVIEWER_PROMPT).toMatch(/walkDesignQualityAxis/);
  });

  it("reviewer prompt mentions a multi-axis review count framing (eleven-axis pre-v8.84; twelve-axis v8.84+)", () => {
    // v8.84 added scope-drift; the count moved from eleven to twelve.
    // We accept either framing so the v8.70 tripwire doesn't relight
    // every time an axis is added or retired — the intent is to pin
    // that the reviewer carries an explicit count framing, not the
    // literal value.
    expect(REVIEWER_PROMPT).toMatch(/[Ee]leven-axis|11.axis|[Tt]welve-axis|12.axis/);
  });

  it("reviewer's design-quality axis activation reads triage.surfaces ∪ {ui, design, frontend, ux}", () => {
    expect(REVIEWER_PROMPT).toMatch(/ui.*design.*frontend.*ux|design.*frontend.*ux.*ui/);
  });
});

describe("v8.70 — triage detects design surfaces", () => {
  it("triage prompt has a Design surface detection section", () => {
    expect(TRIAGE_PROMPT).toMatch(/Design surface detection/i);
  });

  it("triage emits a Design surface line on the slim summary", () => {
    expect(TRIAGE_PROMPT).toMatch(/Design surface: <true \| false>/);
  });

  it("triage detects all four canonical design-surface keyword classes", () => {
    for (const keyword of ["design", "UI", "UX", "frontend"]) {
      expect(
        TRIAGE_PROMPT,
        `triage's design-surface detection must name '${keyword}' as a keyword class`
      ).toMatch(new RegExp(`\\b${keyword}\\b`));
    }
  });

  it("triage's design-surface detection includes responsive / a11y / accessibility cues", () => {
    expect(TRIAGE_PROMPT).toMatch(/responsive/i);
    expect(TRIAGE_PROMPT).toMatch(/accessibility|a11y/i);
  });

  it("triage's design-surface detection includes UI file extensions", () => {
    expect(TRIAGE_PROMPT).toMatch(/\.tsx/);
    expect(TRIAGE_PROMPT).toMatch(/\.css/);
  });

  it("triage docs that orchestrator persists triage.designSurface alongside the other fields", () => {
    expect(TRIAGE_PROMPT).toMatch(/triage\.designSurface/);
  });

  it("triage's design-surface detection is informational (does not gate the routing decision)", () => {
    expect(TRIAGE_PROMPT).toMatch(
      /flag is \*\*purely informational\*\*|design-surface flag.*purely informational|purely informational.*design/i
    );
  });

  it("triage's anti-rationalization table has a row for design-surface scoring", () => {
    expect(TRIAGE_PROMPT).toMatch(/design.surface|design_surface/i);
    expect(TRIAGE_PROMPT).toMatch(/false-negatives.*design|design.*false-positive/i);
  });
});

describe("v8.70 — orchestrator dispatch envelope (start-command)", () => {
  it("renderStartCommand() output is identical to START_COMMAND_BODY (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("orchestrator stamps walkDesignQualityAxis on reviewer dispatch when design-surface gate fires", () => {
    expect(START_COMMAND_BODY).toMatch(/walkDesignQualityAxis/);
  });

  it("orchestrator's design-quality activation reads triage.designSurface OR triage.surfaces ∩ {ui, design, frontend, ux}", () => {
    expect(START_COMMAND_BODY).toMatch(/triage\.designSurface/);
    expect(START_COMMAND_BODY).toMatch(/ui.*design.*frontend.*ux|design.*frontend.*ux.*ui/);
  });

  it("orchestrator's reviewer-stage axis-list mentions design-quality", () => {
    expect(START_COMMAND_BODY).toMatch(/eleven-axis/);
    expect(START_COMMAND_BODY).toMatch(/design-quality/);
  });
});

describe("v8.70 — version bump + CHANGELOG", () => {
  it("package.json version is 8.70.0 (or later) — uses major===8 && minor>=70 semver parse for forward-compat", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(body) as { version: string };
    const match = parsed.version.match(/^(\d+)\.(\d+)\./);
    expect(match, `package.json version '${parsed.version}' must follow major.minor.patch shape`).not.toBeNull();
    const [major, minor] = match!.slice(1).map((n) => Number.parseInt(n, 10));
    expect(major === 8 && minor >= 70, `package.json must be bumped to v8.70.0 or later (got ${parsed.version})`).toBe(
      true
    );
  });

  it("CHANGELOG.md contains a v8.70 (or later) entry with founder-mode + design-quality framing", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(
      body,
      "CHANGELOG must record the v8.70 founder-mode + design-quality entry"
    ).toMatch(/##\s*8\.(7[0-9]|[8-9]\d|\d{3,})\.0[^\n]*[Ff]ounder/);
    expect(body).toMatch(/design-quality/);
  });
});
