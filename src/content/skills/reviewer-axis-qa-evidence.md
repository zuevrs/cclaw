---
name: reviewer-axis-qa-evidence
trigger: gated reviewer axis. Loads only when the qa gate fired — `walkQaEvidenceAxis: true` on the dispatch envelope, OR `triage.surfaces` ∩ {`ui`, `web`} ≠ ∅ AND `ceremonyMode != "inline"`. Structurally skipped on every other slug.
---

# Skill: reviewer-axis-qa-evidence

Full rubric, evidence-collection guidance, severity ladder, and anti-rationalizations for the reviewer's `qa-evidence` axis (keyed off slice `Surface` for UI gating + AC for evidence rows). Lifted out of `reviewer.ts` — the prompt now carries only a 5-line stub pointing here.

The `qa-evidence` axis is the ex-post cross-check of the qa-runner's per-criterion evidence rows in `flows/<slug>/qa.md` against the actual diff. It is gated: the axis fires only when the orchestrator dispatched qa-runner (i.e. `triage.surfaces` ∩ {`ui`, `web`} ≠ ∅ AND `ceremonyMode != "inline"`).

## When to use

Load this skill when the reviewer dispatch envelope carries `walkQaEvidenceAxis: true`, OR when `triage.surfaces` ∩ {`ui`, `web`} ≠ ∅ AND `ceremonyMode != "inline"`. The orchestrator stamps `walkQaEvidenceAxis: true` onto the reviewer dispatch envelope (per `start-command.md > Review hop`) when the surface gate fires; the envelope's flag is the runtime source of truth. The orchestrator looks up the envelope shape in `runbooks/dispatch-skills-index.md` and pastes the gate-resolved skills-pointer slice into the envelope's `Active skills (per envelope):` field — when this skill's flag is set, the pointer is included in the slice and the reviewer sub-agent loads the body below; when it is absent, the pointer is omitted from the slice (even though the static superset in `agents/reviewer.md` still lists it). The axis walks the diff, identifies every UI-tagged AC, and cross-references each one against `qa.md > §4 Per-AC evidence`. (this paragraph claimed the orchestrator calls `buildAutoTriggerBlock("review", { walkQaEvidenceAxis: true, ... })` at dispatch time; that was tests-only fiction. The function is called at INSTALL time by the dispatch-skills-index runbook composer; the runtime dispatch carries the rendered slice, not a function call.)

## When NOT to apply

- The qa gate did not fire (no UI / web surface, or `ceremonyMode: inline`) — the axis is structurally skipped; emit zero findings; note "qa-evidence: skipped (no qa gate)" in the iteration block. The skill is not pinned to the dispatch envelope.
- The qa gate fired but the user picked `[skip-qa]` at the blocked picker — the axis fires a single `fyi` finding citing the user override and stops; do not synthesize per-criterion findings on top of the user's deliberate skip.
- The qa gate fired and the qa-runner returned `iterate` (currently iterating with builder fix-only) — the axis is **deferred** to the next reviewer iteration after qa-runner re-runs; emit zero findings this iteration, note "qa-evidence: deferred (qa iterate in flight)".
- A slug whose triage flagged design-only surfaces (`{design, frontend, ux}`) without `ui` / `web` — the `design-quality` axis covers the visual / interaction pass; do not double-charge findings under qa-evidence.

## Process

**Sub-check 1 — Per-UI-AC evidence row present.** For each UI-tagged AC (an AC whose `touchSurface` includes `*.tsx` / `*.jsx` / `*.vue` / `*.svelte` / `*.astro` / `*.html` / `*.css`), locate the matching row in `qa.md > §4`. The row must:

1. Cite the correct AC id (`### AC-N: <ac summary>`).
2. Carry a `Surface:` line listing at least one UI surface (`ui` / `web` / `mixed: ui+api` etc).
3. Carry an `Evidence:` block whose content matches the declared `Verification:` tier:
   - For `Verification: playwright` — a path to a committed `.spec.ts` file, an exit code (must be 0 for Status=pass), and the last 3 lines of stdout.
   - For `Verification: browser-mcp` — at least one screenshot path under `flows/<slug>/qa-assets/<ac>-<n>.png` AND an observations paragraph naming what was clicked, what rendered, what was inspected.
   - For `Verification: manual` — a numbered `Manual QA steps` block whose steps cite explicit URLs / selectors / expected observations (not "the dashboard" / "the button").
4. Carry a `Status:` line whose value is `pass` / `fail` / `pending-user`.

A missing row — or a row whose evidence content does not match the declared verification tier — is a **qa-evidence finding (severity=required)**. Cite the AC id, the missing-or-malformed row, and recommend the qa-runner fix (when the qa gate iteration cap is not exhausted) OR the builder remediation (when the user picked `accept-warnings-and-proceed-to-review` and the qa pass is closed).

**Sub-check 2 — Status=pass requires verbatim behavioural match.** For each UI-tagged AC whose qa.md row reads `Status: pass`, cross-check that the evidence ACTUALLY shows the AC's behavioural clause met. A "page loaded" screenshot does NOT satisfy "user sees toast after submit"; a Playwright spec whose only assertion is `expect(page.url()).toContain("/invites")` does NOT satisfy "the invites list re-fetches on Refresh click". The evidence must cite the AC's verb verbatim:

- AC says "user sees X" → evidence must show X visible (screenshot with X annotated; Playwright `expect(page.locator("text=X")).toBeVisible()`; manual step "3. Expect X to appear within 1s").
- AC says "user clicks Y and Z happens" → evidence must capture both the click AND Z.
- AC says "the form submits" → evidence must show the submit completion (success toast, redirect, network 200), not just the click on Submit.

A `Status: pass` row whose evidence does NOT capture the AC's verb is a **qa-evidence finding (severity=required)** with the contradiction described. Recommended fix: qa-runner re-runs with stronger evidence, OR the AC needs to be re-scoped (a plan amendment, not a silent acceptance).

**Sub-check 3 — Evidence tier escalation.** Read `qa.md > frontmatter > evidence_tier` and cross-check it against project capabilities:

- If `evidence_tier == "manual"` but `package.json` ships `@playwright/test` or a `test:e2e` script: this is a **silent tier downgrade**. The qa-runner could have authored a Playwright spec but did not; the manual evidence is the weakest tier. **qa-evidence finding (severity=required)** with the missed tier called out. Recommended fix: qa-runner re-runs with Tier 1; this is the canonical "no excuse to skip Playwright when it's already there" gate.
- If `evidence_tier == "browser-mcp"` but the harness's MCP catalog included `@playwright/test` access at qa-runner dispatch time: same finding, same severity.
- If `evidence_tier == "manual"` AND no browser tools were available AND no Playwright in the project: this is the **legitimate degradation** path. The axis fires a `fyi` finding (not `required`) noting that the weakest tier was used and recommending a follow-up "add Playwright" slug. Manual-tier evidence with `pending-user` status is honest; manual-tier evidence with `pass` requires the user's explicit confirmation in qa.md (a free-text confirmation paragraph, dated and signed in the artifact body).

## Common rationalizations

Cross-cutting rows for verification / completion live in `.cclaw/lib/anti-rationalizations.md`; the three rows below are qa-evidence-axis-specific to this gate:

| rationalization | rebuttal |
| --- | --- |
| "But the AC was so small, a Playwright spec is overkill — manual was fine." | Tier selection is about evidence durability, not diff size. A 15-line Playwright spec stays in CI as a regression guard for every future slug; a screenshot dated today is irrelevant by next slug. When Tier 1 is available, Tier 1 is the only correct pick — diff size is not a tier-downgrade rationale. (Same row as `qa-and-browser.md` anti-rationalization #2.) |
| "But the manual steps were confirmed by the user — that's stronger than a Playwright spec." | User confirmation is point-in-time. The next slug that lands on the same UI surface has no way to re-confirm without re-asking the user. Playwright re-runs in CI on every PR; that durability is what the axis tier ranks for. User-confirmed manual evidence is acceptable when no automation is available; it is NOT a substitute for Playwright when Playwright is available. |
| "But qa.md frontmatter says `verdict: pass` — why are you firing findings?" | The qa-runner's verdict is its own slim-summary call; the reviewer's qa-evidence axis is the **independent cross-check** that the evidence rows actually substantiate that verdict. A `verdict: pass` with a `Status: fail` row in §4 is a self-contradicting artifact; the reviewer's job is to surface the contradiction, not to defer to the qa-runner's verdict on faith. |

## Red flags

- `qa.md` missing entirely on a slug whose `triage.surfaces` includes `ui` or `web` — severity=critical (axis=qa-evidence). The qa stage should have run.
- A UI-tagged AC with no row in `qa.md > §4 Per-AC evidence` — severity=required.
- `Status: pass` whose evidence cites only a "page loaded" screenshot or a URL-containment assertion when the AC says "user sees X" or "Z happens after Y" — severity=required.
- `evidence_tier: manual` in `qa.md` frontmatter while `package.json` ships `@playwright/test` — severity=required (silent tier downgrade).
- A screenshot path cited in qa.md that does not exist on disk under `flows/<slug>/qa-assets/` — severity=required.

## Worked example

```markdown
F-9 qa-evidence/required — AC-2 — `qa.md > §4` row for AC-2 reads `Status: pass` but the Evidence block cites only `await page.goto("/invites"); await expect(page).toHaveURL(/invites/);` — that does NOT satisfy AC-2's "the invites list re-fetches when the user clicks Refresh". The verb (`click Refresh` + `list re-fetches`) is uncovered.
→ Recommended fix: qa-runner re-runs with `await page.getByRole("button", { name: "Refresh" }).click(); await expect(page.locator("[data-testid=invite-row]")).toHaveCount(N + 1);` (or equivalent re-fetch verification). OR re-scope AC-2 via plan amendment.
```
