---
name: design-quality-discipline
trigger: design surface detected — auto-on at plan + review stages when triage.designSurface is true OR triage.surfaces ∩ {ui, design, frontend, ux} ≠ ∅
---

# Skill: design-quality-discipline

cclaw's design-quality lens fires twice on any slug whose triage flagged a UI / design / frontend / UX surface: once at plan-time via the **`plan-critic` specialist on a `rubricMode: "design"` dispatch** (v8.104 — absorbed the former v8.75 standalone `plan-design` specialist into `plan-critic` as one of its three rubric modes; walks plan.md against the seven-dimension rubric BEFORE the build runs) and once at review-time via the reviewer's gated **design-quality axis** (v8.70 — walks the rendered diff against the same rubric AFTER the build runs). Both surfaces share a single source of truth: `src/content/design-quality-rubric.ts` exports the seven dimensions, the "what a 10 looks like" anchors, and the AI-slop signal set; both prompts render the same markdown via `renderDesignQualityRubricTable()` / `renderDesignQualityAiSlopChecklist()`.

This skill spells out **how to use the rubric well**, regardless of which specialist is reading it. It is auto-on at the `plan` stage (`plan-critic` with `rubricMode: "design"`) and the `review` stage (reviewer with `walkDesignQualityAxis: true`); a missing design surface gate at either stage structurally skips this skill.

## When to apply

- **`plan-critic` `rubricMode: "design"` dispatch (v8.104; absorbed former v8.75 plan-design):** `triage.designSurface == true` OR `triage.surfaces ∩ {ui, design, frontend, ux} ≠ ∅`; AND `triage.ceremonyMode ∈ {soft, strict}`; AND `flows/<slug>/plan.md` exists.
- **reviewer design-quality axis (v8.70) dispatch:** `triage.designSurface == true` OR `triage.surfaces ∩ {ui, design, frontend, ux} ≠ ∅` (no ceremonyMode restriction — runs in inline too via the post-build reviewer when one is dispatched).

## When NOT to apply

- CLI / library / API / data / infra / docs slugs (the design surface gate fails — no rendered UI exists to walk; reviewer's design-quality axis is structurally skipped).
- `triage.ceremonyMode == "inline"` for the `plan-critic` `rubricMode: "design"` dispatch (no plan.md exists). The reviewer's design-quality axis can still fire on inline trivial slugs IF a reviewer is dispatched (rare; inline usually has no reviewer pass).
- A slug where the diff touches design files but the rendered surface is unchanged (e.g. moving a CSS file between directories with no visual change) — both specialists detect "no visual delta" via the diff and N/A the dimensions explicitly rather than fishing for findings.

## The seven dimensions (canonical names)

| key | name |
| --- | --- |
| visual-hierarchy | visual hierarchy |
| type-system | type system consistency |
| color-system | color system |
| spacing-rhythm | spacing rhythm |
| interaction-affordances | interaction affordances |
| accessibility | accessibility (WCAG AA) |
| responsive | responsive behavior |

Full "what a 10 looks like" anchors live in `src/content/design-quality-rubric.ts > DESIGN_QUALITY_DIMENSIONS`. Each consumer (`plan-critic.ts` on a `rubricMode: "design"` dispatch + `reviewer.ts`) embeds the table verbatim via the shared renderer — do not redefine the rubric in any other place.

## Process

- **Grade 0-10 per dimension; below-6 becomes a finding.** Above-7 is acceptable; 6 is borderline (recorded but emits no finding). 7+ records the dimension as a positive observation (cited as carry-over context by the downstream reviewer when `plan-critic rubricMode: "design"` ran first).
- **Pre-commitment is mandatory.** Before reading the artifact in detail, write 3-5 predictions of which dimensions are most likely to grade below 6. After writing predictions, walk the rubric and verify each prediction (`confirmed` / `refuted` / `partial`). Never delete a refuted prediction — refutation is information.
- **Severity ladder mirrors across both consumers.** `plan-critic` (design mode): 5/10 → `low`, 4/10 → `medium`, ≤3/10 → `high`. Reviewer: 5/10 → `consider`, 4/10 → `required`, ≤3/10 → `required` (architecture-tier when the rendered diff fails WCAG AA outright → `critical`).
- **Accessibility escalates one tier.** Both specialists treat below-6 accessibility as `medium`/`required` minimum (regardless of grade); accessibility ≤2 is `high`/`critical` regardless of ceremonyMode (legal / inclusion baseline).
- **AI-slop umbrella.** When ≥2 signals from `DESIGN_QUALITY_AI_SLOP_SIGNALS` fire on the same artifact, emit a single umbrella finding (`PD-N` for `plan-critic rubricMode: "design"`, `F-N` for reviewer) with severity `medium`/`required` (default in strict; one tier down in soft). The fix is product-specific functional design thinking — recommend rewriting Frame / Decisions with explicit user-needs reasoning.

## Block-ship semantics

- **`plan-critic rubricMode: "design"` strict mode:** any `PD-N` with severity ≥ `medium` blocks ship (the v8.75 block-ship-on-strict floor, preserved across the v8.104 merge). Soft mode surfaces but does not block; ≥2 `high` rows surfaces a stop-and-report status block.
- **reviewer strict mode:** any `F-N` on the design-quality axis with severity ≥ `required` blocks ship (the v8.70 floor). The reviewer cross-references plan.md `## Plan-design findings` for any `PD-N` row marked `open` — when `plan-critic rubricMode: "design"` carried a finding forward as `open` into the build (the architect's revise loop did NOT address it), the reviewer escalates the matching `F-N` severity by one tier.
- **Both modes preserve User Sovereignty:** the user can override via the stop-and-report status block (`/cc` to continue with findings open; `/cc-cancel` to discard). The specialist NEVER silently downgrades a finding to avoid blocking.

## Hard rules

- **NEVER silently downgrade accessibility.** Below-6 grade ⇒ severity ≥ `medium`/`required` (one tier above the standard ladder); ≤2 grade ⇒ `high`/`critical` regardless of ceremonyMode. The specialist surfaces; the user decides whether to override.
- **NEVER skip pre-commitment after reading the artifact.** Predictions written AFTER detailed reading are post-hoc rationalizations, not predictions. The discipline activates deliberate search; collapsing the ordering loses the signal.
- **NEVER relitigate the architect's design direction.** `plan-critic rubricMode: "design"` + reviewer's design-quality axis catch **missing commitments** and **shipped gaps**, NOT alternatives the architect already considered. Alternatives go in Notes (slim summary), never as a finding.
- **NEVER mark a dimension N/A without citing which dimension and why.** N/A is acceptable when the artifact does not exercise the dimension (e.g. a CSS-only spacing change does not exercise color-system); the skip MUST name the dimension and one-line the reason.
- **NEVER generate visual mockups inside the `plan-critic rubricMode: "design"` dispatch.** The harness is mockup-agnostic; surface "recommend running the harness's design-preview" as a `Suggested fix` row instead of producing a binary artifact.

## Common rationalizations + rebuttals

| rationalization | rebuttal |
| --- | --- |
| "Accessibility is the user's responsibility — I'll grade it 6 to avoid blocking." | NO. WCAG AA is a baseline, not an opt-in. Below-6 accessibility automatically escalates to `medium`/`required` minimum (one tier above the standard ladder); below-2 is `high`/`critical` regardless of ceremonyMode. Surface the gap; the user can still override via stop-and-report. |
| "The design reads fine on first pass; every dimension grades 7+." | First-read 7+ on every dimension without the rubric walked is sycophancy. Designs almost always under-scope interaction states and accessibility; uniform 7+ grades mean you skipped the rubric. Re-read with focused attention on interaction-affordances + accessibility specifically. |
| "`plan-critic rubricMode: \"design\"` already flagged this — the reviewer can skip the design-quality axis." | NO. Both surfaces run on independent evidence (plan.md vs rendered diff). The pre-build design pass catches "the plan did not commit to the work"; reviewer catches "the work shipped did not match the plan's commitment OR introduced new gaps". When `plan-critic rubricMode: "design"` ran, the reviewer cross-references plan.md `## Plan-design findings` for carry-over context — it does NOT skip its own pass. |
| "The task is small — I'll skim the dimensions and grade quickly." | The axis is gated on surface, not diff size. A 30-line CSS change can ship a contrast regression affecting every page using the token. Grade dimensions that ARE exercised by the artifact; skip the rest as N/A with a one-line reason. Skips MUST cite which dimension and why. |
| "I'd design it differently — let me suggest an alternative as a finding." | Out of scope for both specialists. The pre-build design pass catches missing commitments in the plan as written; reviewer catches gaps in the diff as shipped. The architect chose the design direction; neither specialist relitigates. Surface alternatives as Notes in the slim summary if genuinely important — do NOT file as a finding. |

## Cross-reference

- Shared rubric source of truth: `src/content/design-quality-rubric.ts`.
- `plan-critic` specialist contract (covers all three rubric modes — generic / design / devex): `.cclaw/lib/agents/plan-critic.md`.
- reviewer design-quality axis details: `.cclaw/lib/agents/reviewer.md > Design-quality axis details`.
- Runbook (gating + dispatch + verdict routing): `.cclaw/lib/runbooks/critic-steps.md > Plan-design pass` (covers the `rubricMode: "design"` dispatch); `.cclaw/lib/runbooks/review.md` (reviewer).
