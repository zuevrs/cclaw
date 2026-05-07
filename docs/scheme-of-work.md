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
[2] Existing-plan detection (active + shipped + cancelled, frontmatter-aware)
[3] Phase 0 calibration (targeted vs multi-component)
[4] Routing class:
       trivial      → edit + commit per AC, no plan.md
       small/medium → plan.md inline → build → review → ship
       large/risky  → propose specialists, then inline
[5] Plan template seeded from .cclaw/templates/plan.md
[6] Build slices, commit per AC via .cclaw/hooks/commit-helper.mjs
[7] Review (Five Failure Modes; hard cap 5 iterations)
[8] Ship (writes ships/<slug>.md from template; asks before push/PR)
[9] Compound (automatic; quality gate; learnings/<slug>.md when gated)
[10] Active → shipped/<slug>/ move + manifest.md
```

## Step-by-step

### 1. Sanity check

`/cc` reads `.cclaw/state/flow-state.json` and verifies `schemaVersion: 2`. If it sees a 7.x file, it stops and asks the user to finish/abandon the old run, delete the file, or start fresh. There is no auto-migration.

### 2. Existing-plan detection (frontmatter-aware)

`/cc` globs `.cclaw/plans/*.md`, `.cclaw/shipped/*/plan.md`, and `.cclaw/cancelled/*/plan.md`. For each match it parses the YAML frontmatter and surfaces:

- slug, status (`active` | `shipped` | `cancelled`),
- `last_specialist` — so you see "stopped at architect",
- AC progress (`committed` / `pending` / `total`),
- `security_flag`,
- `refines` chain — so you can see if the prior slug refined an even earlier slug.

The user picks one of: **amend / rewrite / new** for active matches; **refine shipped / new unrelated** for shipped matches; **resume from cancelled / new** for cancelled matches. Refinement is part of `/cc`; there is no `/cc-amend`.

### 3. Phase 0 calibration

A single short question: "targeted change in one place, or multi-component feature?" The answer plus repository signals (file count, scope keywords, length of prompt) decide the routing class.

### 4. Routing class

| Class | Trigger | What runs |
| --- | --- | --- |
| trivial | typo / format / rename / docs-only edit, ≤1 file, ≤30 lines | edit + commit per AC; no `plan.md` |
| small/medium | new functionality in 1-3 modules, 1-5 AC | inline plan/build/review/ship |
| large/risky | >5 AC, ambiguous prompt, architectural decision, security-sensitive | propose specialists |

For large/risky tasks the orchestrator proposes `brainstormer → architect → planner` in sequence. The user can stop after any checkpoint and continue with what is already in `plan.md`.

### 5. Plan template

If you are starting a new plan (no existing match), `/cc` seeds `plans/<slug>.md` from `.cclaw/templates/plan.md` with the slug substituted. The template includes:

- mandatory YAML frontmatter (`slug`, `stage`, `status`, `ac[]`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`);
- body sections: Context, Frame, Scope, (Alternatives considered), Architecture, Plan, Acceptance Criteria, Topology, Traceability block.

Each AC must be observable (a user, test, or operator can verify it without reading the diff). Each AC has a one-line verification.

### 6. Build

`slice-builder` (or inline edit for small tasks) implements one AC at a time. Each AC closes with:

```bash
git add ...
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="…"
```

The hook validates that `AC-1` is declared in plan.md, runs `git commit`, captures the SHA, and updates `flow-state.json`. The implementation log goes to `.cclaw/builds/<slug>.md`, seeded from `.cclaw/templates/build.md`.

For `parallel-build` topology (planner-recommended only when ≥4 AC, disjoint file sets, no inter-AC deps), the orchestrator spawns one `slice-builder` per slice and a `reviewer` in `integration` mode after the wave finishes. The `parallel-build` auto-trigger skill at `.cclaw/skills/parallel-build.md` carries the playbook.

### 7. Review

`reviewer` runs in one or more modes (`code`, `text-review`, `integration`, `release`, `adversarial`). `security-reviewer` runs only when relevant. Findings live in `.cclaw/reviews/<slug>.md`, seeded from `.cclaw/templates/review.md`. The Five Failure Modes pass is mandatory:

1. Hallucinated actions
2. Scope creep
3. Cascading errors
4. Context loss
5. Tool misuse

Hard cap: 5 review/fix iterations. After the 5th, stop and report what remains. See [docs/quality-gates.md](quality-gates.md).

### 8. Ship

Writes `.cclaw/ships/<slug>.md` from `.cclaw/templates/ship.md` with:

- summary,
- AC ↔ commit map,
- push / PR refs (both `pending` until the user explicitly approves),
- breaking changes / migration notes,
- a one-paragraph release note suitable for `CHANGELOG.md`.

Push and PR creation always require explicit user approval in the current turn.

### 9. Compound (automatic)

Captures `learnings/<slug>.md` (from template) only when at least one signal is present:

- non-trivial decision recorded by `architect` or `planner`,
- review needed ≥3 iterations,
- security review ran or `security_flag` is true,
- the user explicitly asked.

If the gate passes, one line is appended to `.cclaw/knowledge.jsonl` referencing the slug, ship_commit, shipped_at, signals, and optional `refines` link.

### 10. Active → shipped move

All `<slug>.md` files in `plans/ builds/ reviews/ ships/ decisions/ learnings/` move to `.cclaw/shipped/<slug>/` as `plan.md`, `build.md`, etc. A `manifest.md` (from `.cclaw/templates/manifest.md`) lists artifacts, AC, and any `refines` chain. Then `flow-state.json` resets.

## Cancellation path

`/cc-cancel` moves every active `<slug>.md` into `.cclaw/cancelled/<slug>/`, writes a `manifest.md` with the cancel reason, and resets `flow-state.json`. The artifacts stay readable; resuming a cancelled run is a first-class option in existing-plan detection.

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
.cclaw/cancelled/<slug>/manifest.md (after /cc-cancel, if used)
.cclaw/knowledge.jsonl             (append only when gated)
```

Anything else is unexpected and should be removed in `cclaw sync`.
