---
name: structured-status
trigger: every builder slim-summary write (strict mode: at every slice boundary; soft mode: at end-of-feature). Auto-fires on `stage:build`, `specialist:builder`, and before any builder dispatch return.
---

# Skill: structured-status

The builder runs in a long sub-agent loop and emits its outcome via a slim-summary block the orchestrator reads. Without a structured status token, the orchestrator has to infer intent from prose ("Notes: SL-3 deferred — surface conflict" — is that a soft warning or a hard stop?). Inference is fragile; cclaw's always-auto chain treats every `/cc` as a chance to advance the flow unless a hard gate fires, which means an ambiguous slim summary is the worst possible output: the orchestrator silently chains forward on work that wasn't done.

This skill codifies the four canonical builder statuses — `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` — and pins one deterministic orchestrator handler to each. The vocabulary mirrors the obra-superpowers subagent-driven-development protocol (`./SKILL.md` § "Handling Implementer Status") so cclaw's per-slice loop reads the same way as the reference implementer pattern.

## When to use

Always-on for the builder specialist. The status line is **mandatory** on every builder slim summary, in every mode:

- **strict mode** — one status per slice (emitted at the slice boundary inside the per-slice JSON `self_review` block) AND one status for the whole dispatch (emitted at the top of the slim summary). Per-slice statuses drive the per-slice review loop (see `subagent-driven-development.md` two-stage pattern); the dispatch-level status drives the orchestrator's chain decision.
- **soft mode** — one status for the whole feature (the single TDD cycle is the unit of work). Emitted at the top of the slim summary.
- **inline mode** — not dispatched; the orchestrator's trivial path handles the edit directly. No status line.

The status fires at four specific moments inside the builder:

1. **At the end of every slice's per-slice review loop** (strict mode). After spec-compliance + code-quality both pass (or fail through the loop's 2-attempt cap), the builder records the per-slice status in the slice's `self_review` block before moving to the next slice.
2. **At the end of the dispatch** (every mode). The builder distils per-slice statuses into one dispatch-level status: `BLOCKED` if any slice is `BLOCKED`; otherwise `NEEDS_CONTEXT` if any slice is `NEEDS_CONTEXT`; otherwise `DONE_WITH_CONCERNS` if any slice is `DONE_WITH_CONCERNS`; otherwise `DONE`. The aggregation rule is strict (lowest-confidence wins).
3. **Mid-dispatch on a hard stop** — when the builder hits an unresolvable obstacle before completing the assigned scope (the slice the builder is on cannot proceed AND no remaining slices are independent of it), emit `BLOCKED` immediately for the dispatch. Sibling slices already settled keep their per-slice `DONE` status; the dispatch-level status is `BLOCKED`.
4. **At fix-only completion** — the same shape; the fix-only loop emits one dispatch-level status describing the fix outcome, not a fresh per-slice cascade.

## When NOT to apply

- **Non-builder specialists.** triage, architect, plan-critic, qa-runner, reviewer, critic each have their own verdict vocabulary (`pass`, `revise`, `iterate`, `block-ship`, `cap-reached`, etc.). They do NOT emit a builder status. Conflating the two would re-purpose the builder vocabulary for verdicts the orchestrator routes through different handlers; keep the vocabularies distinct per specialist.
- **Inline / trivial path.** The orchestrator handles the trivial edit itself (`triage.path == ["build"]`); no builder dispatch, no slim summary, no status.
- **Resume re-render.** When `/cc` (no args) renders a prior builder slim summary verbatim during resume, the rendered status is the prior status — the resume does not re-claim or re-derive. The status field is read-only in that surface.
- **Sub-builder under topological-layer dispatch.** A sub-builder for a single slice (envelope `parent_mode: "topological-layer"`) emits ONE per-slice status block returned to the parent builder; it does NOT emit a dispatch-level aggregated status. The parent builder aggregates across sibling sub-builders and emits the single dispatch-level status that reaches the orchestrator.

## The four statuses

Each status carries a precise meaning, a triggering condition the builder checks, and a deterministic orchestrator handler (the full handler table lives in `runbooks/always-auto-failure-handling.md`).

### `DONE`

**Meaning.** The slice (or feature, in soft mode) is implemented, both per-slice reviews passed (strict: spec-compliance + code-quality), the suite is green, and the builder has no forward-looking risks for the reviewer.

**Triggering condition.**
- strict per-slice: RED+GREEN+REFACTOR (or posture-equivalent commits) landed; spec-compliance review = pass; code-quality review = pass; Coverage line written; `self_review` all `verified: true`.
- soft / dispatch-level: every committed slice's per-slice status is `DONE`, suite passes on merged state, `self_review` all `verified: true`.

**Orchestrator handler.** Proceed. Chain to the next stage in `triage.path` per the always-auto matrix. The slim summary surfaces verbatim to the user but no stop fires; the next dispatch goes out in the same turn.

### `DONE_WITH_CONCERNS`

**Meaning.** The work landed and verified, but the builder spotted forward-looking risks the reviewer should weigh in on. Examples: "verification used a synthetic clock; integration test against real timer not run in this slug"; "AC-2's coverage is `partial` because the edge case will be covered by a follow-up slug"; "the GREEN diff grew larger than expected; a future refactor could simplify".

**Triggering condition.** All `DONE` conditions met AND the builder's `## Summary > Potential concerns` section has ≥1 non-empty bullet that is forward-looking (not "I noticed but didn't touch", which is past-tense and lives in its own section).

**Orchestrator handler.** Proceed AND log the concerns. Append a `## Concerns` section to `build.md` (one bullet per concern, copied verbatim from the slim summary's `Notes:` line and the `## Summary > Potential concerns` bullets in `build.md`). The reviewer reads `## Concerns` as additional finding seeds. The always-auto chain continues; the user sees the concerns in the slim summary but no stop fires.

### `NEEDS_CONTEXT`

**Meaning.** The builder cannot proceed without information that wasn't in the dispatch envelope. Examples: "the slice references `Config.legacyFlag` but the envelope's filebag doesn't include the file that defines it"; "the AC says 'follow the existing pattern' but the codebase has three competing patterns and the plan doesn't pin one"; "the slice's `Surface` includes a file the dispatch envelope's permissions don't allow reading".

**Triggering condition.** The builder identified a specific missing input AND attempted at least one round of self-rescue (re-read `CONTEXT.md`, search the codebase with `rg`, check `plan.md > ## Assumptions`) AND the gap remains. The slim summary's `Notes:` line MUST name the specific missing context in concrete terms (file path, symbol name, decision the plan needs to pin) — vague "I need more context" without a named gap is itself a finding the orchestrator surfaces back to the builder for re-derivation.

**Orchestrator handler.** Stop and report. The orchestrator emits a stop-and-report status block (per `runbooks/always-auto-failure-handling.md`) with `Reason: Builder NEEDS_CONTEXT — <verbatim Notes line>`. The status block names the specific missing context and tells the user how to provide it (typically: edit `CONTEXT.md` or `plan.md > ## Assumptions`, then `/cc` to continue; or `/cc-cancel` to discard). On `/cc` continue, the orchestrator re-dispatches the builder with the updated context in the envelope.

### `BLOCKED`

**Meaning.** The builder hit an unresolvable obstacle. Examples: "per-slice spec-compliance review failed twice (cap reached) and the proposed fix would require touching files outside the slice's `Surface`"; "the slice's `Posture` is `refactor-only` but the existing test suite has no coverage of the refactored code path (precondition violated)"; "a dependency the slice needs (e.g., a database fixture) is missing and cannot be reproduced from the envelope".

**Triggering condition.** EITHER (a) the per-slice review loop failed its 2-attempt cap on this slice AND no remaining slices are independent of the blocked slice, OR (b) the builder discovered a structural issue with the plan that prevents progress (posture mismatch, dependency cycle, surface conflict). The slim summary's `Notes:` line MUST cite (1) the blocker in concrete terms and (2) the builder's recommended resolution from a fixed set: `provide more context` / `break the slice smaller` / `escalate to architect` / `accept and ship as-is`.

**Orchestrator handler.** Stop and report. The orchestrator emits a stop-and-report status block with `Reason: Builder BLOCKED — <verbatim Notes line>` AND the recommended resolution surfaced as plain prose for the user. The status block invites `/cc` continue (with the resolution applied — usually a `plan.md` edit, a `CONTEXT.md` addition, or an architect re-dispatch) or `/cc-cancel` (discard). The orchestrator does NOT auto-retry; re-running the builder on unchanged inputs produces the same `BLOCKED` verdict.

## How the status line appears in the slim summary

The status line sits between `Stage:` and `Artifact:` in the strict-mode slim summary. The Stage marker (`✅ complete` / `⏸ paused` / `❌ blocked`) is preserved for back-compat; the structured `Status:` line is the canonical machine-readable signal:

```
Stage: build  ✅ complete  |  ⏸ paused  |  ❌ blocked
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Artifact: .cclaw/flows/<slug>/build.md
What changed: <one sentence>
Slices implemented: <strict only>
AC verified: <strict / soft / inline>
Commits: <strict only>
Open findings: 0
Confidence: <high | medium | low>
Recommended next: <continue | review-pause | fix-only | cancel | accept-warns-and-ship>
Notes: <required when Status != DONE>
```

`Notes:` is **mandatory** when `Status != DONE`. The orchestrator surfaces the Notes verbatim in the stop-and-report status block (for `NEEDS_CONTEXT` / `BLOCKED`) or in `build.md > ## Concerns` (for `DONE_WITH_CONCERNS`). Empty `Notes:` on a non-`DONE` status is itself a fix-only bounce — the orchestrator dispatches the builder back with `mode: "fix-only"` and instructions to populate the Notes.

## Per-slice status inside JSON `self_review` blocks (strict mode)

Each per-slice JSON `self_review` block (one per slice, per the builder prompt's "Strict-mode summary block" section) gains a new field `status` carrying the per-slice status:

```json
{
  "specialist": "builder",
  "mode": "build|fix-only",
  "kind": "slice",
  "slice": "SL-N",
  "status": "DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED",
  "phases": { ... },
  "self_review": [ ... ],
  "next_action": "next slice | start AC verification pass | stop and surface"
}
```

The dispatch-level status (top of the slim summary) is the aggregation of per-slice statuses per the rule named under "When to use" (lowest-confidence wins). The orchestrator reads BOTH: per-slice statuses route the per-slice review loop (whether to fix-only the slice or move on); dispatch-level status routes the chain decision (continue, log + continue, stop + report).

## Aggregation rule (dispatch-level from per-slice)

Pick the lowest-confidence per-slice status and emit it at dispatch level:

| any slice has | dispatch-level status |
| --- | --- |
| `BLOCKED` | `BLOCKED` |
| `NEEDS_CONTEXT` (and no slice is `BLOCKED`) | `NEEDS_CONTEXT` |
| `DONE_WITH_CONCERNS` (and no slice is `BLOCKED` / `NEEDS_CONTEXT`) | `DONE_WITH_CONCERNS` |
| only `DONE` | `DONE` |

The aggregation is monotone — a single blocked slice contaminates the dispatch. This is intentional: the orchestrator's chain decision should be conservative; one slice that needs help should not be hidden behind sibling slices that finished cleanly.

## Common rationalizations

| rationalization | truth |
| --- | --- |
| "The slice almost worked — I'll mark `DONE` and let the reviewer catch the gap." | No. Reviewer reads `DONE` as "builder verified the slice"; the reviewer's job is the ten-axis pass, not catching what the builder skipped. Mark `DONE_WITH_CONCERNS` and name the gap in `Notes:`. |
| "I don't really need more context — I can guess what the plan meant." | Guessing is what `## Assumptions (correct me now)` exists to prevent. If you found yourself guessing, the slice is `NEEDS_CONTEXT`; name the specific missing input. |
| "The per-slice review failed twice but I can probably fix it on attempt three." | Cap is 2 for a reason. Past attempt 2 the same fix shape is being re-tried; mark `BLOCKED` with recommended resolution and let the user / architect break the slice smaller. |
| "I'll mark `DONE_WITH_CONCERNS` for everything to be safe — the orchestrator handles it gracefully." | No. `DONE_WITH_CONCERNS` is for forward-looking risks, not blanket caution. Over-tagging dilutes the signal; the reviewer ignores everything in `## Concerns` if it's noise. |
| "BLOCKED on this slice means I have to BLOCK the whole dispatch even if siblings finished." | Yes, the aggregation rule is monotone for a reason. Sibling slices that committed cleanly stay landed; the dispatch-level `BLOCKED` tells the orchestrator to stop the chain so the user can resolve the blocker. The sibling work isn't lost. |
| "I'll skip the `Notes:` line on `BLOCKED` — the status itself says enough." | No. `BLOCKED` without a specific blocker + recommended resolution is itself a fix-only bounce. The orchestrator cannot route the user to a recovery action without the Notes. |

## Worked examples

**Example 1 — three slices, all clean (`DONE`).** SL-1, SL-2, SL-3 each pass per-slice spec-compliance + code-quality review on first attempt. Per-slice JSON blocks each carry `status: "DONE"`. Dispatch-level slim summary: `Status: DONE`. Orchestrator chains to qa (if UI surface) or review.

**Example 2 — three slices, SL-2 spotted a perf concern but landed (`DONE_WITH_CONCERNS`).** SL-1 `DONE`. SL-2 passes both reviews but the builder's `## Summary > Potential concerns` notes "synthetic clock used for the rate-limit test; integration test with real timer not run in this slug". SL-3 `DONE`. Per-slice statuses: `DONE`, `DONE_WITH_CONCERNS`, `DONE`. Dispatch-level: `DONE_WITH_CONCERNS`. Orchestrator appends `## Concerns` to `build.md` with the SL-2 bullet, chains to next stage.

**Example 3 — SL-2 NEEDS_CONTEXT.** SL-1 `DONE`. SL-2 begins; the slice references `Config.featureFlags.legacyRateLimit` but no file in the envelope's filebag defines that field. Builder reads `CONTEXT.md` (no mention), greps the codebase (no hit outside the slice's RED test), checks `plan.md > ## Assumptions` (no entry). Per-slice status: `NEEDS_CONTEXT`. `Notes:` cites: "SL-2 references `Config.featureFlags.legacyRateLimit` but no file in the envelope defines it; either add the file to the envelope or pin the field's shape in `plan.md > ## Assumptions`." Sibling slices (SL-3, SL-4) depend on SL-2 → not dispatched. Dispatch-level: `NEEDS_CONTEXT`. Orchestrator stops, surfaces stop-and-report status block, awaits `/cc` continue or `/cc-cancel`.

**Example 4 — SL-3 BLOCKED.** SL-1, SL-2 `DONE`. SL-3's posture is `refactor-only` but the precondition (existing tests anchor the unchanged behaviour) is violated: the function being refactored has zero test coverage in the repo, and the slice's `Surface` doesn't include a test file the builder could add as a characterization test (that would require a posture switch to `characterization-first`, which is an architect decision). Builder attempts to surface a finding to architect via the slim summary; per-slice status: `BLOCKED`. `Notes:` cites: "SL-3 posture `refactor-only` has no anchor tests; recommended resolution = escalate to architect to switch posture to `characterization-first` and add the characterization test to the slice's Surface." Dispatch-level: `BLOCKED`. Orchestrator stops, surfaces stop-and-report block with the recommended resolution surfaced as plain prose, awaits `/cc` continue (with the plan revised) or `/cc-cancel`.

## Failure modes the protocol prevents

- **The "silent advance".** Pre-v8.68 the orchestrator inferred build outcome from `Stage: ✅ complete` and `Recommended next: continue`. An ambiguous slim summary ("Notes: SL-3 deferred — surface conflict") let the chain advance to review on unfinished work. The structured `Status:` field makes the chain decision deterministic.
- **The "buried blocker".** Pre-v8.68 a blocker on one slice could be masked by sibling slices that committed cleanly (slim summary said "Stage: ✅ complete" because most slices finished). The monotone aggregation rule lifts any per-slice `BLOCKED` to the dispatch level.
- **The "vague context request".** Pre-v8.68 a builder saying "I need more context" with no named gap left the orchestrator with no recovery action. The mandatory specificity requirement on `NEEDS_CONTEXT` Notes forces the builder to name the file / symbol / decision that's missing.
- **The "infinite retry".** Pre-v8.68 a stuck builder could re-attempt the same fix in a loop. The 2-attempt cap on per-slice review + the orchestrator's "no auto-retry on `BLOCKED`" rule together prevent the loop.

## Cross-references

- `runbooks/always-auto-failure-handling.md` — the canonical failure routing matrix, now extended with `NEEDS_CONTEXT` and `BLOCKED` rows.
- `agents/builder.md` — the builder prompt body, which embeds this skill's status protocol in its "Slim summary" + "Per-slice review loop" sections.
- `subagent-driven-development.md` (obra-superpowers reference) — the upstream implementer status protocol cclaw mirrors.
- `runbooks/handoff-gates.md` — the pre-reviewer self-review gate, which now also reads the per-slice `status` field before deciding whether to dispatch the reviewer.
