---
name: plan-authoring
trigger: when writing or updating .cclaw/flows/<slug>/plan.md
---

# Skill: plan-authoring

Use this skill whenever you create or modify any `.cclaw/flows/<slug>/plan.md`.

## Rules

1. **Frontmatter is mandatory.** Every plan starts with the YAML block from `.cclaw/lib/templates/plan.md`. Required keys: `slug`, `stage`, `status`, `ac`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`.
2. **AC ids are sequential** starting at `AC-1`. They must match the AC table inside the body.
3. **Each AC is observable.** Verification line is mandatory. If you cannot write the verification, the AC is not real.
4. **The traceability block at the end** is rebuilt by `commit-helper.mjs`. Do not edit it by hand once a commit was recorded.
5. **Out-of-scope items** stay in the body. Do not let them leak into AC.

## When refining a shipped slug

- Quote at most one paragraph from `.cclaw/flows/shipped/<old-slug>/plan.md`.
- Set `refines: <old-slug>` in the new plan's frontmatter.
- Do not copy the shipped AC verbatim — write fresh AC for the refinement.

## What to refuse

- Plans without AC.
- Plans whose AC count exceeds 12 (split first).
- Plans that change scope between design (Phase 2 Frame) and ac-author without re-entering design's Phase 2 first.
