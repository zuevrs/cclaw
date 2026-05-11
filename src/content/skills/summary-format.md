---
name: summary-format
trigger: every authored cclaw artifact (plan.md, decisions.md, build.md, review.md, ship.md, learnings.md). Always-on for any specialist that writes one of those files.
---

# Skill: summary-format

Every cclaw artifact ends with a **standardised three-section Summary block**. The slim summary the specialist returns to the orchestrator stays terse (≤6 lines); the Summary block in the artifact is the **durable record** of what changed and what didn't.

The three-section shape is taken directly from the addyosmani-skills git-workflow standard: it surfaces scope creep and uncertainty *to the next reader*, instead of relying on memory or clean-up passes that never happen.

## When to use

Always-on for any specialist that authors a cclaw artifact: `plan.md` (planner / design), `decisions.md` (design Phase 4 on legacy flows), `build.md` (slice-builder), `review.md` (reviewer / security-reviewer per iteration), `ship.md` (slice-builder at ship dispatch), `learnings.md` (the learnings sub-agent). The slim-summary contract — six lines max, `Stage: …`, `What changed: …`, `Next: …`, `Confidence: …` — is enforced on every dispatch return; the artifact Summary block is appended at write time.

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
- <e.g. "Migration step in D-1 may interact with the seed script — flagged for security-reviewer">
- if there is nothing, write `None.`.
```

The block goes at the very bottom of the artifact, after the body, after any worked examples, after any prior-iteration material. One block per artifact write. Multi-author files (plan.md on large-risky) get **one Summary per author**, with a heading suffix:

```markdown
## Summary — design
### Changes made
...
## Summary — planner
### Changes made
...
```

This way the next reader sees who wrote what and can attribute the "Things I noticed" / "Potential concerns" to the right specialist.

## What goes in each section

### `Changes made`

Plain past-tense bullets. **Concrete**, not "implemented the plan". Each bullet is a thing a reviewer can verify in the diff or in the artifact. AC ids, D-N ids, F-N ids, file paths, commit shas — citations welcome.

### `Things I noticed but didn't touch`

This is the **anti-scope-creep section**. Force yourself to list the things you *chose not to fix while you were nearby*. Stale TODOs, unrelated bugs, sibling-file issues, tests that pass but feel wrong, dead code, mismatched naming.

The point is to **resist the urge to fix everything** — surface it here so the next slug owner can decide. A specialist that silently fixed sibling issues is a specialist that broke scope discipline; the reviewer flags that.

If the touch surface really was clean, write `None.` (one word + period). Do not invent items to fill the section.

### `Potential concerns`

Forward-looking. What might bite the **next stage** or **the user**? Uncertainties, partial coverage, untested edges, decisions you made under low confidence, dependencies on external systems, migration footguns.

Drop `Confidence: low` items here verbatim with a one-line cause. The reviewer can use this section to seed the Concern Ledger.

If there are no real concerns, write `None.` and own it.

## Hard rules

- **All three subheadings present.** Even when one is empty, the H3 heading + `None.` line stays. Skipping a subheading is a finding (reviewer axis=readability, severity=consider).
- **No prose paragraphs in the block.** Bullets only. The block is read fast; paragraphs are read slow.
- **No new findings here.** If you have a finding, surface it in the slim summary and (if reviewer) in the Concern Ledger. The Summary block is reflective, not active.
- **No fabrication.** `Things I noticed but didn't touch` is not the place to invent improvements you didn't actually consider; it is the place to record the ones you did.
- **No copy-paste between artifacts.** Each artifact's Summary block is unique to that artifact's authorship.

## Specialist contracts

| Specialist | Block goes in |
| --- | --- |
| `design` | `flows/<slug>/plan.md` (heading: `## Summary — design`) — single block at the bottom of design's appended sections (Frame, Approaches, Selected Direction, optional Decisions, optional Pre-mortem, Not Doing) |
| `planner` | `flows/<slug>/plan.md` (heading: `## Summary — planner` on large-risky; `## Summary` on small/medium) |
| `slice-builder` | `flows/<slug>/build.md` (heading: `## Summary` per cycle in soft mode; per fix-iteration in fix-only mode; per slice in parallel-build) |
| `reviewer` | `flows/<slug>/review.md` per iteration (heading: `## Summary — iteration N`) — sits right above the next iteration block |
| `security-reviewer` | `flows/<slug>/review.md` security section (heading: `## Summary — security`) |
| ship synthesis | `flows/<slug>/ship.md` (heading: `## Summary`) |

## Common pitfalls

- Filling `Changes made` with implementation details copied from the body. The body is the body; the Summary is the executive view.
- Skipping `Things I noticed but didn't touch` because "I did everything that needed doing". This is the section that catches scope drift before it ships.
- Using `Potential concerns` as a TODO list. It is a risk register, not a backlog. Concrete, future-tense risks only.
- Multi-author plan.md getting one combined Summary at the end. Each author writes their own.

## Worked example — planner Summary on small/medium

```markdown
## Summary

### Changes made
- Authored 3 AC covering the dashboard tooltip behaviour: AC-1 (renders email when permitted), AC-2 (250ms hover), AC-3 (display-name fallback).
- Pinned touch surface to 3 files: `src/lib/permissions.ts`, `src/components/dashboard/RequestCard.tsx`, `tests/unit/RequestCard.test.tsx`.
- Recorded prior lesson from `shipped/dashboard-status-pill` (verbatim quote in `## Prior lessons applied`).

### Things I noticed but didn't touch
- `src/components/dashboard/RequestCard.tsx:140` has a `useMemo` whose deps include `Date.now()` — re-renders every minute. Outside this slug's AC; flagging in case slice-builder or reviewer wants to surface as a follow-up.
- `tests/unit/RequestCard.test.tsx` uses ad-hoc fixtures instead of `makeUserFixture()`; same pattern as a prior shipped slug. Not in scope here.

### Potential concerns
- AC-1 verification depends on the `hasViewEmail` helper not yet existing; slice-builder will create it. RED test must fail because the export is missing, not because of an import error.
- The 250ms token in AC-2 lives in `src/styles/tokens.css`, not in JS. If slice-builder reads the value from JS state instead of the CSS token, AC-2 is a flake risk.
```
