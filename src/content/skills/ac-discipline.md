---
name: ac-discipline
trigger: when authoring or reviewing AC entries; when committing changes for an active cclaw run with ac_mode=strict
---

# Skill: ac-discipline

This merged skill covers both AC concerns: the bar for every AC entry (formerly **ac-quality**), and the commit-hook contract that wires AC ↔ commit chain in strict mode (formerly **ac-traceability**).

## When NOT to apply

- **Inline / trivial flows (`triage.acMode == "inline"`).** Single-line edits commit straight with plain `git commit`; no AC ids exist to trace.
- **Soft mode commit chain.** In `soft` the commit-helper is **advisory**, not blocking. Plain `git commit` is acceptable; the AC↔commit chain is not enforced.
- **Mid-flight AC additions to an existing plan.** Adding new AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug — never a mid-flight AC graft.
- **Renumbering AC ids after a delete.** Don't reuse `AC-3` because `AC-2` got removed; the remaining ids stay sequential after compaction without rewriting committed AC references.
- **Refinement slugs reading parent slug AC ids.** A refining slug restarts at `AC-1` even when the parent shipped slug had `AC-12`.
- **Strict mode commits via direct `git commit`.** The hook is mandatory in strict mode. Direct `git commit` produces a SHA the hook never recorded — the AC chain breaks and resume gets out of sync.

## ac-quality

Three checks per AC:

1. **Observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
2. **Independently committable** — a single commit covering only this AC is meaningful.
3. **Verifiable** — there is an explicit verification line (test name, manual step, or command).

## Smell check

| smell | example | rewrite |
| --- | --- | --- |
| sub-task | "implement the helper" | "search returns BM25-ranked results for queries with multiple terms" |
| vague verification | "tests pass" | "verified by tests/unit/search.test.ts: 'returns BM25-ranked hits'" |
| internal detail | "refactor the cache" | "cache hit rate >90% on the dashboard repaint scenario" |
| compound AC | "build the page and add analytics" | split into two AC |

## Numbering

- AC ids start at `AC-1` and are sequential.
- Refinement slugs restart at `AC-1` even when they refine a slug that had AC-1..AC-12.
- Do not reuse an AC id within the same slug; if you delete an AC, the remaining ids stay sequential after compaction.

## When to add an AC mid-flight

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a follow-up (`/cc-idea`) or a fresh slug.

## ac-traceability

This part of the skill applies only when the active flow's `ac_mode` is `strict` (set at the triage gate for large-risky / security-flagged work). In `inline` and `soft` modes the commit-helper still runs but does not enforce the AC↔commit chain — see `triage-gate.md` for what each mode does.

In `strict` mode, cclaw has one mandatory gate: every commit produced inside `/cc` references exactly one AC, and the AC ↔ commit chain is recorded in `flow-state.json`.

## Rules (strict mode)

1. Use `node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="..."` for every AC commit. Do not call `git commit` directly.
2. Stage only AC-related changes before invoking the hook.
3. The hook will refuse the commit if:
   - `AC-N` is not declared in the active plan;
   - `flow-state.json` schemaVersion is not the current cclaw schema;
   - nothing is staged.
4. After the commit succeeds, the hook records the SHA in `flow-state.json` under the matching AC and re-renders the traceability block in `flows/<slug>/plan.md`.
5. `runCompoundAndShip` refuses to ship a strict-mode slug with any pending AC. There is no override.

## In soft / inline modes

- The commit-helper is **advisory**, not blocking. It is fine to run plain `git commit` for soft-mode flows.
- A soft-mode plan has bullet-list testable conditions, not numbered AC IDs. There is no `AC-N` to reference.
- A single TDD cycle covers the whole feature; you do not run RED → GREEN → REFACTOR per condition.
- Ship gate is a single check ("all listed conditions verified"), not an AC-by-AC ledger.

## When you accidentally committed without the hook (strict mode only)

- `flow-state.json` is now out of sync with the working tree.
- Edit `.cclaw/state/flow-state.json` by hand to add the SHA to the matching AC entry and verify with the orchestrator before continuing. Do not run the hook with an empty stage to "patch" the state — the hook refuses empty stages by design.

## Common rationalizations

AC discipline is the first thing that pressures an agent to "just commit something" when iteration is slow. Catch yourself thinking the left column; do the right column. Surface the rationalization in `## Summary → Potential concerns` when you obey the right column anyway.

| rationalization | truth |
| --- | --- |
| "This AC is part of AC-2, I'll just bundle it under AC-2." | Compound AC fails the smell check — independently committable means one AC per commit. Split into a new AC with its own id; the audit trail and ship-gate need the separation. |
| "Verification is `tests pass`." | That's a vague verification; the smell check rejects it. Cite a specific test name + file + assertion (`tests/unit/permissions.test.ts: 'hides email when permission is missing'`). |
| "I'll renumber the ACs after I delete AC-2 — `AC-3` becomes the new `AC-2`." | Don't. The remaining ids stay sequential after compaction; renumbering breaks `flow-state.json > ac[i].id` references in already-recorded commits and the resume contract. |
| "I'll just `git commit` directly this once — the hook is slow." | The hook is the strict-mode contract. Bypassing it once breaks the AC↔commit chain for everyone downstream (resume, review, ship). Restore the chain or surface the script bug as a finding. |
| "I'll add AC-13 mid-build because I noticed something needed." | Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug. AC-13 mid-flight breaks the build sub-phase's commit budget. |
| "Refinement of `<old-slug>` so AC-1 starts at AC-13 (continuation)." | Refinement slugs restart at AC-1. The `refines:` frontmatter is the link; the AC numbering does not carry. |
| "The verification line is 'manual test' for this AC." | A manual step is a verification, but it must be **concrete** — name the click target, the expected observable, and the operator. "I clicked around and it looked fine" is the rationalization the reviewer catches. |
| "I'll inline the AC's text in the diff comment so the reviewer can see it." | The AC lives in `plan.md`, not in source comments. The reviewer reads the plan; inlining the AC text bloats the production diff with quoted plan prose. |
