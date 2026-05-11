---
name: ac-traceability
trigger: when committing changes for an active cclaw run with ac_mode=strict
---

# Skill: ac-traceability

This skill applies only when the active flow's `ac_mode` is `strict` (set at the triage gate for large-risky / security-flagged work). In `inline` and `soft` modes the commit-helper still runs but does not enforce the AC↔commit chain — see `triage-gate.md` for what each mode does.

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
