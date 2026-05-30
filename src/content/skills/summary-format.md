---
name: summary-format
trigger: every authored cclaw artifact (plan.md, decisions.md, build.md, review.md, ship.md, learnings.md); every builder status line; every completion claim (no done/ready/looks-good without fresh evidence); every receive-feedback response. Always-on for any specialist that writes an artifact, claims completion, or processes a finding.
---

# Skill: summary-format

Every cclaw artifact ends with a **standardised three-section Summary block**. The slim summary the specialist returns to the orchestrator stays terse (≤6 lines); the Summary block in the artifact is the **durable record** of what changed and what didn't.

> **Scope (consolidated skill).** This is cclaw's single **status & completion** authority. Beyond the three-section Summary block it also carries: the canonical **Confidence ladder** (below); the builder **status enum** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` (absorbed from `structured-status`); the **completion-discipline** evidence gate + forbidden-phrase list (absorbed from `completion-discipline`); and the **receiving-feedback** four-step response pattern + forbidden-phrase list (absorbed from `receiving-feedback`). The three former skills are merged here verbatim under the parts below; nothing was dropped.

The three-section shape is taken directly from the addyosmani-skills git-workflow standard: it surfaces scope creep and uncertainty *to the next reader*, instead of relying on memory or clean-up passes that never happen.

## When to use

Always-on for any specialist that authors a cclaw artifact: `plan.md` (architect), `decisions.md` (architect's Decisions phase on legacy flows), `build.md` (builder), `review.md` (reviewer per iteration — security threat-modelling absorbed into the reviewer's `security` axis), `ship.md` (builder at ship dispatch), `learnings.md` (the learnings sub-agent). The slim-summary contract — six lines max, `Stage: …`, `What changed: …`, `Next: …`, `Confidence: …` — is enforced on every dispatch return; the artifact Summary block is appended at write time.

## When NOT to apply

- **Slim summaries** (the six-line dispatch return). Those have their own contract (`Stage: …`, `Artifact: …`, `Confidence: …`, `Recommended next: …`); the three-section block is for **artifact bodies**, not return envelopes.
- **Inline / trivial flows.** There is no `plan.md` / `build.md` / `review.md` / `ship.md` artifact to append to on the inline path; the orchestrator's one-sentence summary is the audit trail.
- **Hook output and machine-readable files** (`flow-state.json`, `knowledge.jsonl`). The block is human-prose; structured wire-format files have their own validation contract.
- **Mid-stage artifact edits** that don't author a new section (e.g. correcting a typo in an AC body). The Summary block reflects the **authored** unit; mechanical fixes don't get their own block.

## Format

Append exactly this block to the bottom of the artifact you authored. Do not rename the headings, do not add other sections inside it, do not reorder them.

```markdown
## Summary

### Changes made
- <one bullet per concrete change you committed to this artifact, in plain past tense>
- <e.g. "Added AC-3 covering the empty-permission fallback path">
- <e.g. "Recorded D-2 selecting in-process BM25; rejected vector store as out of scope">

### Things I noticed but didn't touch
- <one bullet per scope-adjacent issue you spotted but deliberately did NOT change>
- <e.g. "src/lib/permissions.ts:42 has a stale TODO that predates this slug">
- <e.g. "tests/unit/RequestCard.test.tsx mixes fixture data; outside touch surface">
- if there is nothing, write `None.` — explicit empty is correct, blank is wrong.

### Potential concerns
- <one bullet per uncertainty, missing input, or risk the next stage / next reader should weigh>
- <e.g. "AC-2 verification depends on a clock helper not yet imported in the test file">
- <e.g. "Migration step in D-1 may interact with the seed script — flagged for reviewer's `security` axis to look at">
- if there is nothing, write `None.`.
```

The block goes at the very bottom of the artifact, after the body, after any worked examples, after any prior-iteration material. One block per artifact write. The architect now authors the entire plan.md in a single dispatch (unified flow), so plan.md carries **one Summary block** — `## Summary — architect` on large-risky / strict (to be explicit about the multi-phase ceremony that ran), or `## Summary` on small-medium / soft.

## What goes in each section

### `Changes made`

Plain past-tense bullets. **Concrete**, not "implemented the plan". Each bullet is a thing a reviewer can verify in the diff or in the artifact. AC ids, D-N ids, F-N ids, file paths, commit shas — citations welcome.

### `Things I noticed but didn't touch`

This is the **anti-scope-creep section**. Force yourself to list the things you *chose not to fix while you were nearby*. Stale TODOs, unrelated bugs, sibling-file issues, tests that pass but feel wrong, dead code, mismatched naming.

The point is to **resist the urge to fix everything** — surface it here so the next slug owner can decide. A specialist that silently fixed sibling issues is a specialist that broke scope discipline; the reviewer flags that.

If the touch surface really was clean, write `None.` (one word + period). Do not invent items to fill the section.

### `Potential concerns`

Forward-looking. What might bite the **next stage** or **the user**? Uncertainties, partial coverage, untested edges, decisions you made under low confidence, dependencies on external systems, migration footguns.

Drop `Confidence: low` items here verbatim with a one-line cause. The reviewer can use this section to seed the Findings table.

If there are no real concerns, write `None.` and own it.

## Confidence ladder (canonical across every slim summary)

The `Confidence` line on every post-triage slim summary uses a three-band ladder. The ladder is the same across all specialists; the **accents** (which specific sampled section, which specific brushed cap, which specific missing input dropped you to medium / low) are the specialist's own concern and stay in the specialist body — the canonical ladder below sets the *common* shape every specialist projects onto.

- **`high`** — the protocol ran end-to-end without holes. Every required input was present, every required section / axis / lane was **walked** (not sampled), every cited evidence row resolves to a real artefact (file:line, commit SHA, test output, screenshot, suite line). No bound was brushed; no prediction was `partial`. The specialist would re-emit the same verdict on a second dispatch with the same inputs.
- **`medium`** — exactly one of: (a) one section / axis / lane was **sampled** rather than walked (e.g. perf reviewed by spot-check; one investigator lane returned mid-range confidence; one critic technique skipped on `light` escalation); (b) the dispatch **brushed against a hard cap** (token / iteration / diff-size); (c) one input was **thin** (ambiguous prompt; partial prior-context blob; helper helper-dispatch returned `Confidence: low` → contagion); (d) a pre-commitment prediction was `partial`. The slim summary's `Notes` line is **mandatory** and names which of (a)-(d) fired.
- **`low`** — any of: (a) a required input was **missing** (file unreadable, prior artefact absent, envelope misshaped); (b) the dispatch **exceeded a hard cap** (token / iteration / diff-size); (c) the specialist could not honestly emit a single converged verdict (lanes diverged, axes contradicted, predictions mostly refuted with no replacement framing); (d) the dispatch was **gated against** (e.g. `ceremonyMode: inline` reached a strict-only specialist; investigator dispatched on a non-debug shape). `Notes` line is **mandatory** and names which of (a)-(d) fired.

**Default gate semantics.** The orchestrator treats `Confidence: low` as a **hard gate** on every post-triage slim summary: dispatch stops, slim summary is surfaced to the user, the slug does not advance until the named gap is resolved. `Confidence: medium` advances but is logged as a quality signal — the next stage's specialist may downgrade its own confidence on the contagion principle (e.g. the architect's `learnings-research returns Confidence: low → downgrade to medium` rule).

**Triage exception.** `Confidence: low` at triage is **NOT** a hard gate. The router's classification is an opening posture, and the downstream specialist's Phase 0 / Phase 1 picks up the clarification surface (the architect's Clarify protocol, the investigator's symptom-restatement, etc.). The router still emits `Confidence: low` honestly when the prompt is vague; the downstream specialist consumes it as additional input, not as a stop signal.

The per-specialist accent — *which* sampled section, *which* brushed cap, *which* missing input — is the specialist's own concern and stays in the specialist body. This skill encodes the canonical mapping from those accents to the three-band emission so every post-triage slim summary's `Confidence` field means the same thing to the orchestrator.

## Hard rules

- **All three subheadings present.** Even when one is empty, the H3 heading + `None.` line stays. Skipping a subheading is a finding (reviewer axis=readability, severity=consider).
- **No prose paragraphs in the block.** Bullets only. The block is read fast; paragraphs are read slow.
- **No new findings here.** If you have a finding, surface it in the slim summary and (if reviewer) in the Findings table. The Summary block is reflective, not active.
- **No fabrication.** `Things I noticed but didn't touch` is not the place to invent improvements you didn't actually consider; it is the place to record the ones you did.
- **No copy-paste between artifacts.** Each artifact's Summary block is unique to that artifact's authorship.

## Specialist contracts

| Specialist | Block goes in |
| --- | --- |
| `architect` | `flows/<slug>/plan.md` (heading: `## Summary — architect` on large-risky; `## Summary` on small/medium). On research mode the artifact is `flows/<slug>/research.md` (heading: `## Summary — architect (research mode)`) |
| `builder` | `flows/<slug>/build.md` (heading: `## Summary` per cycle in soft mode; per fix-iteration in fix-only mode; per slice in parallel-build) |
| `reviewer` | `flows/<slug>/review.md` per iteration (heading: `## Summary — iteration N`) — sits right above the next iteration block. Security-axis findings (threat-model / taint / secrets / supply chain), absorbed from the former `security-reviewer`, sit inline in the same iteration block under the `security` axis tag |
| ship synthesis | `flows/<slug>/ship.md` (heading: `## Summary`) |

## Common pitfalls

- Filling `Changes made` with implementation details copied from the body. The body is the body; the Summary is the executive view.
- Skipping `Things I noticed but didn't touch` because "I did everything that needed doing". This is the section that catches scope drift before it ships.
- Using `Potential concerns` as a TODO list. It is a risk register, not a backlog. Concrete, future-tense risks only.
- Multi-author plan.md getting one combined Summary at the end. Each author writes their own.

## Worked example — architect Summary on small/medium

```markdown
## Summary

### Changes made
- Authored 3 AC covering the dashboard tooltip behaviour: AC-1 (renders email when permitted), AC-2 (250ms hover), AC-3 (display-name fallback).
- Pinned touch surface to 3 files: `src/lib/permissions.ts`, `src/components/dashboard/RequestCard.tsx`, `tests/unit/RequestCard.test.tsx`.
- Recorded prior lesson from `shipped/dashboard-status-pill` (verbatim quote in `## Prior lessons applied`).

### Things I noticed but didn't touch
- `src/components/dashboard/RequestCard.tsx:140` has a `useMemo` whose deps include `Date.now()` — re-renders every minute. Outside this slug's AC; flagging in case builder or reviewer wants to surface as a follow-up.
- `tests/unit/RequestCard.test.tsx` uses ad-hoc fixtures instead of `makeUserFixture()`; same pattern as a prior shipped slug. Not in scope here.

### Potential concerns
- AC-1 verification depends on the `hasViewEmail` helper not yet existing; builder will create it. RED test must fail because the export is missing, not because of an import error.
- The 250ms token in AC-2 lives in `src/styles/tokens.css`, not in JS. If builder reads the value from JS state instead of the CSS token, AC-2 is a flake risk.
```

---

# Part II — Builder status protocol (absorbed `structured-status`)

The builder runs in a long sub-agent loop and emits its outcome via a slim-summary block the orchestrator reads. Without a structured status token, the orchestrator has to infer intent from prose ("Notes: SL-3 deferred — surface conflict" — is that a soft warning or a hard stop?). Inference is fragile; cclaw's always-auto chain treats every `/cc` as a chance to advance the flow unless a hard gate fires, which means an ambiguous slim summary is the worst possible output: the orchestrator silently chains forward on work that wasn't done.

This protocol codifies the four canonical builder statuses — `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` — and pins one deterministic orchestrator handler to each. The vocabulary mirrors the obra-superpowers subagent-driven-development protocol (`./SKILL.md` § "Handling Implementer Status") so cclaw's per-slice loop reads the same way as the reference implementer pattern.

**When the status protocol fires.** Always-on for the builder specialist. The status line is **mandatory** on every builder slim summary, in every mode:

- **strict mode** — one status per slice (emitted at the slice boundary inside the per-slice JSON `self_review` block) AND one status for the whole dispatch (emitted at the top of the slim summary). Per-slice statuses drive the per-slice review loop (see `subagent-driven-development.md` two-stage pattern); the dispatch-level status drives the orchestrator's chain decision.
- **soft mode** — one status for the whole feature (the single TDD cycle is the unit of work). Emitted at the top of the slim summary.
- **inline mode** — not dispatched; the orchestrator's trivial path handles the edit directly. No status line.

The status fires at four specific moments inside the builder: (1) **at the end of every slice's per-slice review loop** (strict mode), recorded in the slice's `self_review` block; (2) **at the end of the dispatch** (every mode), distilling per-slice statuses into one dispatch-level status; (3) **mid-dispatch on a hard stop** — emit `BLOCKED` immediately for the dispatch (settled sibling slices keep their per-slice `DONE`); (4) **at fix-only completion** — one dispatch-level status describing the fix outcome.

**When the status protocol does NOT apply.** Non-builder specialists (triage, architect, plan-critic, qa-runner, reviewer, critic each have their own verdict vocabulary — `pass`, `revise`, `iterate`, `block-ship`, `cap-reached`, etc.; they do NOT emit a builder status). The inline / trivial path (`triage.path == ["build"]`; no dispatch, no slim summary, no status). Resume re-render (a rendered prior status is read-only; the resume does not re-claim). Sub-builder under topological-layer dispatch (envelope `parent_mode: "topological-layer"` emits ONE per-slice status to the parent builder; the parent builder aggregates across siblings and emits the single dispatch-level status that reaches the orchestrator).

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

## Status line in the slim summary

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

Each per-slice JSON `self_review` block (one per slice, per the builder prompt's "Strict-mode summary block" section) gains a field `status` carrying the per-slice status:

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

The dispatch-level status (top of the slim summary) is the aggregation of per-slice statuses per the rule below (lowest-confidence wins). The orchestrator reads BOTH: per-slice statuses route the per-slice review loop (whether to fix-only the slice or move on); dispatch-level status routes the chain decision (continue, log + continue, stop + report).

## Status protocol — aggregation rule (dispatch-level from per-slice)

Pick the lowest-confidence per-slice status and emit it at dispatch level:

| any slice has | dispatch-level status |
| --- | --- |
| `BLOCKED` | `BLOCKED` |
| `NEEDS_CONTEXT` (and no slice is `BLOCKED`) | `NEEDS_CONTEXT` |
| `DONE_WITH_CONCERNS` (and no slice is `BLOCKED` / `NEEDS_CONTEXT`) | `DONE_WITH_CONCERNS` |
| only `DONE` | `DONE` |

The aggregation is monotone — a single blocked slice contaminates the dispatch. This is intentional: the orchestrator's chain decision should be conservative; one slice that needs help should not be hidden behind sibling slices that finished cleanly.

## Status protocol — common rationalizations

| rationalization | truth |
| --- | --- |
| "The slice almost worked — I'll mark `DONE` and let the reviewer catch the gap." | No. Reviewer reads `DONE` as "builder verified the slice"; the reviewer's job is the nine-axis pass, not catching what the builder skipped. Mark `DONE_WITH_CONCERNS` and name the gap in `Notes:`. |
| "I don't really need more context — I can guess what the plan meant." | Guessing is what `## Assumptions (correct me now)` exists to prevent. If you found yourself guessing, the slice is `NEEDS_CONTEXT`; name the specific missing input. |
| "The per-slice review failed twice but I can probably fix it on attempt three." | Cap is 2 for a reason. Past attempt 2 the same fix shape is being re-tried; mark `BLOCKED` with recommended resolution and let the user / architect break the slice smaller. |
| "I'll mark `DONE_WITH_CONCERNS` for everything to be safe — the orchestrator handles it gracefully." | No. `DONE_WITH_CONCERNS` is for forward-looking risks, not blanket caution. Over-tagging dilutes the signal; the reviewer ignores everything in `## Concerns` if it's noise. |
| "BLOCKED on this slice means I have to BLOCK the whole dispatch even if siblings finished." | Yes, the aggregation rule is monotone for a reason. Sibling slices that committed cleanly stay landed; the dispatch-level `BLOCKED` tells the orchestrator to stop the chain so the user can resolve the blocker. The sibling work isn't lost. |
| "I'll skip the `Notes:` line on `BLOCKED` — the status itself says enough." | No. `BLOCKED` without a specific blocker + recommended resolution is itself a fix-only bounce. The orchestrator cannot route the user to a recovery action without the Notes. |

## Status protocol — worked examples

**Example 1 — three slices, all clean (`DONE`).** SL-1, SL-2, SL-3 each pass per-slice spec-compliance + code-quality review on first attempt. Per-slice JSON blocks each carry `status: "DONE"`. Dispatch-level slim summary: `Status: DONE`. Orchestrator chains to qa (if UI surface) or review.

**Example 2 — three slices, SL-2 spotted a perf concern but landed (`DONE_WITH_CONCERNS`).** SL-1 `DONE`. SL-2 passes both reviews but the builder's `## Summary > Potential concerns` notes "synthetic clock used for the rate-limit test; integration test with real timer not run in this slug". SL-3 `DONE`. Per-slice statuses: `DONE`, `DONE_WITH_CONCERNS`, `DONE`. Dispatch-level: `DONE_WITH_CONCERNS`. Orchestrator appends `## Concerns` to `build.md` with the SL-2 bullet, chains to next stage.

**Example 3 — SL-2 NEEDS_CONTEXT.** SL-1 `DONE`. SL-2 begins; the slice references `Config.featureFlags.legacyRateLimit` but no file in the envelope's filebag defines that field. Builder reads `CONTEXT.md` (no mention), greps the codebase (no hit outside the slice's RED test), checks `plan.md > ## Assumptions` (no entry). Per-slice status: `NEEDS_CONTEXT`. `Notes:` cites: "SL-2 references `Config.featureFlags.legacyRateLimit` but no file in the envelope defines it; either add the file to the envelope or pin the field's shape in `plan.md > ## Assumptions`." Sibling slices (SL-3, SL-4) depend on SL-2 → not dispatched. Dispatch-level: `NEEDS_CONTEXT`. Orchestrator stops, surfaces stop-and-report status block, awaits `/cc` continue or `/cc-cancel`.

**Example 4 — SL-3 BLOCKED.** SL-1, SL-2 `DONE`. SL-3's posture is `refactor-only` but the precondition (existing tests anchor the unchanged behaviour) is violated: the function being refactored has zero test coverage in the repo, and the slice's `Surface` doesn't include a test file the builder could add as a characterization test (that would require a posture switch to `characterization-first`, which is an architect decision). Builder attempts to surface a finding to architect via the slim summary; per-slice status: `BLOCKED`. `Notes:` cites: "SL-3 posture `refactor-only` has no anchor tests; recommended resolution = escalate to architect to switch posture to `characterization-first` and add the characterization test to the slice's Surface." Dispatch-level: `BLOCKED`. Orchestrator stops, surfaces stop-and-report block with the recommended resolution surfaced as plain prose, awaits `/cc` continue (with the plan revised) or `/cc-cancel`.

## Status protocol — failure modes the protocol prevents

- **The "silent advance".** Without a structured status, the orchestrator infers build outcome from `Stage: ✅ complete` and `Recommended next: continue`. An ambiguous slim summary ("Notes: SL-3 deferred — surface conflict") lets the chain advance to review on unfinished work. The structured `Status:` field makes the chain decision deterministic.
- **The "buried blocker".** Without the status protocol, a blocker on one slice could be masked by sibling slices that committed cleanly (slim summary said "Stage: ✅ complete" because most slices finished). The monotone aggregation rule lifts any per-slice `BLOCKED` to the dispatch level.
- **The "vague context request".** A builder saying "I need more context" with no named gap leaves the orchestrator with no recovery action. The mandatory specificity requirement on `NEEDS_CONTEXT` Notes forces the builder to name the file / symbol / decision that's missing.
- **The "infinite retry".** A stuck builder could otherwise re-attempt the same fix in a loop. The 2-attempt cap on per-slice review + the orchestrator's "no auto-retry on `BLOCKED`" rule together prevent the loop.

## Status protocol — cross-references

- `runbooks/always-auto-failure-handling.md` — the canonical failure routing matrix, with `NEEDS_CONTEXT` and `BLOCKED` rows.
- `agents/builder.md` — the builder prompt body, which embeds this status protocol in its "Slim summary" + "Per-slice review loop" sections.
- `subagent-driven-development.md` (obra-superpowers reference) — the upstream implementer status protocol cclaw mirrors.
- `runbooks/handoff-gates.md` — the pre-reviewer self-review gate, which also reads the per-slice `status` field before deciding whether to dispatch the reviewer.

---

# Part III — Completion discipline (absorbed `completion-discipline`)

cclaw's most expensive failure mode is **claiming work is done before verifying it**. A builder that returns `Stage: build ✅ complete` without running the suite. An architect that returns `Confidence: high` without re-reading the plan. A reviewer that closes a finding without citing the fix evidence. Each instance costs at minimum one orchestrator round-trip; at worst, it ships a broken build because the next stage's "verification" looked at stale state.

This part makes the rule explicit: **no completion claim without fresh verification evidence**. The discipline is concentrated here so every specialist and every stage applies the same gate. The Iron Law on completion claims, the anti-slop ban on "looks good", and the reviewer's `Verification story` table are all instances of this one rule — this section is the canonical source they all defer to.

**When to use.** Always-on. Every cclaw specialist and the orchestrator obey it on every dispatch. The rule fires at four specific moments: (1) **before writing a slim-summary `Stage: ... ✅ complete` line**; (2) **before promoting a `Recommended next: continue`**; (3) **before closing a Findings row (`status: closed`)** — the close requires a citation, else the close is itself a finding (axis=correctness, severity=required); (4) **before the orchestrator stamps `ship.md > status: shipped` or runs finalize**. The rule applies in every ceremonyMode (`inline` / `soft` / `strict`) and every stage.

**When NOT to apply.** Mid-stage probing / debug-loop runs (the probe's output is evidence, not a completion claim; the "I'm done debugging, this works now" claim that follows must carry fresh evidence). Mechanical step acknowledgements ("I read `plan.md`" is procedural, not a completion claim). Hypothesis statements during debug-loop discipline (stating "my top hypothesis is X" per `debug-and-browser.md` is a hypothesis to test, not a claim). Re-rendering a prior slim summary during resume (re-render does not re-claim; the prior claim's evidence survives on disk).

## Completion discipline — forbidden phrases

These are sycophantic claim-tokens that signal "I didn't verify and I'm guessing the answer is yes". They are forbidden in any user-facing prose, slim summary, build / review / ship artifact, or commit message body **whenever they precede or substitute for a completion claim**:

- "should work"
- "should be fine"
- "probably works"
- "looks good"
- "I think this is done"
- "this should pass"
- "should be ready"
- "everything seems fine"
- "I believe this works"

The word "should" appearing in a contractual statement of intent ("the verification line should encode the AC") is **not** forbidden — that is a prescription, not a completion claim. The forbidden form is "X should work" used as a substitute for "I verified X works (here is the evidence)". When unsure, pick the rebuttal column of the Common rationalizations table below and act accordingly.

## Completion discipline — mandatory evidence shapes

A completion claim is valid only when paired with **at least one** of these evidence shapes, cited in the same slim summary, artifact, or commit body where the claim lives:

1. **Command + exit code + 1-3 relevant log lines.** Example: `npm test → 47 passed, 0 failed (2.3s)`. The command must be the one that exercises the claim; "ran the linter" does not cover "the build is green".
2. **Test output excerpt.** Test name + assertion result. Example: `tests/unit/permissions.test.ts > "renders email when permission set" → PASS`.
3. **Git log proof.** `git log --oneline <range>` showing the commits the claim is over. Example: `red(SL-1) a1b2c3d → green(SL-1) 4e5f6a7 → refactor(SL-1) 9e2c3a4`.
4. **File:line citation against the claim.** When the claim is structural ("the helper is extracted"), cite the post-change file:line where the helper now lives.
5. **Closing-citation for a Findings row.** Per the reviewer's contract: commit SHA, test name, OR new file:line that resolves the row.

The evidence must be **fresh** — captured in the current dispatch / iteration, not copy-pasted from a prior stage. Stale evidence is a re-run-without-rerun anti-pattern (see `anti-slop.md`). When evidence cannot be captured (e.g., the test runner is not reachable from the current context), the slim summary's `Confidence` field drops to `medium` minimum and `Notes:` cites the reason — the completion claim itself must NOT be promoted past `Confidence: high` without evidence.

## Completion discipline — process

Before any completion claim, walk this checklist (≈30 seconds):

1. **Name the claim.** "Build is complete for AC-1" / "Review iteration 2 returns `clear`" / "Plan ready for builder dispatch". State the claim in one sentence; vague claims pass the gate the most easily.
2. **List the evidence required.** What command, test, or citation proves this exact claim? (Step 1's specificity dictates step 2's shape.)
3. **Run the verification fresh.** Capture command output, test result, or git log in the current turn. Do not reuse evidence from a prior turn unless the underlying state has not changed.
4. **Paste the evidence next to the claim.** In the slim summary's `Notes:` line, in the artifact's Summary block, in the commit body — wherever the claim lands, the evidence lands with it.
5. **Drop confidence if evidence is partial.** When you ran a subset of tests (not the full suite), when the verification probe surfaced no errors but did not actively assert the AC's outcome, when the citation is to a prior commit rather than a fresh one — drop `Confidence` to `medium` (or `low` on serious gaps) and surface the dimension in `Notes:`.

## Completion discipline — verification

The reviewer's per-iteration **Verification story** table (`Tests run / Build run / Security checked`) is the canonical surface where this section's evidence requirement is enforced ex-post. The builder's `self_review[]` JSON attestation enforces it at handoff. The orchestrator's finalize step — per-criterion `verified` flag check — enforces it at ship time. Three layers of catch — the rule is the same one stated above; each layer re-asserts it in the surface most appropriate to that stage.

If a downstream stage finds an upstream claim lacked evidence, that is **F-N severity=required (axis=correctness)** — the upstream claim was a violation, not a noticing.

## Completion discipline — common rationalizations

**Cross-cutting rationalizations:** the canonical "should pass" / "looks good to me" / "I'll claim complete now" rows live in `.cclaw/lib/anti-rationalizations.md` under category `completion`. The rows below stay here because they cover completion-specific framings (stale-evidence citation rule, `Confidence: high + Notes:` hedge, verification line transcription); the catalog covers the shared rebuttal prose so the cross-cutting set stays consistent across surfaces.

| rationalization | truth |
| --- | --- |
| "I just ran the tests, they should pass on this kind of change." | "Should" is not evidence; "did" with the exit code is. Run the suite and paste the line — 30 seconds saves a review iteration. |
| "Looks good to me." | Sycophancy. Replace with "AC-1 verified: `npm test ...` → 47 passed" or drop the claim to `Confidence: medium`. |
| "This is a 5-line change, the test obviously passes." | Then run it and prove it. The 5-line change is exactly the kind whose unverified pass becomes the next stage's stale dependency. |
| "I'll claim complete now; the reviewer will catch any gaps." | The reviewer reads your slim summary as ground truth, then re-runs ex-post. A false complete-marker poisons the reviewer's `Verification story` — they cite "Tests run: yes" based on your claim and miss the regression. |
| "The previous turn's test output is enough." | Stale evidence (see `anti-slop.md`). Re-run if the underlying state could have moved. If it could not have moved (no code edits since), cite the exact prior turn's command + result; do not re-paste without the citation. |
| "I'm confident; I don't need to write the evidence down." | The evidence is for the next reader, not for you. The next agent reading your slim summary cannot reconstruct your confidence; they read the evidence or they don't. |
| "The verification line is in the AC; copying it into the slim summary is redundant." | Copy it anyway, in the form `verified: <command + result>`. Verification line is the spec; evidence is the proof. They live at different layers. |
| "I'll mark `Confidence: high` and put the caveat in `Notes:`." | `Confidence: high` with a `Notes:` caveat is the same as `Confidence: medium` with no caveat — pick the right value. The `Notes:` field is for unavoidable context, not for hedging a wrong confidence. |
| "The build was green yesterday; nothing material has changed." | Material change is judged by code edits, not by your sense of stability. If the working tree changed since yesterday's run, re-run. If it did not, cite the prior run by command + timestamp. |

## Completion discipline — red flags

When you catch any of these in your own output, **stop** and re-run the verification before sending:

- "should" / "probably" / "looks like" / "seems to" preceding a completion verb.
- A slim summary with `✅ complete` but no cited command in `What changed:` or `Notes:`.
- A Findings row closed with `Status: closed | Closed in: 2` but no `Citation:` column populated.
- A `Confidence: high` line where the build was last verified in a turn you cannot identify.
- Any "everything passes" / "all good" / "ready to ship" without a paired command excerpt.
- A `Recommended next: continue` immediately after a "should work" caveat.

The red flag is not the claim itself; the red flag is the claim without paired evidence. Adding evidence converts every example above into a valid completion claim.

## Completion discipline — worked example (RIGHT)

builder's slim summary after AC-1 commits:

```
Stage: build  ✅ complete
Artifact: .cclaw/flows/20260514-tooltip-permission/build.md
What changed: AC-1 RED+GREEN+REFACTOR committed (red a1b2c3d, green 4e5f6a7, refactor 9e2c3a4); npm test → 47 passed, 0 failed (2.3s).
AC verified: AC-1=yes
Open findings: 0
Confidence: high
Recommended next: review
Notes: tsc --noEmit → 0 errors; coverage row written (verdict=full).
```

Evidence shapes: command + exit code (`npm test → 47 passed`), git log proof (three SHAs in commit-ordering), per-criterion verified flag. The completion claim (`✅ complete`) is paired with all three.

## Completion discipline — worked example (WRONG, and the rebuttal)

```
Stage: build  ✅ complete
Artifact: .cclaw/flows/20260514-tooltip-permission/build.md
What changed: AC-1 done, looks good.
Open findings: 0
Confidence: high
Recommended next: review
```

Violations: "Looks good" — forbidden phrase (sycophancy, no evidence); `What changed:` carries no command, no exit code, no SHA; `Confidence: high` without paired evidence; no `AC verified:` line — the orchestrator's finalize check will refuse ship. The reviewer's Verification story will catch this, but the cost is one full review iteration; the cheaper path is to follow the Process checklist above before authoring the summary.

**Composition.** This discipline is **always-on** — every specialist, every stage. It pairs with the **Receiving feedback** section below (when receiving review / critic findings, the response's "I fixed it" claim must include fresh evidence per this section) and with `anti-slop.md` (stale evidence and shimming-instead-of-verifying are the two flavours of evading completion-discipline).

---

# Part IV — Receiving feedback (absorbed `receiving-feedback`)

cclaw's adversarial chain (reviewer → critic → ship gate) only works when the **receiving** specialist engages with the feedback honestly. The failure mode is sycophantic acknowledgement: "good point, you're right, let me address that" without analysis, classification, or a real plan. The next iteration ships the same defect with cosmetic adjustments and the reviewer flags it again. Two iterations wasted, signal-to-noise dropped.

This part replaces the sycophantic-acknowledge reflex with a structured response pattern: restate the finding, classify it against the ship gate, declare a plan with evidence. It is paired with the **Completion discipline** section above (the rule that the response's "I fixed it" claim itself needs evidence) and with the reviewer's anti-sycophancy `What's done well` gate (the symmetric rule for the reviewer side).

**When to use.** Always-on when a specialist or the orchestrator is processing **feedback that names a defect in their own prior output**. The four triggering surfaces: (1) **Reviewer findings** — builder receiving F-N rows from `review.md`'s Findings table; (2) **Critic gaps / verdicts** — builder OR architect receiving `critic.md > ## Gap analysis` rows or a `Verdict: block-ship` / `Verdict: iterate` line; (3) **Reviewer security-axis findings** (absorbed from the former `security-reviewer` into reviewer's security axis) — severity escalates faster (every `critical` security finding blocks ship in every ceremonyMode); (4) **User feedback that points at a defect** — treat as a finding (severity inferred from prose; default `required` when the user names a concrete miss). Fires on `build` (fix-only), `review` (re-iteration), and `ship` (final pre-merge sweep).

**When NOT to apply.** Praise (`What's done well` items — the response is a one-line "noted" or silence; running the four-step pattern on praise is sycophancy-in-reverse). Hypothesis statements during debug-loop collaboration (the response is the next probe, not the receive-feedback pattern). Procedural requests (`/cc`, `/cc-cancel`, `/cc <slug> <task>` are state-machine instructions, not feedback). Inline / trivial flows where no review or critic ran (only user-typed prose applies, via case #4). `fyi`-severity findings (the response is "noted, carried to learnings" — single line, no four-step analysis).

## Receiving feedback — forbidden phrases

These are sycophantic acknowledgement-tokens that signal "I am agreeing with the feedback without thinking about it". Forbidden as a substitute for the four-step response pattern below:

- "good point"
- "you're right"
- "I see your concern"
- "let me address that"
- "great catch"
- "fair enough"
- "absolutely, I'll fix it"
- "that's a fair criticism"
- "noted, will fix"

The phrases can appear in your reply when paired with the four-step pattern below (e.g., "Good point — restated: <finding>, classified as <severity>, plan is <plan>") — what is forbidden is the bare token as the **whole** response. Two more phrases are forbidden categorically (they hide disagreement under fake-agreement):

- "I see what you mean, but..." — a sycophantic preface to a pushback. If you're pushing back, say so in the four-step pattern's `Plan` step (`Plan: push back with evidence — <evidence>`); don't pretend to agree first.
- "Yes and..." — the improv "yes-and" reflex. Cclaw's adversarial chain is not improv; the receiving specialist's job is to classify, not to extend.

## Receiving feedback — the four-step response pattern

When you receive a finding, your reply (in the slim summary's `Notes:` line, the next iteration's build log entry, or the user-facing prose) follows this shape:

### Step 1 — Restate

State the finding back in your own words. One sentence. The restatement proves you parsed the finding; if your restatement is wrong, the upstream can correct before you commit to a fix.

> Restated F-2: my GREEN diff at `src/lib/permissions.ts:18` does not handle the null-claims branch — when `claims === null`, the function throws instead of returning `false`.

### Step 2 — Classify

Place the finding against the ship gate. One of:

- **`block-ship`** — fixing is mandatory before ship (any `critical` row; any `required` row in strict mode; any `required + architecture` row in soft mode per the priors).
- **`iterate`** — fixing is recommended but does not block (most `required` rows in soft mode; most `consider` rows in any mode when the iteration count is well under cap).
- **`fyi`** — informational; no fix required, but the lesson carries to `learnings.md`.

The classification is **explicit** — write `Classified: block-ship` (or the appropriate value) verbatim. The orchestrator and the reviewer both read this column.

### Step 3 — Plan

State the action plan in one sentence. One of three shapes:

- **`fix`** — "Plan: fix — write RED test asserting null-claims returns false, then GREEN at `src/lib/permissions.ts:18` adding the null-guard". The plan must be concrete (file:line refs, named tests, named refactors); "I'll fix it" without specifics is sycophantic agreement.
- **`push-back-with-evidence`** — "Plan: push back — the null-claims branch is unreachable per `src/auth/middleware.ts:42` which guarantees `claims !== null` before this function is called. Evidence: `tests/integration/auth-middleware.test.ts:88` exercises that path." Use this when you disagree with the finding; the evidence is what distinguishes informed push-back from sycophantic resistance.
- **`accept-warning`** — "Plan: accept warning — the finding is correct but `ceremonyMode: soft` and `severity: consider` carries over without blocking. Will surface in `learnings.md`." Use this when the finding is valid but the ship gate allows the carry-over.

### Step 4 — Evidence

When the plan is `fix`, the evidence is the result of the fix (per the **Completion discipline** section above): commit SHA, suite output, file:line of the change. When the plan is `push-back-with-evidence`, the evidence is the file:line / test name / git blame proof that supports the push-back. When the plan is `accept-warning`, the evidence is the carry-over citation (the `learnings.md` row id, or the `## Summary > Potential concerns` bullet).

The evidence lands **in the same response** as the plan, not in a follow-up turn. Splitting plan and evidence across turns is how the receive-feedback discipline degrades back to "I'll fix it" + silence.

## Receiving feedback — process

When a review.md (any axis, including the reviewer's `security` axis) or critic.md finding lands, follow this sequence (≈45-60 seconds per finding):

1. **Read the finding to the end.** Including the proposed fix, the cited file:line, and the severity. Do not respond after reading only the first sentence.
2. **Apply the four-step pattern above.** Restate / Classify / Plan / Evidence. Write the four lines in the same turn.
3. **Run the fix (if `Plan: fix`).** Per the **Completion discipline** section above, the fix needs fresh evidence — run the suite, capture the result, paste it in the response.
4. **Surface the response in the right surface.** For build's fix-only loop, the response sits in the next iteration's `build.md` block under `### Fix iteration N — review block K`. For review re-iteration, the response sits in the next reviewer pass's iteration block. For ship-gate fix-only, the response sits in `ship.md > ## Fix-only response`. The four-step pattern is the durable record; do NOT bury the pattern in a slim summary's `Notes:` line and lose it.

When multiple findings land in one review block (typical: 3-5 F-N rows in one iteration), apply the pattern **per finding**, not in aggregate. Aggregate responses ("I'll fix all three") are sycophantic by construction.

## Receiving feedback — when you disagree (push-back with evidence)

The receiving discipline is **not** "always agree and fix". Cclaw expects honest push-back when the finding is wrong, scoped wrong, or addressable by re-classifying rather than re-coding. The push-back pattern is the same four steps; only `Plan` changes shape:

```
Restated F-3: review claims the touchSurface includes `src/api/list.ts` outside the declared list.
Classified: iterate
Plan: push back with evidence — plan.md > AC-2 > touchSurface includes `src/api/list.ts:42-58` (the pagination helper). The diff line cited by the reviewer (`src/api/list.ts:50`) is inside that range. Suggest the reviewer re-read the touch surface row before re-running the check.
Evidence: plan.md:38 (touchSurface list with src/api/list.ts:42-58) + git diff --stat showing all touched lines fall in 42-58.
```

Push-back without evidence is forbidden — "I disagree" alone is not a Plan. The evidence column is what makes the push-back fall outside sycophantic-resistance. When the upstream agrees with the push-back, the reviewer's row close requires a citation per the **Completion discipline** section above (the Citation column points at your push-back evidence). When the upstream disagrees, the iteration loop continues — your push-back was honest, just wrong.

## Receiving feedback — verification

The fix-only loop's effectiveness is the canonical measure: a fix-only iteration that closes the cited findings on the next reviewer pass is the receive-feedback discipline working. A fix-only iteration that re-opens the same finding (or surfaces a near-duplicate F-N pointing at the same file:line) means the response was sycophantic — the upstream agreed without analyzing, and the same defect shipped. The reviewer's row-close citations are the audit trail; the orchestrator's run-mode pause-on-block is the enforcement gate.

## Receiving feedback — common rationalizations

**Cross-cutting rationalizations:** the canonical "looks good to me" sycophancy rows live in `.cclaw/lib/anti-rationalizations.md` under category `completion`. The rows below stay here because they cover receive-feedback-specific framings (polite-prelude, false-sympathy + silent disagreement, "let me address that" placeholder, aggregate fixes).

| rationalization | truth |
| --- | --- |
| "Saying 'good point' first is polite; the actual fix follows." | Polite-prelude is sycophantic by the time it ships through three iterations. Replace with the four-step pattern; structure is the politeness that the next agent can act on. |
| "The finding is small, I'll just fix it without restating it." | Restating is the cheapest step (one sentence). Skipping it skips the parse-check; if your restatement would have been wrong, the unrestrained fix lands in the wrong place. |
| "I disagree but the reviewer is the gate, so I'll just fix it." | False sympathy + silent disagreement. Push back with evidence; if the reviewer holds, fix. If they don't, you saved a fix-only round. The cost of one honest push-back is less than the cost of a wrong fix. |
| "Let me address that." | Forbidden phrase; replace with `Plan: fix — <concrete one-sentence plan>`. The phrase is a placeholder for "I haven't planned yet"; the concrete plan is the gate. |
| "I'll address all three findings together in one fix." | One response per finding. Aggregate fixes hide which finding drove which line of the diff; the reviewer's row-close citations break. |
| "I'll fix it and just commit; the response can be implicit in the diff." | The diff is evidence, not response. The four-step pattern lives in `build.md` or `review.md`; the diff is what step 4 (Evidence) cites. Skipping the prose response means the next reviewer cannot reconstruct your reasoning. |
| "The finding is correct but doesn't apply to my AC." | That's a push-back with evidence; surface as `Plan: push back — finding targets AC-2 but my touchSurface is AC-1; recommend re-routing.` Don't silently ignore; the orchestrator needs to see the response to re-route. |
| "Great catch, will fix in next iteration." | Sycophantic preface + can-kick. The next iteration is THIS response; the four-step pattern lands now. |

## Receiving feedback — red flags

When you catch any of these in your own response, **stop** and restructure to the four-step pattern:

- A response that opens with one of the forbidden phrases above as its full content.
- A response with no `Restated:` / `Classified:` / `Plan:` / `Evidence:` shape (the four labels are mandatory; lighter shapes degrade to sycophancy).
- A `Plan: fix` immediately followed by a fix commit with no `tests/<path>` RED commit preceding it (in strict mode + `test-first` posture; per `tdd-and-verification.md`).
- A `Plan: push back` with no `Evidence:` line. Push-back without evidence is forbidden.
- A response that addresses N findings with N-K shapes (some have all four steps, some have one-line acknowledgements). Inconsistency is the smell.
- Repeated identical responses across two iterations on the same finding ("I'll fix it" twice). The reviewer is showing you the same row because the prior response was structureless.

## Receiving feedback — worked example (RIGHT)

Review block 1 contains:

> F-2 | correctness | required | AC-1 | `src/lib/permissions.ts:18` | the GREEN diff does not handle the null-claims branch; throws on `claims === null` instead of returning `false`. → Add null-guard before the property access.

builder's response in the next build.md fix-iteration block:

```markdown
### Fix iteration 1 — review block 1

**F-2 response:**
- Restated F-2: my GREEN diff at `src/lib/permissions.ts:18` does not handle `claims === null`; the function throws instead of returning `false`.
- Classified: block-ship (strict mode, severity=required, axis=correctness — per the architecture priors block-ship rule, this required row gates ship until closed).
- Plan: fix — write RED test asserting `hasViewEmail(null) === false` in `tests/unit/permissions.test.ts`, then GREEN at `src/lib/permissions.ts:18` adding `if (claims === null) return false;` guard.
- Evidence (after fix lands): RED `red(SL-1): hasViewEmail null-guard` (SHA bbbcccc); GREEN `green(SL-1): fix F-2 — null-guard` (SHA dddeeee); npm test → 48 passed, 0 failed.

| F-N | AC | phase | commit | files | note |
| --- | --- | --- | --- | --- | --- |
| F-2 | AC-1 | red | bbbcccc | tests/unit/permissions.test.ts:55 | asserts hasViewEmail(null) === false |
| F-2 | AC-1 | green | dddeeee | src/lib/permissions.ts:18 | null-guard added |
| F-2 | AC-1 | refactor (skipped) | — | — | 2-line guard, idiomatic |
```

Four steps present; evidence cited per the Completion discipline section above; row-close citation handed to the reviewer for the next iteration.

## Receiving feedback — worked example (WRONG, and the rebuttal)

```markdown
### Fix iteration 1 — review block 1

Good point on F-2, you're right. Let me address that and the other findings.
```

Violations: three forbidden phrases in one line ("good point", "you're right", "let me address that"); no restatement (the reviewer cannot verify the parse); no classification (the ship gate cannot evaluate the response); no plan (the next iteration cannot know what code is changing); aggregate response (the row-close citations break). The reviewer will re-flag this as a process finding (`severity=consider`, `axis=readability`); the builder bounces back with a real response. One iteration wasted.

**Composition.** `stages: ["always"]` carries the receive-feedback pattern wherever a specialist receives a finding-laden artifact (build during fix-only, review during re-iteration, ship during pre-merge sweep). The reviewer never receives findings as input (they author them); the receive-feedback pattern is for the **producers** of code or plan. Pairs with the Completion discipline section above and with the reviewer's anti-sycophancy `What's done well` gate.
