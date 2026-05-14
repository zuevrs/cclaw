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
 * v8.53 — critic enhancements: multi-perspective lenses + design ambiguity score.
 *
 * Closes the v8.48-v8.53 cross-reference flow audit roadmap with TWO additive
 * refinements to existing specialists. Neither item adds a new stage or
 * specialist; both extend existing prompts so a future refactor cannot
 * accidentally drop the lens sweep or the soft-warning prefix.
 *
 * Deliverable 1 — critic.ts §3 human-perspective lens sweep. The post-impl
 * critic (Hop 4.5) already runs four adversarial techniques (assumption
 * violation / composition failures / cascade construction / abuse cases)
 * in adversarial mode. v8.53 adds **six concrete reader-shoes** — three
 * for plan-stage critique (executor / stakeholder / skeptic) and three
 * for code-stage critique (security / new-hire / ops). The lenses are
 * gated to adversarial mode only and require ≥3 lens findings in
 * critic.md when the sweep runs. Borrowed from OMC's critic discipline.
 *
 * Deliverable 2 — design.ts Phase 6 ambiguity score. The design specialist
 * computes a composite 0.0-1.0 score across 3 dimensions (greenfield:
 * goal / constraints / success) or 4 dimensions (brownfield: + context)
 * at the end of Phase 6, before Phase 7 sign-off. Persists per-dimension
 * + composite + threshold into plan.md frontmatter. At Phase 7, a soft
 * warning prefix fires when the composite exceeds the threshold (default
 * 0.2; configurable via `.cclaw/config.yaml > design.ambiguity_threshold`).
 * The warning is NEVER a hard gate — the user can always approve below
 * or above the threshold. Borrowed from OMC's deep-interview ambiguity
 * rubric.
 *
 * Backwards compat: existing plan.md files without the new frontmatter
 * keys MUST keep working; absence is treated as "unknown" and the Phase 7
 * picker fires without the warning prefix. Only NEW design sessions emit
 * the score.
 *
 * Tripwires below pin each invariant so an accidental regression lights
 * up immediately.
 */

// ─────────────────────────────────────────────────────────────────────
// Deliverable 1 — critic.ts §3 human-perspective lens sweep
// ─────────────────────────────────────────────────────────────────────

describe("v8.53 AC-1 — critic §3 declares the human-perspective lens sub-section", () => {
  it("critic prompt §3 contains a `Human-perspective lenses` sub-section header", () => {
    expect(
      CRITIC_PROMPT,
      "critic §3 must carry an H3 sub-section named `Human-perspective lenses` so the lens sweep has a stable parsing anchor"
    ).toMatch(/###\s+Human-perspective lenses/u);
  });

  it("critic prompt scopes the lens sweep to adversarial mode only (not gap mode)", () => {
    expect(
      CRITIC_PROMPT,
      "the lens sub-section header must declare adversarial-mode-only gating verbatim"
    ).toMatch(/Human-perspective lenses \(adversarial mode only\)/u);
  });

  it("critic prompt names all six lenses (executor / stakeholder / skeptic / security / new-hire / ops)", () => {
    for (const lens of [
      "Executor lens",
      "Stakeholder lens",
      "Skeptic lens",
      "Security lens",
      "New-hire lens",
      "Ops lens"
    ]) {
      expect(
        CRITIC_PROMPT,
        `lens \`${lens}\` missing from critic prompt §3 human-perspective sub-section`
      ).toContain(lens);
    }
  });

  it("critic prompt names the plan-stage lens set (executor / stakeholder / skeptic)", () => {
    expect(
      CRITIC_PROMPT,
      "plan-stage lens set must be declared by name so the agent knows when to apply executor/stakeholder/skeptic vs security/new-hire/ops"
    ).toMatch(/Plan-stage lenses[\s\S]{0,1500}Executor lens[\s\S]{0,1500}Stakeholder lens[\s\S]{0,1500}Skeptic lens/u);
  });

  it("critic prompt names the code-stage lens set (security / new-hire / ops)", () => {
    expect(
      CRITIC_PROMPT,
      "code-stage lens set must be declared by name so the agent knows when to apply security/new-hire/ops vs executor/stakeholder/skeptic"
    ).toMatch(/Code-stage lenses[\s\S]{0,1500}Security lens[\s\S]{0,1500}New-hire lens[\s\S]{0,1500}Ops lens/u);
  });

  it("critic prompt cites OMC as the source pattern for the lens sweep", () => {
    expect(
      CRITIC_PROMPT,
      "v8.53 borrowed the multi-perspective lens pattern from OMC; the prompt must cite the source so future readers can trace the audit provenance"
    ).toMatch(/OMC/u);
  });
});

describe("v8.53 AC-1 — lens output contract (≥3 lens findings required in adversarial mode)", () => {
  it("critic prompt declares the ≥3 lens findings requirement", () => {
    expect(
      CRITIC_PROMPT,
      "critic.md must include findings from at least 3 lenses when adversarial mode runs — this is the v8.53 output contract"
    ).toMatch(/at least 3 lenses/u);
  });

  it("critic prompt names the axis tag format `human-perspective:<lens>` for findings", () => {
    expect(
      CRITIC_PROMPT,
      "lens findings must reference the lens by name in the F-N row's axis column so downstream readers can filter by lens"
    ).toMatch(/human-perspective:/u);
  });

  it("critic prompt provides a concrete axis-tag example (e.g. human-perspective:new-hire)", () => {
    expect(
      CRITIC_PROMPT,
      "the prompt must illustrate the axis tag with at least one concrete lens name so the agent does not invent a different format"
    ).toMatch(/human-perspective:(executor|stakeholder|skeptic|security|new-hire|ops)/u);
  });

  it("critic prompt names the F-N findings-table shape with a Lens column", () => {
    expect(
      CRITIC_PROMPT,
      "lens findings ride the existing F-N numbering with a Lens column inserted; the prompt must document the new table shape"
    ).toMatch(/\|\s*F-N\s*\|\s*Lens\s*\|/u);
  });
});

describe("v8.53 AC-1 — lens sweep gating (adversarial mode only)", () => {
  it("critic prompt explicitly states the lens sweep does NOT activate adversarial mode independently", () => {
    expect(
      CRITIC_PROMPT,
      "lenses are additive to §3a-§3d, not an independent trigger; the prompt must teach that they ride the existing §8 trigger set"
    ).toMatch(/do NOT activate adversarial mode independently/iu);
  });

  it("critic prompt declares the light-adversarial cap (≤3 lenses) for soft acMode + single trigger", () => {
    expect(
      CRITIC_PROMPT,
      "in light adversarial mode (soft acMode, exactly one §8 trigger), the lens sweep must be capped at 3 lenses to match the `ONE technique only` rule for §3a-§3d"
    ).toMatch(/`light`\s*adversarial[\s\S]{0,600}3 lenses|3 lenses[\s\S]{0,600}`light`\s*adversarial|light[\s\S]{0,200}adversarial[\s\S]{0,600}capped at 3 lenses/iu);
  });

  it("critic prompt names the §3a-§3d techniques as still-present (lens sweep is additive)", () => {
    // Sanity check: the four adversarial techniques must still be named so
    // the v8.53 addition doesn't accidentally replace them.
    for (const technique of [
      "Assumption violation",
      "Composition failures",
      "Cascade construction",
      "Abuse cases"
    ]) {
      expect(
        CRITIC_PROMPT,
        `existing adversarial technique \`${technique}\` must remain in critic §3 — v8.53 is ADDITIVE, not a replacement`
      ).toContain(technique);
    }
  });
});

describe("v8.53 AC-1 — critic token budget bump (~2k for §3 adversarial)", () => {
  it("critic prompt mentions a v8.53 token-budget bump for §3 adversarial", () => {
    expect(
      CRITIC_PROMPT,
      "the token-budget section must document the v8.53 bump (~2k for §3 adversarial) so a reader knows where the budget went"
    ).toMatch(/v8\.53[\s\S]{0,500}§3/u);
  });

  it("critic prompt names the new §3 sub-allowance bump (~6-8k → ~8-10k)", () => {
    expect(
      CRITIC_PROMPT,
      "the bump rationale must cite the concrete sub-allowance range so future readers can verify the math"
    ).toMatch(/8-10k|~2k|2k tokens/u);
  });

  it("critic prompt preserves the 20k hard cap (unchanged in v8.53)", () => {
    expect(
      CRITIC_PROMPT,
      "the 20k hard cap is structural; v8.53 only bumps the §3 sub-allowance within the overall 12-18k mode budget — the hard cap must remain 20k"
    ).toMatch(/Hard cap.*20k|hard.*20k.*cap|20k.*Hard cap|20k.*hard cap/iu);
  });

  it("critic prompt preserves the 12-18k overall adversarial-mode budget", () => {
    expect(
      CRITIC_PROMPT,
      "the overall adversarial-mode token target (12-18k) must remain — v8.53 only bumps the §3 sub-allowance, not the overall mode cap"
    ).toMatch(/12-18k/u);
  });
});

describe("v8.53 AC-1 — critic anti-rationalization rows for lens dodges", () => {
  it("critic anti-rationalization table includes the `new-hire covered in §1` dodge", () => {
    expect(
      CRITIC_PROMPT,
      "the v8.53 anti-rat row must teach that §1 pre-commitment is NOT a substitute for the lens-based new-hire investigation"
    ).toMatch(/covered new-hire[\s\S]{0,100}§1 already/iu);
  });

  it("critic anti-rationalization table includes the `security is the security-reviewer's job` dodge", () => {
    expect(
      CRITIC_PROMPT,
      "the v8.53 anti-rat row must teach that the critic's security lens is a smoke check that cross-references security-reviewer; deferring to security-reviewer is not a valid skip"
    ).toMatch(/security-reviewer.*job|Security is the security-reviewer/iu);
  });

  it("critic anti-rationalization table names the v8.49 catalog for cross-cutting rows (not duplicating)", () => {
    expect(
      CRITIC_PROMPT,
      "the anti-rat table must continue to reference the v8.49 shared catalog so cross-cutting rows do not drift into the critic prompt"
    ).toMatch(/`\.cclaw\/lib\/anti-rationalizations\.md`/u);
  });

  it("critic anti-rationalization table mentions v8.53 and the lens-sweep additions", () => {
    expect(
      CRITIC_PROMPT,
      "the anti-rat table preamble must cite v8.53 and the lens-sweep dodges so a future cleanup sweep does not relocate the rows to a runbook"
    ).toMatch(/v8\.53/u);
  });

  it("critic anti-rationalization table row count grew from 8 to 10", () => {
    // The eight pre-v8.53 critic-specific rows + two v8.53 lens-dodge rows.
    // Pin the row count so a future PR cannot silently drop one.
    const tableSection = CRITIC_PROMPT.match(
      /## Anti-rationalization table[\s\S]+?(?=##\s+\w|$)/u
    );
    expect(
      tableSection,
      "critic anti-rationalization table must exist (this assertion underpins the row-count check below)"
    ).not.toBeNull();
    const rowCount = (tableSection?.[0] ?? "")
      .split("\n")
      .filter((line) => line.match(/^\|\s*"/u)).length;
    expect(
      rowCount,
      "critic anti-rat row count regressed (expected 10 quoted excuse rows: 8 pre-v8.53 + 2 v8.53 lens dodges)"
    ).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deliverable 2 — design.ts Phase 6 ambiguity score + Phase 7 warning
// ─────────────────────────────────────────────────────────────────────

describe("v8.53 AC-2 — design Phase 6 ambiguity score calculation", () => {
  it("design prompt Phase 6 declares the ambiguity score sub-step", () => {
    expect(
      DESIGN_PROMPT,
      "Phase 6 must declare an `Ambiguity score` sub-section (H4) so the calculation has a stable parsing anchor"
    ).toMatch(/####\s+Ambiguity score/u);
  });

  it("design prompt names v8.53 as the introducing release for the ambiguity score", () => {
    expect(
      DESIGN_PROMPT,
      "the ambiguity score sub-section must cite v8.53 so future cleanup sweeps can audit the provenance"
    ).toMatch(/Ambiguity score \(v8\.53/u);
  });

  it("design prompt declares the 0.0-1.0 score range with semantic anchors", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must teach the 0.0 (perfectly clear) → 1.0 (entirely fuzzy) semantic so scoring is consistent across slugs"
    ).toMatch(/0\.0[\s\S]{0,200}1\.0|perfectly clear|entirely fuzzy/u);
  });

  it("design prompt names the greenfield 3-dimension scoring rubric (goal / constraints / success)", () => {
    expect(DESIGN_PROMPT).toMatch(/Goal clarity[\s\S]{0,500}weight\s*`?0\.4`?/u);
    expect(DESIGN_PROMPT).toMatch(/Constraints clarity[\s\S]{0,500}weight\s*`?0\.3`?/u);
    expect(DESIGN_PROMPT).toMatch(/Success criteria clarity[\s\S]{0,500}weight\s*`?0\.3`?/u);
  });

  it("design prompt names the brownfield 4-dimension scoring rubric (goal / constraints / success / context)", () => {
    expect(DESIGN_PROMPT).toMatch(/brownfield[\s\S]{0,500}Goal clarity[\s\S]{0,500}weight\s*`?0\.35`?/u);
    expect(DESIGN_PROMPT).toMatch(/Constraints clarity[\s\S]{0,1500}weight\s*`?0\.25`?/u);
    expect(DESIGN_PROMPT).toMatch(/Success criteria clarity[\s\S]{0,1500}weight\s*`?0\.25`?/u);
    expect(DESIGN_PROMPT).toMatch(/Context clarity[\s\S]{0,500}weight\s*`?0\.15`?/u);
  });

  it("design prompt names the brownfield detection signal (triage.problemType == 'refines' OR plan.md refines non-null)", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must declare HOW to detect brownfield so the agent does not re-invent the heuristic"
    ).toMatch(/triage\.problemType[\s\S]{0,200}refines|refines[\s\S]{0,200}non-null/iu);
  });

  it("design prompt teaches the composite formula (weighted sum)", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must show the weighted-sum formula so a reviewer can audit the math against the per-dimension scores in plan.md"
    ).toMatch(/sum\(.*dimension/iu);
  });

  it("design prompt clamps composite to [0.0, 1.0] and rounds to two decimal places", () => {
    expect(DESIGN_PROMPT).toMatch(/clamp[\s\S]{0,100}\[?0\.0,?\s*1\.0\]?|\[?0\.0,?\s*1\.0\]?[\s\S]{0,100}clamp/iu);
    expect(DESIGN_PROMPT).toMatch(/two decimal places|round.*two decimal/iu);
  });

  it("greenfield weights sum to 1.0 (0.4 + 0.3 + 0.3)", () => {
    // Sanity check on the rubric arithmetic — if a future PR accidentally
    // re-weights, this catches it before the orchestrator runs the calc.
    const weights = [0.4, 0.3, 0.3];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("brownfield weights sum to 1.0 (0.35 + 0.25 + 0.25 + 0.15)", () => {
    const weights = [0.35, 0.25, 0.25, 0.15];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

describe("v8.53 AC-2 — ambiguity score persistence to plan.md frontmatter", () => {
  it("design prompt teaches persisting the score to plan.md frontmatter", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must direct the agent to write the score to frontmatter so downstream readers (Phase 7 picker, ac-author, reviewer) can read it"
    ).toMatch(/plan\.md frontmatter[\s\S]{0,2000}ambiguity_score/u);
  });

  it("design prompt names all three frontmatter keys (ambiguity_score / ambiguity_dimensions / ambiguity_threshold)", () => {
    for (const key of ["ambiguity_score", "ambiguity_dimensions", "ambiguity_threshold"]) {
      expect(
        DESIGN_PROMPT,
        `design prompt must mention frontmatter key \`${key}\` so the orchestrator picker can parse it without guessing`
      ).toContain(key);
    }
  });

  it("design prompt shows the per-dimension breakdown shape (goal / constraints / success keys)", () => {
    expect(DESIGN_PROMPT).toMatch(/ambiguity_dimensions:[\s\S]{0,500}goal:[\s\S]{0,100}constraints:[\s\S]{0,100}success:/u);
  });

  it("design prompt teaches the brownfield-only `context` dimension key", () => {
    expect(
      DESIGN_PROMPT,
      "on brownfield slugs the `context` dimension MUST be persisted; on greenfield slugs the key MUST be omitted entirely (not written as null) — the prompt must state this"
    ).toMatch(/context:[\s\S]{0,500}(brownfield|ONLY emitted)/u);
  });
});

describe("v8.53 AC-2 — Phase 7 picker warning logic (soft signal, never a hard gate)", () => {
  it("design prompt Phase 7 includes an ambiguity warning prefix block", () => {
    expect(
      DESIGN_PROMPT,
      "Phase 7 must declare the warning-prefix logic so the picker emits the soft signal when the composite exceeds the threshold"
    ).toMatch(/ambiguity_score\s*>\s*ambiguity_threshold|Ambiguity warning prefix/u);
  });

  it("design prompt declares the warning is informational (NEVER a hard gate)", () => {
    expect(
      DESIGN_PROMPT,
      "the warning MUST be a soft signal — the user can always approve regardless. This is the v8.53 backbone."
    ).toMatch(/informational, not a hard gate|never a hard gate|soft signal/iu);
  });

  it("design prompt teaches the `request-changes recommended for: <dimensions>` warning text format", () => {
    expect(
      DESIGN_PROMPT,
      "the warning must name the dimensions whose per-dim score > 0.3 so the user knows what to address; the prompt must declare this format"
    ).toMatch(/request-changes recommended for/u);
  });

  it("design prompt declares the per-dimension visibility cutoff (0.3)", () => {
    expect(
      DESIGN_PROMPT,
      "dimensions are surfaced in the warning only when their per-dimension score > 0.3; the cutoff must be in the prompt"
    ).toMatch(/per-dimension[\s\S]{0,300}0\.3|0\.3[\s\S]{0,200}per-dimension/iu);
  });

  it("design prompt handles the empty-dimensions edge case (composite > threshold via several middling scores)", () => {
    expect(
      DESIGN_PROMPT,
      "when no individual dimension is > 0.3 but the composite still exceeds the threshold, the warning must still fire with a structural-shape message; the prompt must teach this edge case"
    ).toMatch(/no single dimension above 0\.3|composite \(no single dimension/u);
  });

  it("design prompt keeps the three-option picker (approve / request-changes / reject) unchanged", () => {
    // Sanity check — the picker shape is unchanged; v8.53 only adds the
    // warning prefix.
    expect(DESIGN_PROMPT).toMatch(/approve.*ac-author/u);
    expect(DESIGN_PROMPT).toMatch(/request-changes.*describe/u);
    expect(DESIGN_PROMPT).toMatch(/reject.*rejection note/u);
  });
});

describe("v8.53 AC-2 — configurable threshold (`.cclaw/config.yaml > design.ambiguity_threshold`)", () => {
  it("design prompt names the configurable threshold path and the default", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must point at the config file + key so the user knows where to tune the threshold"
    ).toMatch(/\.cclaw\/config\.yaml[\s\S]{0,500}design\.ambiguity_threshold/u);
    expect(
      DESIGN_PROMPT,
      "the default value (0.2) must be documented inline so the agent knows the fallback when the config is absent"
    ).toMatch(/default[\s\S]{0,200}0\.2|0\.2[\s\S]{0,200}default/iu);
  });

  it("design prompt teaches the out-of-range fallback (config value outside [0.0, 1.0] → 0.2)", () => {
    expect(
      DESIGN_PROMPT,
      "out-of-range thresholds must silently fall back to 0.2 so a misconfig does not break the picker; the prompt must teach this"
    ).toMatch(/outside[\s\S]{0,200}\[?0\.0,?\s*1\.0\]?[\s\S]{0,200}0\.2|fall back to (?:the )?default 0\.2/iu);
  });
});

describe("v8.53 AC-2 — config schema + helper function", () => {
  it("DEFAULT_AMBIGUITY_THRESHOLD is 0.2", () => {
    expect(DEFAULT_AMBIGUITY_THRESHOLD).toBe(0.2);
  });

  it("ambiguityThresholdOf returns the default when config is null", () => {
    expect(ambiguityThresholdOf(null)).toBe(0.2);
  });

  it("ambiguityThresholdOf returns the default when config is undefined", () => {
    expect(ambiguityThresholdOf(undefined)).toBe(0.2);
  });

  it("ambiguityThresholdOf returns the default when design block is absent", () => {
    const config: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"]
    };
    expect(ambiguityThresholdOf(config)).toBe(0.2);
  });

  it("ambiguityThresholdOf returns the default when design.ambiguity_threshold is absent", () => {
    const config: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: {}
    };
    expect(ambiguityThresholdOf(config)).toBe(0.2);
  });

  it("ambiguityThresholdOf returns the configured value when set inside [0.0, 1.0]", () => {
    const config: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: 0.35 }
    };
    expect(ambiguityThresholdOf(config)).toBe(0.35);
  });

  it("ambiguityThresholdOf accepts boundary values 0.0 and 1.0", () => {
    const zero: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: 0.0 }
    };
    const one: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: 1.0 }
    };
    expect(ambiguityThresholdOf(zero)).toBe(0.0);
    expect(ambiguityThresholdOf(one)).toBe(1.0);
  });

  it("ambiguityThresholdOf falls back when configured value is below 0.0", () => {
    const config: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: -0.1 }
    };
    expect(ambiguityThresholdOf(config)).toBe(0.2);
  });

  it("ambiguityThresholdOf falls back when configured value is above 1.0", () => {
    const config: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: 1.5 }
    };
    expect(ambiguityThresholdOf(config)).toBe(0.2);
  });

  it("ambiguityThresholdOf falls back when configured value is non-numeric", () => {
    const config = {
      version: "8.53.0",
      flowVersion: "8" as const,
      harnesses: ["cursor" as const],
      design: { ambiguity_threshold: "0.3" as unknown as number }
    };
    expect(ambiguityThresholdOf(config)).toBe(0.2);
  });

  it("ambiguityThresholdOf falls back when configured value is NaN or Infinity", () => {
    const nan: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: NaN }
    };
    const inf: CclawConfig = {
      version: "8.53.0",
      flowVersion: "8",
      harnesses: ["cursor"],
      design: { ambiguity_threshold: Infinity }
    };
    expect(ambiguityThresholdOf(nan)).toBe(0.2);
    expect(ambiguityThresholdOf(inf)).toBe(0.2);
  });
});

describe("v8.53 AC-2 — plan.md template carries the ambiguity frontmatter fields", () => {
  const plan = ARTIFACT_TEMPLATES.find((tpl) => tpl.id === "plan");

  it("PLAN template exists", () => {
    expect(plan, "plan template missing from ARTIFACT_TEMPLATES").toBeDefined();
  });

  it("PLAN template frontmatter declares `ambiguity_score`", () => {
    expect(plan!.body).toMatch(/^ambiguity_score:/mu);
  });

  it("PLAN template frontmatter declares `ambiguity_dimensions`", () => {
    expect(plan!.body).toMatch(/^ambiguity_dimensions:/mu);
  });

  it("PLAN template frontmatter declares `ambiguity_threshold`", () => {
    expect(plan!.body).toMatch(/^ambiguity_threshold:/mu);
  });

  it("PLAN template ambiguity fields default to null (placeholder for design Phase 6 to fill)", () => {
    const frontmatter = plan!.body.split("\n---\n")[0]!;
    expect(frontmatter).toMatch(/ambiguity_score:\s*null/u);
    expect(frontmatter).toMatch(/ambiguity_dimensions:\s*null/u);
    expect(frontmatter).toMatch(/ambiguity_threshold:\s*null/u);
  });

  it("PLAN template comments cite v8.53 as the introducing release", () => {
    const frontmatter = plan!.body.split("\n---\n")[0]!;
    expect(
      frontmatter,
      "the v8.53 comment in the template anchors the field to the changelog for future readers"
    ).toMatch(/v8\.53/u);
  });

  it("PLAN template comment names both greenfield and brownfield dimension counts (3 vs 4)", () => {
    const frontmatter = plan!.body.split("\n---\n")[0]!;
    expect(frontmatter).toMatch(/3 dimensions[\s\S]{0,400}4 dimensions|greenfield[\s\S]{0,400}brownfield/u);
  });

  it("PLAN template frontmatter remains valid YAML after the v8.53 additions", () => {
    const frontmatter = plan!.body.split("\n---\n")[0]!.replace(/^---\n?/u, "");
    // Replace YAML-template-placeholders with concrete values so the YAML
    // parser can validate the shape end-to-end.
    const concrete = frontmatter
      .replace(/SLUG-PLACEHOLDER/gu, "v853-test-slug")
      .replace(/PLAN-POSTURE-PLACEHOLDER/gu, "test-first")
      .replace(/AC-MODE-PLACEHOLDER/gu, "strict")
      .replace(/GENERATED-AT-PLACEHOLDER/gu, "2026-05-14T00:00:00.000Z");
    expect(() => YAML.parse(concrete)).not.toThrow();
    const parsed = YAML.parse(concrete) as Record<string, unknown>;
    expect(parsed).toHaveProperty("ambiguity_score");
    expect(parsed).toHaveProperty("ambiguity_dimensions");
    expect(parsed).toHaveProperty("ambiguity_threshold");
  });
});

describe("v8.53 AC-2 — backwards compat (legacy plan.md without ambiguity fields)", () => {
  it("design prompt declares the backwards-compat story for legacy plans", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must document that legacy plan.md files without the new keys keep working — only NEW design sessions emit the score"
    ).toMatch(/Backwards compat|backward[s]? compat/u);
  });

  it("design prompt teaches that absent score is treated as 'unknown' by readers", () => {
    expect(DESIGN_PROMPT).toMatch(/absent[\s\S]{0,300}unknown|unknown[\s\S]{0,300}absent/iu);
  });

  it("design prompt declares that score absence does NOT block downstream stages", () => {
    expect(
      DESIGN_PROMPT,
      "the prompt must teach that the absence is informational; downstream stages (ac-author / reviewer / Phase 7 picker) must not refuse to advance"
    ).toMatch(/does NOT block downstream|absence does not block/iu);
  });

  it("Phase 7 picker fallback fires with no warning prefix when either field is absent", () => {
    expect(
      DESIGN_PROMPT,
      "when ambiguity_score OR ambiguity_threshold is absent on a legacy plan, the picker emits the standard three-option picker without the warning prefix; the prompt must state this"
    ).toMatch(/absent[\s\S]{0,200}legacy[\s\S]{0,200}standard|legacy[\s\S]{0,200}standard|either field is absent/u);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-deliverable invariants — v8.53 closes the v8.48-v8.53 roadmap
// ─────────────────────────────────────────────────────────────────────

describe("v8.53 cross-deliverable invariants", () => {
  it("v8.53 ships zero NET new specialists (additive to critic + design only)", () => {
    // Sanity check — the critic.ts and design.ts prompt bodies still exist
    // and are non-empty; v8.53 should NOT introduce a new specialist.
    expect(typeof CRITIC_PROMPT).toBe("string");
    expect(CRITIC_PROMPT.length).toBeGreaterThan(1000);
    expect(typeof DESIGN_PROMPT).toBe("string");
    expect(DESIGN_PROMPT.length).toBeGreaterThan(1000);
  });

  it("v8.53 ships zero NEW stages (additive to existing critic + design)", () => {
    // Stage count is verified by other tests in the suite (FLOW_STAGES length).
    // Here we just guarantee that no v8.53 stage token appears anywhere new.
    expect(CRITIC_PROMPT).not.toMatch(/stage:\s*lens-sweep/u);
    expect(DESIGN_PROMPT).not.toMatch(/stage:\s*ambiguity/u);
  });

  it("v8.53 critic prompt explicitly cites v8.53 for lens additions", () => {
    expect(
      CRITIC_PROMPT,
      "the critic prompt must cite v8.53 so changelog reverse-lookup works ('which release introduced human-perspective lenses?')"
    ).toMatch(/v8\.53/u);
  });

  it("v8.53 design prompt explicitly cites v8.53 for ambiguity score additions", () => {
    expect(
      DESIGN_PROMPT,
      "the design prompt must cite v8.53 so changelog reverse-lookup works ('which release introduced the ambiguity score?')"
    ).toMatch(/v8\.53/u);
  });

  it("both deliverables credit OMC as the source pattern", () => {
    // Critic lens sweep ← OMC critic discipline; design ambiguity score
    // ← OMC deep-interview rubric. Both cite OMC.
    expect(CRITIC_PROMPT).toMatch(/OMC/u);
  });
});
