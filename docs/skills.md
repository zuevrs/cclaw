---
title: "cclaw v8 auto-trigger skills"
status: locked
---

# Auto-trigger skills

cclaw v8 ships six auto-trigger skills under `.cclaw/skills/` (mirrored to your harness, e.g. `.cursor/skills/cclaw/`). Each skill is a short markdown file with a YAML-style header declaring its trigger pattern. Harnesses that support skill auto-loading (Cursor, Claude with Skills, OpenCode) attach the relevant skill into context whenever its trigger fires; harnesses that do not still ship the files for the user and orchestrator to read manually.

Skills are intentionally **separate** from agents. Agents are *invoked* (a specialist run); skills are *attached* (always-on guidance for a particular activity).

## Skills shipped by default

| id | trigger | what it enforces |
| --- | --- | --- |
| `plan-authoring` | edit/create `.cclaw/plans/<slug>.md` | mandatory frontmatter, AC numbering, observable AC, traceability block hand-off to `commit-helper.mjs` |
| `ac-traceability` | before any commit / push during `/cc` | every commit goes through `commit-helper.mjs --ac=AC-N`, schemaVersion=2 check, refusal of bare `git commit` |
| `refinement` | `/cc` detects an existing plan match | choices: amend / rewrite / refine shipped / resume cancelled / new; refinement uses `refines: <old-slug>` and restarts AC ids at AC-1 |
| `parallel-build` | planner topology = `parallel-build` | pre-conditions (≥4 AC, disjoint files, no inter-AC deps), per-slice ownership, mandatory integration reviewer |
| `security-review` | diff touches authn / authz / secrets / supply chain / data exposure | threat-model checklist (5 items), `security_flag: true`, fix-only loop |
| `review-loop` | `reviewer` or `security-reviewer` invoked | Five Failure Modes pass per iteration, hard cap of 5 iterations, `cap-reached` status |

## Why skills

The 7.x harness inlined this guidance inside specialist prompts. Result: every prompt was huge, contradictions appeared between prompts, and the user could not see what the agent was actually expected to do without reading 40 KB of internal markdown.

In v8 each skill is one short, focused file (≤2 KB). The orchestrator references them by id from `/cc` and from each specialist's prompt. The user can audit them, override them in `.cclaw/skills/`, or extend them per project.

## Authoring rules

- A skill must declare its trigger and stay narrow. If a skill grows past 50 lines, split it into two.
- Skills must not contradict the orchestrator (`/cc`) or any specialist prompt. When in doubt, fix the skill, not the agent.
- A skill may reference other skills by id but must not transitively load them — the harness decides activation.

## Update path

`cclaw sync` and `cclaw upgrade` rewrite the shipped skills under `.cclaw/skills/`. Custom skills you author **outside** the cclaw directory are untouched. To override a default skill, copy its file out of `.cclaw/skills/` and edit it in place — the orchestrator will read both the default and your override; deduplication picks the project copy when there is a conflict.
