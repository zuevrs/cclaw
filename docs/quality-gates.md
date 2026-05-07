---
title: "cclaw v8 quality gates"
status: locked
---

# Quality gates — v8

cclaw v8 has exactly one mandatory gate plus a documented review checklist. Everything else is opt-in.

## 1. AC traceability gate (mandatory)

Ship is blocked unless every AC in `flow-state.json` is `status: committed` with a commit SHA. The gate is enforced inside `runCompoundAndShip()` in `src/compound.ts` and surfaced via `commit-helper.mjs` for atomic per-AC commits.

How to satisfy it:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

The hook validates that `AC-1` is declared in plan.md, runs `git commit`, and updates `flow-state.json` with the SHA. If you commit by hand, you must update the AC entry in flow-state manually before invoking the ship step.

## 2. Five Failure Modes (review checklist)

Every review run must check:

1. **Hallucinated actions** — invented files, env vars, ids, function names.
2. **Scope creep** — changes outside declared AC.
3. **Cascading errors** — one fix breaks something else.
4. **Context loss** — earlier decisions or AC text forgotten.
5. **Tool misuse** — wrong mode, destructive action, force push.

Findings go into `.cclaw/reviews/<slug>.md` with severity `block | warn | info` and AC refs. Block-level findings prevent ship until resolved.

Hard cap: stop after 5 review/fix iterations and report the remaining blockers.

## 3. Compound quality gate (post-ship)

`learnings/<slug>.md` is written only when at least one of the following is true:

- a non-trivial decision was recorded by `architect` or `planner`;
- review needed ≥3 iterations;
- a security review ran or `security_flag` is true;
- the user explicitly asked for capture.

This is not a release gate — ship still completes when the gate fails. It is a noise filter for `knowledge.jsonl`.

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
