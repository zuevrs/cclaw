---
name: plan-authoring
trigger: when writing or updating .cclaw/flows/<slug>/plan.md
---

# Skill: plan-authoring

Use this skill whenever you create or modify any `.cclaw/flows/<slug>/plan.md`.

## When NOT to apply

- **Inline / trivial flows (`triage.path == ["build"]`).** No `plan.md` is written; the orchestrator goes straight to the edit + commit.
- **Editing `flows/shipped/<slug>/plan.md`** — shipped artifacts are read-only history. A refinement creates a NEW slug whose plan carries `refines: <old-slug>`; the shipped plan stays untouched.
- **Authoring `build.md` / `review.md` / `ship.md` / `learnings.md`.** Each artifact has its own contract; this skill is plan-specific. The `summary-format` skill carries the shared three-section block all artifacts share.
- **Pure prose questions from the user** that produce no plan write. Reply directly; don't open a flow.

## Rules

1. **Frontmatter is mandatory.** Every plan starts with the YAML block from `.cclaw/lib/templates/plan.md`. Required keys: `slug`, `stage`, `status`, `ac`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`.
2. **AC ids are sequential** starting at `AC-1`. They must match the AC table inside the body.
3. **Each AC is observable.** Verification line is mandatory. If you cannot write the verification, the AC is not real.
4. **The traceability block at the end** is reconstructed by the reviewer via `git log --grep="(AC-N):" --oneline` at handoff and at ship time. The plan author writes the AC table and the `commit:` column may be left empty (or pre-filled with the expected commit message shape, e.g. `red(AC-N): ... → green(AC-N): ... → refactor(AC-N): ...`); the slice-builder appends actual SHAs to `build.md` and the reviewer cross-references them against the plan's AC list.
5. **Out-of-scope items** stay in the body. Do not let them leak into AC.

## When refining a shipped slug

- Quote at most one paragraph from `.cclaw/flows/shipped/<old-slug>/plan.md`.
- Set `refines: <old-slug>` in the new plan's frontmatter.
- Do not copy the shipped AC verbatim — write fresh AC for the refinement.

## What to refuse

- Plans without AC.
- Plans whose AC count exceeds 12 (split first).
- Plans that change scope between design (Phase 2 Frame) and ac-author without re-entering design's Phase 2 first.
