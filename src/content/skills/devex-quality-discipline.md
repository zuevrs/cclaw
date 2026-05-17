---
name: devex-quality-discipline
trigger: devex surface detected — auto-on at the plan stage when triage.devexSurface is true OR triage.surfaces ∩ {cli, library, api} ≠ ∅
---

# Skill: devex-quality-discipline

cclaw's developer-experience (DevEx) lens fires once on any slug whose triage flagged an SDK / API / CLI / library / public-interface surface: at plan-time via the **plan-devex specialist** (v8.82 — walks plan.md against a six-dimension DevEx rubric BEFORE the build runs). Single source of truth lives at `src/content/devex-quality-rubric.ts`, exporting the six dimensions, "what a 10 looks like" anchors, and the AI-slop signal set; the prompt renders the same markdown via `renderDevexQualityRubricTable()` / `renderDevexQualityAiSlopChecklist()`.

This skill spells out **how to use the rubric well**. It is auto-on at the `plan` stage (plan-devex); a missing devex surface gate at plan-time structurally skips the specialist (and this skill).

## When to apply

- **plan-devex (v8.82) dispatch:** `triage.devexSurface == true` OR `triage.surfaces ∩ {cli, library, api} ≠ ∅`; AND `triage.ceremonyMode ∈ {soft, strict}`; AND `flows/<slug>/plan.md` exists.

## When NOT to apply

- UI / data / infra / docs / config slugs without developer-facing API surface (the devex gate fails — no public interface exists to grade; plan-devex is structurally skipped).
- `triage.ceremonyMode == "inline"` (no plan.md exists; the gate forbids inline dispatch).
- A slug where the diff touches a developer surface but the public contract is unchanged (e.g. an internal refactor that does NOT cross an `export` boundary, a CLI command-handler reorganization that keeps every flag identical) — plan-devex grades the dimensions that ARE exercised and N/A the rest with one-line reasons rather than fishing for findings.

## The six dimensions (canonical names)

| key | name |
| --- | --- |
| getting-started | getting started (TTHW) |
| api-ergonomics | API ergonomics |
| error-messages | error messages |
| docs | docs |
| upgrade-path | upgrade path |
| measurement | measurement |

Full "what a 10 looks like" anchors live in `src/content/devex-quality-rubric.ts > DEVEX_QUALITY_DIMENSIONS`. The plan-devex prompt embeds the table verbatim via the shared renderer — do not redefine the rubric in any other place.

## Process

- **Grade 0-10 per dimension; below-6 becomes a finding.** Above-7 is acceptable; 6 is borderline (recorded but emits no finding). 7+ records the dimension as a positive observation.
- **Pre-commitment is mandatory.** Before reading plan.md in detail, write 3-5 predictions of which dimensions are most likely to grade below 6 (e.g. "getting-started will under-scope first-run env vars" / "error-messages will lack failure-mode anchors"). After writing predictions, walk the rubric and verify each prediction (`confirmed` / `refuted` / `partial`). Never delete a refuted prediction — refutation is information.
- **Severity ladder.** plan-devex: 5/10 → `low`, 4/10 → `medium`, ≤3/10 → `high`.
- **Getting-started escalates one tier.** Time-to-Hello-World is load-bearing for adoption; below-6 grade ⇒ severity ≥ `medium` minimum (one tier above the standard ladder); ≤2 grade ⇒ `high` regardless of ceremonyMode.
- **Upgrade-path caps at high on breaking changes.** When the plan introduces a breaking change (rename / remove / signature change on a public export), upgrade-path findings cap at `high` regardless of ceremonyMode — the architect carrying a breaking change without a migration plan is a high-severity gap by construction.
- **AI-slop umbrella.** When ≥2 signals from `DEVEX_QUALITY_AI_SLOP_SIGNALS` fire on the same plan, emit a single umbrella finding `DX-N` with severity `medium` (default in strict; one tier down in soft). The fix is concrete DevEx thinking — recommend rewriting Frame / Decisions with explicit developer-need reasoning (who imports this, what they type first, what error they see when they typo it).

## Block-ship semantics

- **plan-devex strict mode:** any `DX-N` with severity ≥ `medium` blocks ship (the v8.82 block-ship-on-strict floor). Soft mode surfaces but does not block; ≥2 `high` rows surfaces a stop-and-report status block.
- **User Sovereignty preserved:** the user can override via the stop-and-report status block (`/cc` to continue with findings open; `/cc-cancel` to discard). The specialist NEVER silently downgrades a finding to avoid blocking.

## Hard rules

- **NEVER silently downgrade getting-started.** Below-6 grade ⇒ severity ≥ `medium` (one tier above the standard ladder); ≤2 grade ⇒ `high` regardless of ceremonyMode. TTHW is the adoption gate; the specialist surfaces, the user decides.
- **NEVER skip pre-commitment after reading the plan.** Predictions written AFTER detailed reading are post-hoc rationalizations, not predictions. The discipline activates deliberate search; collapsing the ordering loses the signal.
- **NEVER relitigate the architect's API direction.** plan-devex catches **missing commitments** (no error strategy, no migration plan, no measurement hook), NOT alternatives the architect already considered. Alternatives go in Notes (slim summary), never as a finding.
- **NEVER mark a dimension N/A without citing which dimension and why.** N/A is acceptable when the plan does not exercise the dimension (e.g. a CLI flag addition does not exercise upgrade-path when no existing flag changed); the skip MUST name the dimension and one-line the reason.
- **NEVER ship a `DX-N` row without a `Cite:` anchor.** Every finding cites `plan.md > §section` or a `file:line` from the filebag. Hand-waving is forbidden; a finding without an anchor is dropped.

## Common rationalizations + rebuttals

| rationalization | rebuttal |
| --- | --- |
| "Getting started is the user's responsibility — I'll grade it 6 to avoid blocking." | NO. TTHW is the load-bearing adoption gate for any developer surface. Below-6 grade automatically escalates to `medium` minimum (one tier above the standard ladder); below-2 is `high` regardless of ceremonyMode. Surface the gap; the user can still override via stop-and-report. |
| "The plan reads fine on first pass; every dimension grades 7+." | First-read 7+ on every dimension without the rubric walked is sycophancy. Plans almost always under-scope error messages and upgrade-path; uniform 7+ grades mean you skipped the rubric. Re-read with focused attention on error-messages + upgrade-path specifically. |
| "There is no breaking change, so upgrade-path is N/A." | Sometimes correct, often not. A NEW public method that displaces an existing internal helper still has a migration story (who currently typed the internal name, what do they type now). N/A only when no existing caller path is plausibly affected; otherwise grade against the migration anchor. |
| "Measurement is product analytics, not my job." | NO. plan-devex's measurement dimension grades whether the plan instruments **its own** usage so the team learns what shipped (rollout counter, error-rate hook, deprecation log on the old path). A plan with no measurement loops back to "did this fix the developer-experience problem?" with no data — that is a below-6. |
| "I'd design the API differently — let me suggest an alternative as a finding." | Out of scope. plan-devex catches missing commitments in the plan as written; the architect chose the API direction. Surface alternatives as Notes in the slim summary if genuinely important — do NOT file as a finding. |

## Cross-reference

- Shared rubric source of truth: `src/content/devex-quality-rubric.ts`.
- plan-devex specialist contract: `.cclaw/lib/agents/plan-devex.md`.
- Runbook (gating + dispatch + verdict routing): `.cclaw/lib/runbooks/critic-steps.md > Plan-devex pass`.
