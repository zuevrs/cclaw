---
name: qa-and-browser
trigger: when stage = qa (the qa-runner dispatch); when triage.surfaces includes "ui" or "web" AND ceremonyMode != "inline"; on build when the slug touches UI files (*.tsx, *.jsx, *.vue, *.svelte, *.html, *.css) and the project ships a browser app (so the slice-builder can pre-commit a Playwright test before qa runs); on review when the diff includes any UI file (so the reviewer's qa-evidence axis cross-checks qa.md)
---

# Skill: qa-and-browser

The reviewer walks the diff. The page renders on a screen. They are **different reviews** — a diff can be flawless and the page can ship with a runtime error, a layout regression, or a missing toast that the diff never predicted.

> "Tests green" is not "page works". This skill closes that gap.

It is the sibling of `debug-and-browser.md`. The two split cleanly:

- `debug-and-browser.md` — **diagnostic** discipline (stop-the-line, ranked hypotheses, cheapest reproduction loop, tagged debug logs). Runs when something is *broken* on a live system.
- `qa-and-browser.md` (this skill) — **acceptance** discipline (per-UI-AC evidence, browser-tool hierarchy, evidence-tier rubric, manual-step fallback). Runs when something is *supposed to work* on a live system and we need proof.

## When NOT to apply

- **`triage.surfaces` does not include `"ui"` or `"web"`.** CLI / library / API / data / infra / docs-only slugs skip qa entirely. The orchestrator gates on surface detection at Hop 2; the qa stage does not run.
- **`triage.ceremonyMode == "inline"`.** Trivial / one-shot slugs skip qa even on UI surface (the cost of a structured qa pass eats the inline budget). The reviewer's `qa-evidence` axis is also skipped on inline.
- **The diff is pure-prose / docs-only** with no rendered output. There is nothing to QA; the regular diff review is sufficient.
- **The slug is `refines: <prior-slug>` and the prior slug shipped with `qa.md > verdict: pass`** AND the refines diff does not touch any UI file. The prior evidence stands; the orchestrator does not re-run qa for an internal refactor.
- **Stop-the-line debugging mid-build.** That is `debug-and-browser.md`'s job; the qa stage runs *after* build completes green, not during a broken build.

## Browser tool hierarchy

The qa-runner picks the **strongest available** tier and records it in `qa.md`'s frontmatter as `evidence_tier`. The reviewer's `qa-evidence` axis treats the tier as a quality signal: `playwright > browser-mcp > manual`.

### Tier 1 — Playwright MCP (or `@playwright/test` directly)

> Preferred when available. Deterministic, machine-verifiable, re-runs in CI.

- The qa-runner authors a `tests/e2e/<slug>-<ac>.spec.ts` for each UI AC, commits it, runs it via `npx playwright test`, and pastes the **exit code + last 3 lines of stdout** into `qa.md > Per-AC evidence`.
- Pass criterion: exit code 0; every assertion in the spec covers a behavioural clause from the AC (not a snapshot of incidental UI state).
- The spec stays in the suite as a regression guard after the slug ships. This is the canonical reason this tier wins: every other tier produces evidence that ages out the moment the next slug merges.
- If the project does not already ship Playwright, the qa-runner does NOT npm-install it as a side effect — it surfaces the gap as a `blocked` finding and asks the user to opt in to a follow-up "add Playwright to the project" slug. Silently growing the dependency footprint is `A-edit-discipline` reviewer-territory.

### Tier 2 — Browser MCP (`cursor-ide-browser`, `chrome-devtools`, `browser-use`, …)

> Fall back when Playwright is not available (or the AC is too exploratory to script reliably).

- The qa-runner drives the running dev server through the available browser MCP (`browser_navigate` → `browser_snapshot` / `browser_take_screenshot` → interaction → re-snapshot).
- Evidence captured: screenshots saved under `flows/<slug>/qa-assets/<ac>-<n>.png`, plus a one-paragraph **observations** block per AC describing what was clicked, what rendered, what was inspected (console / network / a11y).
- The qa-runner picks ONE MCP per session and records its name in the `qa.md` header so future audits know which tool produced the artefacts. Detection order (mirrors `debug-and-browser.md > Phase 1`):
  1. `cursor-ide-browser` (Cursor harness)
  2. `chrome-devtools` (Claude Code / OpenCode harness)
  3. `browser-use` (general-purpose web automation MCP)
  4. `playwright` / `puppeteer` driven via Bash when none of the above are exposed as MCPs but the harness allows the qa-runner to script them
- Pass criterion: every UI AC has at least one screenshot + observations row; the row's `Status` column reads `pass` only when the observed behaviour matches the AC's behavioural clause verbatim.

### Tier 3 — Manual steps with screenshots described

> Last resort. Used only when no browser tool is available AND the user has not unblocked a Playwright install.

- The qa-runner writes a numbered **manual QA steps** block in `qa.md` (`1. Open <url>. 2. Click <selector>. 3. Expect <observation>. …`).
- Verdict is `blocked` until the user confirms each step. The orchestrator surfaces the block as part of the verdict picker (`pause-for-manual-qa` arm).
- The qa-runner records `evidence_tier: manual` in the frontmatter; the reviewer's `qa-evidence` axis flags this as a `fyi`-or-`required` quality concern (it is the weakest tier and warrants follow-up).

The qa-runner **must never silently downgrade tiers**. If Playwright is technically available (a `package.json` script exists) but the qa-runner did not invoke it, the reviewer's `qa-evidence` axis fires a `required` finding citing the missed tier.

## Evidence required (one per UI AC)

For every AC whose `surface` includes `"ui"` or `"web"`, `qa.md` must contain **one** of the following in its `Per-AC evidence` section. No exceptions.

1. **Playwright test that runs in CI.** Path to the committed `.spec.ts` + last-run exit code + last-3-lines-of-stdout. Machine-verifiable, re-runnable, the canonical pass.
2. **Recorded browser interaction with screenshots / observations.** Path to one or more screenshots in `flows/<slug>/qa-assets/` + a paragraph describing the interaction + the observed result. Reviewable but session-bound.
3. **Manual QA steps block** with explicit `Status: pending-user`. The user must confirm before the verdict can flip from `blocked` to `pass`. Lowest tier; reserved for the harness-no-browser-tools degraded path.

Each row in `Per-AC evidence` follows the template in `qa.md > Per-AC evidence`:

```
### AC-N: <ac summary>
- Surface: <ui | web | mixed: ui+api | …>
- Verification: <playwright | browser-mcp | manual>
- Evidence: <test file path + exit code + last log lines | screenshot path + observations | numbered manual steps>
- Status: <pass | fail | pending-user>
```

`Status: pass` requires the evidence to ACTUALLY show the AC's behavioural clause met. A screenshot of "the page loaded" when the AC says "user sees toast after submitting form" is NOT pass — that screenshot satisfies "page loaded", not "toast appeared".

## Pre-commitment predictions

Before running any verification step, the qa-runner writes **3-5 things that might fail** in a `## Pre-commitment predictions` block. The act of predicting in writing forces real verification later (vs the rationalisation "I expected it to work, so I did not check"). The reviewer's `qa-evidence` axis verifies the block is present and non-trivial when `evidence_tier != playwright` (Playwright specs are themselves predictions in executable form).

This mirrors the plan-critic's pre-implementation predictions pattern: predictions made before the work activate real testing afterwards.

## Anti-rationalizations (referenced, not duplicated)

The catalog lives in `.cclaw/lib/anti-rationalizations.md`; this skill cites the relevant rows under the `verification` and `completion` categories. The qa-runner cites the catalog by id; it does NOT inline the rebuttal prose.

Specific rationalisations this skill closes:

- **"I'll just check it visually."** No — evidence in `qa.md`. The orchestrator does not see your screen.
- **"Playwright is overkill for this small change."** If the AC says "user sees X" or "user can do Y", evidence is required. The cost of a 15-line spec is one review iteration; the cost of skipping it is a production regression nobody catches.
- **"The CSS change can't possibly break anything."** Still verify rendering. CSS changes silently break responsive layouts, dark-mode contrast, focus rings, and print stylesheets. The five-check pass is cheap; reasoning about CSS is expensive.
- **"The component is unchanged; only the prop default flipped."** A flipped prop default IS a UI behaviour change. Re-run the page with the new default; the old screenshot does not generalise.
- **"I tested it locally last week."** Last week's local run is not evidence; today's CI run is. Re-run.

When the qa-runner cites one of these rebuttals in `qa.md`, the format is:

```
- AC-3 evidence: Playwright spec at `tests/e2e/toast-after-submit.spec.ts`, exit code 0, 3 assertions passed (rebuttal: "I'll just check it visually" — anti-rationalizations.md > verification).
```

## qa-runner artifact contract

The qa-runner produces exactly one `qa.md` per dispatch. The template lives in `.cclaw/lib/templates/qa.md`; the structural sections are:

1. **Frontmatter** — `specialist: qa-runner`, `verdict: pass|iterate|blocked`, `evidence_tier: playwright|browser-mcp|manual`, `dispatched_at: <iso>`, `surfaces: [ui, web, …]`.
2. **Surfaces under QA** — the UI surface list copied from `triage.surfaces` for cross-reference.
3. **Per-AC evidence** — one block per UI-tagged AC, following the row template above.
4. **Pre-commitment predictions** — 3-5 things that might fail, written *before* verification ran.
5. **Findings (failures only)** — F-N rows for any AC whose `Status` is `fail`. Severity matches the reviewer's vocabulary (`required` / `fyi`).
6. **Verdict** — `pass` / `iterate` / `blocked` + one-paragraph rationale.
7. **Hand-off** — `for iterate: what slice-builder must fix`; `for blocked: what user must do manually`.

The slim summary returned to the orchestrator carries the verdict + evidence_tier + a one-line rationale; the orchestrator stamps `qaVerdict` / `qaEvidenceTier` / `qaIteration` / `qaDispatchedAt` on flow-state.

## Verdict semantics

- **`pass`** — every UI AC has evidence at `Status: pass`. Advance to review. The reviewer's `qa-evidence` axis re-reads `qa.md` and cross-checks each row against the diff.
- **`iterate`** — at least one UI AC has `Status: fail` AND the qa-runner can articulate what would make it pass. Bounce to slice-builder with `qa.md > Hand-off` as the additional context. **Hard-capped at one iterate** (`qaIteration: 0 → 1`); a second iterate surfaces the user picker instead of running qa a third time.
- **`blocked`** — no browser tools available AND/OR a UI AC requires manual user action the qa-runner cannot script. Surface the user picker (`proceed-without-qa-evidence` / `pause-for-manual-qa` / `skip-qa`). `blocked` is a real verdict — the qa-runner does NOT pretend qa ran; it records honestly that it could not.

## Composition

- **slice-builder (stage: build)** reads this skill as encouragement to commit a Playwright test alongside the AC implementation. When the AC's `touchSurface` includes UI files AND `package.json` already ships Playwright, the slice-builder authors the spec in GREEN and notes its path in `build.md > Verification`. The qa-runner then re-runs that spec rather than re-authoring it.
- **qa-runner (stage: qa)** reads this skill for the full discipline: tier hierarchy, evidence rubric, pre-commitment predictions, verdict semantics. The artifact contract is the source of truth for `qa.md`'s shape.
- **reviewer (stage: review)** reads this skill to evaluate the `qa-evidence` axis. For any AC with UI surface, the reviewer expects a matching `qa.md > Per-AC evidence` row with `Status: pass`; missing or failing rows fire `required` findings on the axis.

## Hard rules

- **Evidence required for every UI AC.** "I'll just check it visually" is not evidence — see the rebuttal above.
- **Use the strongest tier available.** Playwright > browser-MCP > manual; silent downgrades are reviewer-territory.
- **Pre-commitment predictions before verification.** 3-5 things that might fail, written first.
- **`blocked` is a real verdict.** Never fake a `pass` when the qa-runner could not actually verify.
- **Hard cap at one iterate.** Oscillation between slice-builder and qa-runner is a flow-budget leak; the user picker is the right escape hatch.
