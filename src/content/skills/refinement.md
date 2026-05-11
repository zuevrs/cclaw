---
name: refinement
trigger: when /cc detects an existing plan (active or shipped) for the new task
---

# Skill: refinement

`/cc` performs existing-plan detection at the start of every invocation. When it finds a fuzzy match, the user is asked to choose one of:

- **amend** — keep the active plan, add new AC, leave already-committed AC intact;
- **rewrite** — replace the active plan body and AC entirely (commits remain in git, but AC ids restart);
- **refine shipped** — create a new plan with `refines: <old-slug>` linking to the shipped slug;
- **new** — start an unrelated plan.

## Rules for refinement

1. `refines: <old-slug>` is set in the new plan's frontmatter and must match a real shipped slug.
2. Do not move artifacts out of `.cclaw/flows/shipped/`. The shipped slug stays read-only.
3. The new plan can quote up to one paragraph from the shipped plan but must restate the full Context for the refinement.
4. AC ids restart at AC-1 in the new plan. Do not number "AC-13" because the shipped slug had 12 AC.
5. `knowledge.jsonl` will record the new entry with `refines: <old-slug>` so the index forms a chain.

## What the orchestrator surfaces

- last_specialist of the active plan, so the user can see "stopped mid-design (Phase 4 Decisions)" or "review iteration 3 in progress".
- The AC table with their statuses (`pending` / `committed`).
- Whether `security_flag` was set.
- A direct link to `.cclaw/flows/shipped/<slug>/ship.md` if the match is a shipped slug (`legacy-artifacts: true` also writes `manifest.md` alongside).
