---
name: reviewer-axis-nfr-compliance
trigger: gated reviewer axis. Loads only when `flows/<slug>/plan.md` contains a **non-empty** `## Non-functional` section. Silently skipped on legacy plans and on slugs whose architect did not author NFRs — never synthesize budgets from external defaults.
---

# Skill: reviewer-axis-nfr-compliance

Full gating rule + cross-check protocol for the reviewer's `nfr-compliance` axis. Lifted out of `reviewer.ts` in the v8.83 release — the prompt now carries only a 5-line stub pointing here.

The `nfr-compliance` axis fires only when `flows/<slug>/plan.md` contains a non-empty `## Non-functional` section. When the section is empty, absent, or contains only `none specified` rows across every NFR, the axis emits zero findings — the reviewer does not synthesize budgets, does not check against external defaults, and does not warn that NFRs were not authored. The gating is intentional: NFR authoring is an architect Frame-phase decision, not a reviewer responsibility, and forcing the reviewer to invent NFRs on plans that didn't author them creates false positives.

## When to use

Pinned to the reviewer's dispatch envelope when `flows/<slug>/plan.md` carries a non-empty `## Non-functional` section. The orchestrator inspects the plan at dispatch time and passes `planHasNonFunctional: true` to `buildAutoTriggerBlock("review", env)`; the skill is rendered only then. The reviewer's prompt body has a 5-line stub naming this skill; the full per-row cross-check protocol lives here.

## When NOT to apply

- `## Non-functional` section absent or empty — axis skipped silently; emit zero findings. Note "nfr-compliance: skipped (no NFRs declared)" in the iteration block.
- All rows in the section are `none specified` — same as absent; skip silently.
- The NFR's anchor is unrelated to the diff (the diff touches docs only and every NFR row is a runtime budget) — axis fires the gate but emits zero findings; note "nfr-compliance: gate fired but no diff overlap" in the iteration block.
- Legacy plan.md files without a `## Non-functional` section at all — explicitly tolerated; skip the axis silently and do NOT flag the absence as a finding.

## Process

**Reading the section.** Treat the `## Non-functional` section as the authoritative budget set. Each row in that section is structured: a name (`performance` / `compatibility` / `accessibility` / `security`), a measurable budget (e.g. `p95 < 250ms` / `node>=20` / `WCAG AA contrast`), and an evidence pointer (a benchmark command, a typecheck flag, an a11y test). The reviewer's job is to match every diff against the budget — not to invent new budgets.

**Per-NFR-row scoring (when the section is non-empty):**

- **performance** — every NFR row that names a latency or throughput budget is matched against the diff's hot-path changes. If the diff touches code on a path mentioned in the row's anchor and the change is not paired with a benchmark commit or a measured numbers row in `build.md`, raise a finding (severity=required when the budget is hard; severity=consider when soft).
- **compatibility** — version-pin rows (Node version, browser baseline, OS minimum) are matched against any new API the diff introduces. An API that requires a newer runtime than the pin is severity=required (axis=nfr-compliance, cross-axis=architecture if the user's stack pre-dates the requirement).
- **accessibility** — WCAG row matches every `*.tsx` / `*.jsx` / `*.vue` / `*.svelte` / `*.css` change. A diff that introduces a contrast regression, a missing aria-label, or a non-keyboard-reachable control is severity=required (cross-axis with `design-quality` when that axis is also gated).
- **security** — security baseline rows (TLS, secret rotation cadence, dep provenance) are matched against the security axis's findings; an NFR-row violation is severity=required and cross-references the security axis's specific finding F-N.

**Finding shape.** Every nfr-compliance finding carries the NFR row text verbatim in the description plus the file:line of the violation. Example: `F-7 nfr-compliance/required — src/api/search.ts:88 — NFR row "performance: p95 < 250ms on /api/search" — new ranking pass adds a synchronous embedding lookup; no benchmark commit landed and the build log shows no perf row. Recommend: run the existing benchmark harness (npm run bench:search) and either land a numbers row OR refactor to async lookup.`

**Slim counter exclusion.** `nfr-compliance` is intentionally excluded from the slim-summary axes counter (`c=N tq=N r=N a=N cb=N s=N p=N ed=N qae=N dq=N`) — it is a gated axis; when it fires, name the violated NFR row inline in the `What changed` line instead.

## Common rationalizations

| rationalization | rebuttal |
| --- | --- |
| "But the plan didn't author NFRs — I should warn the user." | NO. NFR authoring is the architect's Frame-phase responsibility, not the reviewer's. Silently skipping is the correct call; surface the absence as a separate architect-pass concern (axis=architecture, severity=consider) only when the slug clearly needed NFRs (e.g. a perf-sensitive feature with no perf row). Do NOT synthesize budgets from external defaults — that is exactly the false-positive failure mode the gate exists to prevent. |
| "But this NFR is obviously implied — every web app needs WCAG AA." | NO. If the NFR is not in the section, the axis does not fire on that dimension. Implied budgets are a reviewer rationalization. The fix is a plan amendment authored by architect that adds the row explicitly; once the row lands, the axis fires the cross-check. |
| "But the benchmark anchor is just a guideline, not a hard budget." | If the NFR row reads `p95 < 250ms`, that is a hard budget. Severity defaults to `required` for hard numeric budgets; downgrading to `consider` requires the architect to explicitly mark the row as soft (e.g. `p95 < 250ms (soft)`). Do not unilaterally re-grade the budget. |

## Red flags

- A `## Non-functional` row whose budget is numeric AND the diff touches the anchored code path AND no benchmark commit / numbers row is paired with the change — severity=required.
- A WCAG AA row whose anchor matches the diff AND the diff introduces a contrast regression / missing aria-label / non-keyboard-reachable control — severity=required (cross-axis with design-quality).
- A compatibility row pinning `node>=20` AND the diff introduces an API that requires `node>=22` — severity=required.
- A security baseline row that the security axis's findings already match — cross-reference the F-N rather than duplicating.

## Worked example

```markdown
F-11 nfr-compliance/required — src/api/search.ts:88 — NFR row "performance: p95 < 250ms on /api/search" — new ranking pass adds a synchronous embedding lookup at line 88; no benchmark commit landed and `build.md`'s perf row shows no measurement.
→ Recommended fix: builder fix-only — run `npm run bench:search`, capture the numbers row in `build.md`, AND either confirm the new code meets the budget OR refactor the embedding lookup to async + cache.
```
