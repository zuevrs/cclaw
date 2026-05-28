---
name: reviewer-axis-design-quality
trigger: gated reviewer axis. Loads when ANY of three gating conditions hold — `walkDesignQualityAxis: true` on the dispatch envelope, `triage.surfaces` ∩ {`ui`, `design`, `frontend`, `ux`} ≠ ∅, OR the diff's file list contains at least one `*.tsx` / `*.jsx` / `*.vue` / `*.svelte` / `*.astro` / `*.html` / `*.css` / `*.scss` file (fallback heuristic).
---

# Skill: reviewer-axis-design-quality

Full per-dimension grading rubric, AI-slop check, severity ladder, and anti-rationalizations for the reviewer's `design-quality` axis. Lifted out of `reviewer.ts` — the prompt now carries only a 5-line stub pointing here.

The `design-quality` axis is the visual / interaction / accessibility pass on UI-bearing diffs. It exists to catch **UI slop** — generic AI-generated interfaces, type-system inconsistency, broken hierarchy, missing accessibility — that the other thirteen axes do not surface (correctness validates behaviour, qa-evidence validates rendered AC clauses, architecture validates module boundaries; none of them ask "is this a *good* interface?").

## When to use

Pinned to the reviewer's dispatch envelope when ANY of:

1. The dispatch envelope from the orchestrator carries `walkDesignQualityAxis: true` (set by start-command's reviewer dispatch when `triage.designSurface == true` from triage detection).
2. `flow-state.json > triage.surfaces` includes any of `"ui"` / `"design"` / `"frontend"` / `"ux"` (architect-written via Phase 1 surface detection).
3. The diff's file list contains at least one file matching `*.tsx` / `*.jsx` / `*.vue` / `*.svelte` / `*.astro` / `*.html` / `*.css` / `*.scss` (fallback heuristic — fires the axis even when triage / architect missed the surface).

The shared rubric source of truth lives in `src/content/design-quality-rubric.ts > DESIGN_QUALITY_DIMENSIONS` + `DESIGN_QUALITY_AI_SLOP_SIGNALS`; the `plan-critic` specialist on `rubricMode: "design"` dispatches consumes the same const against plan.md so the seven dimensions stay in lock-step pre- and post-build (the former standalone `plan-design` specialist is now a `plan-critic` rubric mode).

## When NOT to apply

- All three gating conditions absent — emit zero findings; note "design-quality: skipped (no design surface)" in the iteration block (see "When to use" above). Skipping is the default on backend / data / CLI / infra / docs slugs; do not invent design findings on a Postgres migration.
- The diff is purely backend even though triage flagged design surface (e.g. the user said "improve the API powering the dashboard" — triage matched `dashboard`, but the diff only touches `*.ts` API routes) — the axis fires the gate but emits zero findings because no UI files are in the diff. Note "design-quality: gate fired but zero UI files in diff; skipping per-dimension grading" in the iteration block. This honest-skip behavior keeps the gate forgiving on false-positive triage flags.
- `triage.downgradeReason == "no-git"` does NOT skip the axis — design quality is independent of git history; run the rubric against the working-tree diff via `git diff --no-index` or direct file reads.

## Process

**Per-dimension grading rubric.** When the gate fires, walk the diff and grade each of seven dimensions `0-10` with an explicit **what a 10 looks like** reference. Render each grade verbatim in the iteration block under a `### Design-quality axis` sub-section using the format `<Dimension>: <N>/10 — it's a <N> because <gap>. A 10 would have <what's needed>.` (this is the gstack `/plan-design-review` shape; the `what a 10 looks like` reference is mandatory — it converts the grade from a vibe into a directional signal the builder can actually act on). The rubric table is rendered from the shared `design-quality-rubric.ts` const (`DESIGN_QUALITY_DIMENSIONS`); the `plan-critic` specialist on `rubricMode: "design"` dispatches consumes the same rubric against plan.md so the seven dimensions stay in lock-step pre- and post-build (single source of truth). The seven dimensions: **visual hierarchy**, **type system consistency**, **color system**, **spacing rhythm**, **interaction affordances**, **accessibility (WCAG AA)**, **responsive behavior**.

**Below-6 grades become findings.** A grade of `5/10` or lower on any dimension is a **design-quality finding (severity=consider)** by default. Cite the dimension name, the grade, the gap, the "what a 10 looks like" reference, and the file:line(s) where the gap is most visible. Severity escalates per the standard ladder:

- `5/10` → `consider` (default for below-6 grades; carries to learnings).
- `3/10` or below → `required` (gates ship in strict / soft).
- accessibility (WCAG AA) grade `5/10` or below → `required` (legal / inclusion baseline; never `consider` for accessibility — escalate the standard ladder by one tier).
- accessibility grade `2/10` or below → `critical` (blocks ship in every ceremonyMode; e.g. unlabelled buttons that are unreachable by screen reader).

**Above-7 grades are recorded but emit no findings.** Grades of `6/10` are borderline — record the grade in the iteration block but emit no finding (the dimension is acceptable, not exemplary). Grades of `7/10` and above record the dimension as a positive observation (folds into the `What's done well` section when load-bearing; e.g. "type system: 9/10 — diff reuses the existing 4-tier scale; no one-off font-sizes introduced").

**AI-slop check (cross-cuts the seven dimensions).** Before scoring, scan the diff for the canonical AI-slop signals — they typically tank multiple dimensions at once and deserve an explicit callout. The canonical signal set is rendered from the shared `design-quality-rubric.ts` const (`DESIGN_QUALITY_AI_SLOP_SIGNALS`); the `plan-critic` specialist on `rubricMode: "design"` dispatches consumes the same list against plan.md so signal coverage stays identical pre- and post-build. When the diff matches **two or more** AI-slop signals, raise an additional umbrella finding under the design-quality axis (severity=required, axis=design-quality) titled `AI-slop pattern detected` that names every signal that fired. The fix is product-specific functional design thinking, not a single dimension regrade — recommend the architect re-author the affected slice's plan.md `## Frame` section with explicit user-needs reasoning.

## Common rationalizations

Cross-cutting rows for completion / verification live in `.cclaw/lib/anti-rationalizations.md`; the four rows below are design-quality-axis-specific to this gate:

| rationalization | rebuttal |
| --- | --- |
| "It's a small diff — design quality doesn't matter at this scale." | The axis is gated on surface, not diff size. A 30-line CSS change can ship a WCAG AA contrast regression that affects every page using the token. The rubric is dimension-grading, not workload-grading; small diffs simply mean fewer dimensions are exercised — grade the ones that ARE exercised, skip the rest as N/A. |
| "The user didn't ask for a design review — I'll skip the axis." | The axis is automatic when the gate fires; the user's task wording is the *trigger*, not the *gate*. `/cc add a button to the dashboard` IS a design surface; the design-quality axis fires whether or not the user said the word "design". |
| "Accessibility is the user's responsibility — I just ship the visual design." | NO. WCAG AA is a baseline, not an opt-in. Below-6 accessibility grades escalate to `required` automatically (one tier above the standard `consider` ladder); below-2 grades are `critical`. The reviewer ships the gate, the builder ships the fix. |
| "I'll grade everything 7/10 to avoid emitting findings — the diff is fine." | NO. Grades are **dimension-grounded**, not vibe-grounded — every grade carries an explicit `what a 10 looks like` reference that anchors the call. A reviewer who silently calibrates 7/10 to "no findings emitted" reintroduces the AI-slop failure mode the axis was designed to catch. Grade honestly; if every dimension genuinely lands 7+, the artifact section is short and that's correct. |

## Red flags

- A diff with ≥2 AI-slop signals firing (e.g. 3-column feature grids + decorative gradients + uniform border-radius) — umbrella severity=required finding "AI-slop pattern detected".
- Accessibility grade ≤5/10 — severity=required (escalated one tier above the standard `consider` floor).
- Accessibility grade ≤2/10 — severity=critical (blocks ship in every ceremonyMode).
- Any dimension graded without a `what a 10 looks like` reference — the grade itself is the failure mode; re-grade with the explicit anchor.
- Every dimension landing 7/10 on a diff with visible AI-slop signals — the reviewer is silently calibrating; re-walk with honest grading.

## Worked example

```markdown
### Design-quality axis

- visual hierarchy: 4/10 — it's a 4 because the page has five distinct heading sizes with no clear primary action; the eye lands nowhere. A 10 would have one clear H1, two H2s max per viewport, and the primary action visually elevated (size / weight / color contrast). Cite: `src/components/dashboard/Page.tsx:23-45`.
- accessibility (WCAG AA): 2/10 — it's a 2 because the "Submit" button has no visible label (icon-only) AND no aria-label; screen readers announce it as "button". A 10 would have aria-label="Submit request" AND visible text OR a tooltip with an explicit role. Cite: `src/components/dashboard/SubmitButton.tsx:14`.
- ... (other five dimensions graded similarly)

F-15 design-quality/critical — `src/components/dashboard/SubmitButton.tsx:14` — accessibility (WCAG AA) graded 2/10 — icon-only Submit button has no aria-label; screen-reader-unreachable. A 10 would have aria-label="Submit request" plus visible text OR an explicit tooltip role.
→ Recommended fix: add `aria-label="Submit request"` to the icon button OR add a visible label adjacent to the icon. Builder fix-only on the button surface only.
```
