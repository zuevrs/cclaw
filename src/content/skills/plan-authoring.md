---
name: plan-authoring
trigger: when writing or updating .cclaw/flows/<slug>/plan.md; also when /cc detects an existing plan match (amend / rewrite / refine-shipped / new decision tree)
---

# Skill: plan-authoring

Use this skill whenever you create or modify any `.cclaw/flows/<slug>/plan.md`. It also carries the **existing-plan-match decision tree** (absorbed from `refinement`): when `/cc <task>` collides with an active flow or fuzzy-matches a recently shipped slug, the Detect matrix opens the amend / rewrite / refine-shipped / new picker — the rules for each arm live in the **Refinement decision tree** section at the end.

## When NOT to apply

- **Inline / trivial flows (`triage.path == ["build"]`).** No `plan.md` is written; the orchestrator goes straight to the edit + commit.
- **Editing `flows/shipped/<slug>/plan.md`** — shipped artifacts are read-only history. A refinement creates a NEW slug whose plan carries `refines: <old-slug>`; the shipped plan stays untouched.
- **Authoring `build.md` / `review.md` / `ship.md` / `learnings.md`.** Each artifact has its own contract; this skill is plan-specific. The `summary-format` skill carries the shared three-section block all artifacts share.
- **Pure prose questions from the user** that produce no plan write. Reply directly; don't open a flow.

## Rules

1. **Frontmatter is mandatory.** Every plan starts with the YAML block from `.cclaw/lib/templates/plan.md`. Required keys: `slug`, `stage`, `status`, `ac`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`.
2. **AC ids are sequential** starting at `AC-1`. They must match the AC table inside the body.
3. **Each AC is observable.** Verification line is mandatory. If you cannot write the verification, the AC is not real.
4. **The traceability block at the end** is reconstructed by the reviewer at handoff and at ship time via a dual grep: `git log --grep="(SL-N):" --oneline` for slice work + `git log --grep="verify(AC-N):" --oneline` for AC verification (split). The plan author writes the Slices + Acceptance Criteria tables; the slice rows' `commits` column may be left empty (or pre-filled with the expected message shape, e.g. `red(SL-N): ... → green(SL-N): ... → refactor(SL-N): ...`), and the AC rows' `commit:` column expects one `verify(AC-N): passing` SHA each. The builder appends actual SHAs to `build.md`; the reviewer cross-references them against the plan's Slices + AC lists.
5. **Out-of-scope items** stay in the body. Do not let them leak into AC.

## When refining a shipped slug

- Quote at most one paragraph from `.cclaw/flows/shipped/<old-slug>/plan.md`.
- Set `refines: <old-slug>` in the new plan's frontmatter.
- Do not copy the shipped AC verbatim — write fresh AC for the refinement.

## What to refuse

- Plans without AC.
- Plans whose AC count exceeds 12 (split first).
- Plans that change scope between the architect's Frame phase and the AC table without re-entering the Frame phase first.

---

# Refinement decision tree (absorbed `refinement`)

`/cc` performs existing-plan detection at the start of every invocation. When it finds a fuzzy match, the user is asked to choose one of:

- **amend** — keep the active plan, add new AC, leave already-committed AC intact;
- **rewrite** — replace the active plan body and AC entirely (commits remain in git, but AC ids restart);
- **refine shipped** — create a new plan with `refines: <old-slug>` linking to the shipped slug;
- **new** — start an unrelated plan.

## When to use

Triggered by the Detect matrix (in `start-command.md > Detect — /cc invocation matrix`) when a fresh `/cc <task>` collides with an active flow or fuzzy-matches a recently shipped slug. Skipped on `/cc` (no argument) — that's pure resume, not refinement. Skipped on `/cc-cancel`.

## When NOT to apply (refinement)

- **Resume gesture (`/cc` with no task argument).** That is a pure resume of the active slug per the Detect matrix; the refinement decision tree is not opened.
- **`/cc-cancel`.** Cancel shelves the active flow; no refinement decision is opened.
- **Fresh task with no slug-fuzzy-match.** The picker doesn't fire when the prompt has nothing nearby; the triage sub-agent (`.cclaw/lib/agents/triage.md`) runs from a clean slate via `runbooks/triage-gate.md`.
- **User picked "new" at the collision picker.** The picker output is a fork: refinement-vs-new. Once "new" was chosen, the refinement decision tree is closed for the rest of the flow.

## Common pitfalls

See `start-command.md > Detect — /cc invocation matrix` (and the canonical `runbooks/detect-matrix.md`) for the full resume-vs-collision UX; the **When refining a shipped slug** rules above govern a refining plan's frontmatter and AC. This section carries only the refinement-specific decision tree.

## Rules for refinement

1. `refines: <old-slug>` is set in the new plan's frontmatter and must match a real shipped slug.
2. Do not move artifacts out of `.cclaw/flows/shipped/`. The shipped slug stays read-only.
3. The new plan can quote up to one paragraph from the shipped plan but must restate the full Context for the refinement.
4. AC ids restart at AC-1 in the new plan. Do not number "AC-13" because the shipped slug had 12 AC.
5. `knowledge.jsonl` will record the new entry with `refines: <old-slug>` so the index forms a chain.

## What the orchestrator surfaces

- last_specialist of the active plan, so the user can see "stopped mid-architect (Decisions phase)" or "review iteration 3 in progress".
- The AC table with their statuses (`pending` / `committed`).
- Whether `security_flag` was set.
- A direct link to `.cclaw/flows/shipped/<slug>/ship.md` if the match is a shipped slug (`legacy-artifacts: true` also writes `manifest.md` alongside).
