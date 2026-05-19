/**
 * Single source of truth for the seven design-quality dimensions (added in the v8.75 release).
 *
 * Two consumers, one rubric:
 *
 * - {@link "src/content/specialist-prompts/reviewer.ts" | REVIEWER_PROMPT} —
 *   the v8.70 gated `design-quality` axis on the post-build reviewer. The
 *   reviewer walks the DIFF and grades each dimension 0-10; below-6 grades
 *   become F-N findings (severity ladder: 5→consider, ≤3→required;
 *   accessibility one tier sharper; accessibility ≤2 → critical).
 * - {@link "src/content/specialist-prompts/plan-critic.ts" | PLAN_CRITIC_PROMPT} —
 *   the pre-build `plan-critic` specialist on `rubricMode: "design"` dispatches
 *   (v8.75 added the design lens as a standalone `plan-design` specialist;
 *   v8.104 merged it into `plan-critic` as one of three rubric modes). Walks
 *   PLAN.MD (not a diff) and grades the same seven dimensions for plan-level
 *   design clarity; below-6 grades become PD-N findings appended to
 *   `## Plan-design findings` in plan.md. Block-ship on strict at severity ≥
 *   medium.
 *
 * Why one const, not two prompts that drift: prior cclaw versions baked the
 * rubric verbatim into reviewer.ts. v8.75 lifts the rubric into a const so
 * the seven dimensions, the "what a 10 looks like" anchors, and the AI-slop
 * cross-cut all live in one place — change the rubric here and both
 * specialists pick it up at install time.
 *
 * The rubric is NOT prose-pluggable across the two surfaces in every
 * area: each consumer wraps the rubric with surface-specific
 * intro / outro framing (the reviewer reads the rendered diff; plan-critic
 * with `rubricMode: "design"` reads plan.md sections). The exported {@link renderDesignQualityRubricTable}
 * and {@link renderDesignQualityAiSlopChecklist} helpers produce the
 * verbatim markdown that both prompts embed; the wrapping context is each
 * specialist's responsibility.
 */

/**
 * One dimension of the design-quality rubric. The seven dimensions are
 * stable and immutable; new dimensions require a major version bump
 * (changing the rubric shape would invalidate every prior shipped slug's
 * design-quality findings).
 *
 * - `key` — short identifier used in headings / grep / test assertions.
 *   Hyphenated kebab-case for stability across markdown rendering.
 * - `name` — display name used in the rendered table row and in finding
 *   bodies ("Visual hierarchy: 4/10 ...").
 * - `summary` — one-line "what it covers" cell, second column of the
 *   rubric table.
 * - `anchor10` — "what a 10 looks like" reference, third column. Lifted
 *   verbatim from v8.70's reviewer.ts table; the anchor is what converts
 *   a grade from a vibe into a directional signal the builder can act on.
 */
export interface DesignQualityDimension {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  readonly anchor10: string;
}

export const DESIGN_QUALITY_DIMENSIONS: readonly DesignQualityDimension[] = [
  {
    key: "visual-hierarchy",
    name: "visual hierarchy",
    summary:
      "content priority — what does the user see first / second / third? does the most important action stand out? are decorative elements suppressed below load-bearing ones?",
    anchor10:
      "clear primary action visually dominant (size, weight, color); secondary actions de-emphasised; non-essential metadata at the lowest visual weight; the page's purpose is legible from a 1-second glance"
  },
  {
    key: "type-system",
    name: "type system consistency",
    summary:
      "typography reuses a small, deliberate set of sizes / weights / line-heights; headings cascade predictably; body / caption / label tiers are distinct and consistent across views",
    anchor10:
      "3-5 type sizes total across the diff; explicit `h1` / `h2` / `h3` cascade; body and caption have a single canonical line-height each; no one-off font-size literals in the diff"
  },
  {
    key: "color-system",
    name: "color system",
    summary:
      "palette is constrained and semantic; foreground / background pairs hold contrast; brand / neutral / state (success / warning / error / info) tiers are distinguishable from each other and from the background",
    anchor10:
      "a documented palette (CSS variables / design tokens) with neutral + brand + state tiers; every new color reuses an existing token; no hex literals embedded in component code; state colors (red / amber / green) reserved for state, not decoration"
  },
  {
    key: "spacing-rhythm",
    name: "spacing rhythm",
    summary:
      "padding / margin / gap follow a consistent scale (e.g. 4px / 8px / 16px / 24px / 32px); related elements cluster, unrelated elements separate; the layout breathes without being sparse",
    anchor10:
      "spacing reuses a single token scale; related controls grouped tighter than unrelated ones; section-level whitespace at least 2× control-level whitespace; no one-off pixel literals (`margin: 13px`) in the diff"
  },
  {
    key: "interaction-affordances",
    name: "interaction affordances",
    summary:
      "interactive elements look interactive without hover; loading / empty / error / success / disabled states are explicit; click / tap targets visually distinct from passive text",
    anchor10:
      "every button / link clearly affords interaction at rest (border / background / underline); every async surface has explicit loading + empty + error + success states implemented (not deferred); disabled state is visually distinct from active without relying solely on color"
  },
  {
    key: "accessibility",
    name: "accessibility (WCAG AA)",
    summary:
      "contrast ratio ≥ 4.5:1 for body, ≥ 3:1 for large text and UI components; keyboard reachable in logical order; focus rings visible on every interactive element; semantic HTML / ARIA roles correct; alt text on meaningful images; no keyboard traps",
    anchor10:
      "every text / control / icon meets WCAG AA contrast; tab order matches reading order; focus ring visible on every focusable element; `<button>` / `<a>` / `<input>` used semantically (not `<div onClick>`); `aria-label` on icon-only buttons; `aria-live` on dynamic regions; alt text on every meaningful image"
  },
  {
    key: "responsive",
    name: "responsive behavior",
    summary:
      "layout adapts at named breakpoints; touch targets ≥ 44×44 on mobile; no horizontal scrolling on common viewport widths; content reflows rather than truncating critical actions",
    anchor10:
      "explicit breakpoints (e.g. `sm` / `md` / `lg`); touch targets ≥ 44px on mobile; no horizontal scroll at 320px width; primary actions remain visible at every breakpoint; tested visually at ≥ 2 widths in qa-runner evidence when qa-runner ran"
  }
] as const;

/**
 * Canonical AI-slop signals that cross-cut the seven dimensions. When the
 * artifact (diff or plan.md) hits two or more of these signals, both
 * specialists raise an additional umbrella finding under their respective
 * design-quality surface (severity=required by default).
 *
 * Lifted verbatim from v8.70 reviewer.ts so the slop set has a single
 * source of truth across pre-build (plan-critic on `rubricMode: "design"`)
 * and post-build (reviewer) lenses; both lenses fire the same signals.
 */
export const DESIGN_QUALITY_AI_SLOP_SIGNALS: readonly string[] = [
  "3-column feature grids with identical cards regardless of metric importance",
  "purple/blue gradients used decoratively without semantic intent",
  "icons in colored circles with no functional meaning",
  "uniform border-radius applied to every surface (cards, buttons, inputs, modals all 8px)",
  "generic SaaS landing-page composition (hero + features grid + testimonials + CTA) without product-specific reasoning",
  '"modern and clean" or "sleek" as the entire design direction (no functional reasoning visible in the diff or plan.md)',
  "stock-photo hero images",
  "dashboard with N identical metric cards regardless of metric importance"
];

/**
 * Render the seven-dimension rubric table as the exact markdown both
 * specialist prompts embed. Three columns: dimension name, "what it
 * covers", "what a 10 looks like". The leading `| dimension | what it
 * covers | what a 10 looks like |` header + separator are emitted so the
 * consumer can drop the result into the prompt body verbatim.
 *
 * The function takes NO arguments — the dimensions are immutable. Two
 * consumers can render the same table without drifting.
 */
export function renderDesignQualityRubricTable(): string {
  const header =
    "| dimension | what it covers | what a 10 looks like |\n| --- | --- | --- |";
  const rows = DESIGN_QUALITY_DIMENSIONS.map(
    (d) => `| **${d.name}** | ${d.summary} | ${d.anchor10} |`
  ).join("\n");
  return `${header}\n${rows}`;
}

/**
 * Render the AI-slop signals as a bullet list, exact markdown both prompts
 * embed. Sits immediately under the rubric table in each consumer.
 */
export function renderDesignQualityAiSlopChecklist(): string {
  return DESIGN_QUALITY_AI_SLOP_SIGNALS.map((s) => `- ${s};`).join("\n");
}
