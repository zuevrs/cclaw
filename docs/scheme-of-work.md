---
title: "cclaw v8 scheme of work"
status: locked
---

# Scheme of work — cclaw v8

cclaw v8 has one entry point (`/cc <task>`) and four stages (`plan`, `build`, `review`, `ship`). This doc walks through what happens at each stage and where artifacts land.

## Lifecycle

```
/cc task
   │
   ▼
[1] Sanity check (schemaVersion = 2; if 1, stop and offer choices)
[2] Existing-plan detection (active + shipped)
[3] Phase 0 calibration (targeted vs multi-component)
[4] Routing class:
       trivial      → edit + commit per AC, no plan.md
       small/medium → plan.md inline → build → review → ship
       large/risky  → propose specialists, then inline
[5] Build slices, commit per AC via .cclaw/hooks/commit-helper.mjs
[6] Review (Five Failure Modes; hard cap 5 iterations)
[7] Ship (writes ships/<slug>.md, asks before push/PR)
[8] Compound (automatic; quality gate; learnings/<slug>.md when gated)
[9] Active → shipped/<slug>/ move + manifest.md
```

## Step-by-step

### 1. Sanity check

`/cc` reads `.cclaw/state/flow-state.json` and verifies `schemaVersion: 2`. If it sees a 7.x file, it stops and asks the user to finish/abandon the old run, delete the file, or start fresh.

### 2. Existing-plan detection

`/cc` globs `.cclaw/plans/*.md` and `.cclaw/shipped/*/plan.md`. If a slug or body fuzzy-matches the new task:

- active match → ask **amend / rewrite / new**.
- shipped match → ask **refine shipped <slug> / new unrelated plan**.

There is no `/cc-amend`. Refinement is part of `/cc`.

### 3. Phase 0 calibration

A single short question: "targeted change in one place, or multi-component feature?" The answer plus repository signals (file count, scope keywords, length of prompt) decide the routing class.

### 4. Routing class

| Class | Trigger | What runs |
| --- | --- | --- |
| trivial | typo / format / rename / docs-only edit, ≤1 file, ≤30 lines | edit + commit per AC; no `plan.md` |
| small/medium | new functionality in 1-3 modules, 1-5 AC | inline plan/build/review/ship |
| large/risky | >5 AC, ambiguous prompt, architectural decision, security-sensitive | propose specialists |

For large/risky tasks the orchestrator proposes `brainstormer → architect → planner` in sequence. The user can stop after any checkpoint and continue with what is already in `plan.md`.

### 5. Build

`slice-builder` (or inline edit for small tasks) implements one AC at a time. Each AC closes with:

```bash
git add ...
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="…"
```

The hook validates that `AC-1` is declared in plan.md, runs `git commit`, and updates `flow-state.json` with the new SHA. The implementation log goes to `.cclaw/builds/<slug>.md`.

### 6. Review

`reviewer` runs in one or more modes (`code`, `text-review`, `integration`, `release`, `adversarial`). `security-reviewer` runs only when relevant. The Five Failure Modes checklist is mandatory:

1. Hallucinated actions
2. Scope creep
3. Cascading errors
4. Context loss
5. Tool misuse

Hard cap: 5 review/fix iterations. After the 5th, stop and report what remains.

### 7. Ship

Writes `.cclaw/ships/<slug>.md` with release notes and verified AC ↔ commit map. Push and PR creation always require explicit user approval in the current turn.

### 8. Compound (automatic)

Captures `learnings/<slug>.md` only when at least one signal is present:

- non-trivial decision recorded by `architect` or `planner`,
- review needed ≥3 iterations,
- security review ran or `security_flag` is true,
- the user explicitly asked.

If the gate passes, one line is appended to `.cclaw/knowledge.jsonl` referencing the slug + ship_commit.

### 9. Active → shipped move

All `<slug>.md` files in `plans/ builds/ reviews/ ships/ decisions/ learnings/` move to `.cclaw/shipped/<slug>/` as `plan.md`, `build.md`, etc. A short `manifest.md` lists artifacts and AC. Then `flow-state.json` resets.

## Files written during a run

```
.cclaw/state/flow-state.json
.cclaw/plans/<slug>.md
.cclaw/builds/<slug>.md
.cclaw/reviews/<slug>.md
.cclaw/decisions/<slug>.md         (optional, by architect)
.cclaw/learnings/<slug>.md         (optional, when gated)
.cclaw/ships/<slug>.md
.cclaw/shipped/<slug>/manifest.md  (after ship)
.cclaw/knowledge.jsonl             (append only when gated)
```

Anything else is unexpected and should be removed in `cclaw sync`.
