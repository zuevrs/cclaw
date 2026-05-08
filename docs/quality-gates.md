---
title: "cclaw v8 quality gates"
status: locked
---

# Quality gates — v8

cclaw v8 has exactly one mandatory gate plus a documented review checklist and a post-ship learning gate. Everything else is opt-in.

## 1. AC traceability gate (mandatory, blocks ship)

Ship is blocked unless every AC in `flow-state.json` is `status: committed` with a real commit SHA. The gate is enforced inside `runCompoundAndShip()` (`src/compound.ts`) and surfaced via `commit-helper.mjs` for atomic per-AC commits.

How to satisfy it:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

The hook does **all** of the following inside one transaction:

1. Confirms `AC-1` is declared in `plans/<slug>.md` (refuses if missing).
2. Confirms `flow-state.json` `schemaVersion === 2` (refuses on legacy 7.x state).
3. Confirms there is something staged.
4. Runs `git commit -m "<message>\n\nrefs: AC-1"`.
5. Captures the new SHA via `git rev-parse HEAD`.
6. Writes the SHA back into the matching AC entry of `flow-state.json` (`status: committed`).
7. Re-renders the traceability block at the bottom of `plans/<slug>.md`.

If the user commits by hand, AC traceability breaks and ship will refuse. The recovery path is documented in the `ac-traceability` auto-trigger skill at `.cclaw/skills/ac-traceability.md`.

## 2. Five Failure Modes (review checklist; blocks ship per iteration)

Every review run must explicitly check:

1. **Hallucinated actions** — invented files, env vars, ids, function names.
2. **Scope creep** — changes outside declared AC.
3. **Cascading errors** — one fix breaks something else.
4. **Context loss** — earlier decisions or AC text forgotten.
5. **Tool misuse** — wrong mode, destructive action, force push.

Each item is answered yes/no, with a citation when "yes". A "yes" without a citation is itself a finding.

Findings go into `.cclaw/reviews/<slug>.md` with severity `block | warn | info` (plus `security` from `security-reviewer`) and AC refs. Block-level findings prevent ship until resolved by `slice-builder` in `fix-only` mode followed by re-review.

Hard cap: 5 review/fix iterations per slug. After the 5th, the reviewer writes `status: cap-reached` and the orchestrator surfaces the remaining blockers and recommends `/cc-cancel` or splitting the work into a fresh slug.

The wrapper around every review run is the `review-loop` auto-trigger skill. The mode-specific behaviour for security reviews is documented in the `security-review` auto-trigger skill.

## 3. Compound quality gate (post-ship; not a release gate)

`learnings/<slug>.md` is written only when at least one of the following is true:

- a non-trivial decision was recorded by `architect` or `planner`;
- review needed ≥3 iterations;
- a security review ran or `security_flag` is true;
- the user explicitly asked for capture (`/cc <task> --capture-learnings`).

When the gate passes, the orchestrator also appends one line to `.cclaw/knowledge.jsonl` with the slug, ship_commit, shipped_at, signals, and optional `refines` link. The append is type-checked at runtime by `src/knowledge-store.ts`; corrupt entries are rejected on read.

This is **not** a release gate — ship still completes when the gate fails. It is a noise filter for `knowledge.jsonl`.

## What is **not** a gate any more

The following 7.x stage gates were removed:

- mandatory `brainstorm_*` evidence
- mandatory `scope_*` checklists
- mandatory `design_*` artefacts
- mandatory `spec_*` review army findings
- mandatory `tdd_*` per-slice red checkpoints
- mandatory `delegation_*` records
- mandatory `managed-resources` drift detection (now install-time)
- mandatory `flow-state.guard.json` sidecar checksum

If a 7.x project relied on any of these, fold the relevant content into `plan.md` or call the right specialist on demand.
