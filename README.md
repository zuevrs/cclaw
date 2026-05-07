# cclaw

**cclaw is a lightweight harness-first flow toolkit for coding agents.** It installs three slash commands, six on-demand specialists, ten auto-trigger skills, ten artifact templates, four stage runbooks, eight reference patterns, five research playbooks, five recovery playbooks, thirteen worked examples, an antipatterns library, a decision protocol, a meta-skill, and a tiny runtime — together a deep content layer (~206 KB on a Cursor install) wrapped around a runtime under 1 KLOC — so Claude Code, Cursor, OpenCode, or Codex can move from idea to shipped change with a clear plan, AC traceability, and almost no ceremony.

```text
        idea
         │
         ▼
     /cc <task>
         │
   ┌─────┴─────────────────────────────────────┐
   │ Phase 0 calibration:                      │
   │ targeted change or multi-component?       │
   └─────┬─────────────────┬───────────────────┘
         │trivial          │small/medium       │large/risky
         ▼                 ▼                   ▼
    edit + commit     plan → build       brainstormer →
    per AC            → review → ship    architect → planner
                                         (each is optional)
                              │
                              ▼
                     compound (auto, gated)
                              │
                              ▼
                  active artifacts → shipped/<slug>/
```

Three slash commands. Four stages. Six specialists. Ten skills. Ten templates. Four runbooks. Eight reference patterns. Five research playbooks. Five recovery playbooks. Thirteen worked examples. One mandatory gate (AC traceability).

## What changed in v8

cclaw v8.0 is a breaking redesign. We dropped the 7.x stage machine: no more `brainstorm` / `scope` / `design` / `spec` / `tdd` mandatory stages, no more 18 specialists, no more 9 state files, no more 30 stage gates. v7.x runs are not migrated; see [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md).

What we kept and made deeper:

- plans with **acceptance criteria + YAML frontmatter** (`slug`, `stage`, `status`, `ac[]`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`);
- **AC ↔ commit traceability** enforced by `commit-helper.mjs`;
- **artifact templates** for every stage (`plan`, `build`, `review`, `ship`, `decisions`, `learnings`, `manifest`, `ideas`, `agents-block`, `iron-laws`);
- **ten auto-trigger skills** — plan-authoring, AC traceability, refinement, parallel-build, security-review, review-loop, commit-message-quality, AC-quality, refactor-safety, breaking-changes, plus a meta-skill that ties them together;
- **stage runbooks** (`.cclaw/runbooks/{plan,build,review,ship}.md`) — strict checklists per stage with common pitfalls;
- **reference patterns** (`.cclaw/patterns/`) — eight task-type playbooks (api-endpoint, auth-flow, schema-migration, ui-component, perf-fix, refactor, security-hardening, doc-rewrite) the orchestrator opens before authoring AC;
- **research playbooks** (`.cclaw/research/`) — read-before-write, reading tests, reading dependencies, time-boxing, using prior shipped slugs;
- **recovery playbooks** (`.cclaw/recovery/`) — AC traceability break, review hard cap reached, parallel-build slice conflict, frontmatter corruption, schemaVersion mismatch;
- **examples library** (`.cclaw/examples/`) — thirteen real-looking plan / build / review / ship / decision / learning / orchestrator-prompt artifacts;
- **antipatterns** (`.cclaw/antipatterns.md`) — twelve known failure modes the reviewer cites as findings;
- **decision protocol** (`.cclaw/decisions/decision-protocol.md`) — exact D-N record format with three worked examples;
- **resumable refinement** via frontmatter on shipped slugs (`refines: <old-slug>`);
- durable artifacts your team and graph tools (Graphify, GitNexus, etc.) can index.

## First 5 minutes

Requirements: Node.js 20+ and a git project.

```bash
cd /path/to/your/repo
npx cclaw-cli init                # default harness: cursor
npx cclaw-cli init --harness=claude,cursor,opencode,codex
```

Then work entirely inside your harness:

```text
/cc <task>          plan / build / review / ship — orchestrator routes everything
/cc-cancel          stop the active run cleanly (artifacts kept under .cclaw/cancelled/)
/cc-idea            drop a half-formed idea into .cclaw/ideas.md (no flow started)
```

There is no `cclaw plan`, `cclaw status`, `cclaw ship`, or `cclaw migrate` CLI command. Flow control lives in `/cc` inside the harness.

## Six specialists, all on demand

| id | modes | when |
| --- | --- | --- |
| `brainstormer` | frame / scope / alternatives | ambiguous request, need a frame and scope |
| `architect` | architecture / feasibility | structural decisions or feasibility check |
| `planner` | research / work-breakdown / topology | breaking work into AC and choosing topology |
| `reviewer` | code / text-review / integration / release / adversarial | reviews of any kind |
| `security-reviewer` | threat-model / sensitive-change | auth / secrets / supply chain / data exposure |
| `slice-builder` | build / fix-only | implementing AC and applying scoped fixes |

Specialists are proposed only when the task is large, abstract, risky, security-sensitive, or spans multiple components. Trivial and small/medium tasks run inline. Each prompt is 150-280 lines and includes an explicit output schema, two or more worked examples, edge cases, common pitfalls, and hard rules (see `.cclaw/agents/*.md` after install). The orchestrator pulls additional context from runbooks, patterns, examples, and recovery playbooks as needed; see [docs/skills.md](docs/skills.md) for the auto-trigger layer that wraps every invocation.

## Plan artifact, by example

```yaml
---
slug: approval-page
stage: plan
status: active
ac:
  - id: AC-1
    text: "User sees an approval status pill on the dashboard."
    status: pending
  - id: AC-2
    text: "Pending approvals show a tooltip with the approver's name."
    status: pending
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# approval-page

> One paragraph: what we are doing and why.

## Acceptance Criteria

| id | text | status | commit |
| --- | --- | --- | --- |
| AC-1 | User sees an approval status pill on the dashboard. | pending | — |
| AC-2 | Pending approvals show a tooltip with the approver's name. | pending | — |
```

The same shape applies to `build.md` (commit log), `review.md` (findings + Five Failure Modes pass), `ship.md` (release notes + push/PR refs), `decisions.md` (architect output), `learnings.md` (compound output). Templates live in `.cclaw/templates/`.

## Artifact tree

```
.cclaw/
  plans/<slug>.md           current work + AC + traceability block
  builds/<slug>.md          implementation log
  reviews/<slug>.md         findings, iterations, Five Failure Modes pass
  ships/<slug>.md           release notes, push/PR refs
  decisions/<slug>.md       architect output (D-N entries)
  learnings/<slug>.md       compound output (only when gated)
  state/flow-state.json     ~500 bytes, schemaVersion: 2
  shipped/<slug>/           plan.md, build.md, review.md, ship.md,
                            decisions.md, learnings.md, manifest.md
  cancelled/<slug>/         when /cc-cancel is invoked
  templates/                10 templates, copied at install
  agents/                   6 specialist prompts, copied at install
  skills/                   6 auto-trigger skills, copied at install
  hooks/                    3 node hooks (session-start, stop-handoff, commit-helper)
  ideas.md                  append-only idea backlog
  knowledge.jsonl           cross-feature learnings index, append-only
```

## AC traceability gate (mandatory)

Ship is blocked unless every AC in the active plan is `status: committed` with a real commit SHA. The `commit-helper.mjs` hook is the only supported way to commit during `/cc`:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

The hook checks that `AC-1` is declared in `plan.md`, refuses to run when `flow-state.json` schemaVersion is not `2`, runs `git commit`, captures the new SHA, and writes it back into `flow-state.json`. If you commit by hand, AC traceability breaks and ship will refuse.

## Compound learnings (automatic, gated)

After ship, cclaw automatically checks whether the run produced something worth remembering:

- a non-trivial decision was recorded by `architect` or `planner`, **or**
- review needed three or more iterations, **or**
- a security review ran or `security_flag` is true, **or**
- the user explicitly asked to capture (`/cc <task> --capture-learnings`).

If yes → `learnings/<slug>.md` is written from the template, and one line is appended to `knowledge.jsonl` recording the slug, ship_commit, signals, and `refines` chain. If no → silently skipped, so the index stays signal-rich. Then everything moves to `.cclaw/shipped/<slug>/` with a `manifest.md`.

## Five Failure Modes

Reviews always check for: hallucinated actions, scope creep, cascading errors, context loss, tool misuse. Hard cap is 5 review/fix iterations — then stop and report. The check is wrapped by the `review-loop` auto-trigger skill so the agent cannot skip it.

## Hooks (default profile: minimal)

Three hooks ship by default and only `commit-helper.mjs` is mandatory:

- `session-start.mjs` — rehydrates flow state and prints active slug
- `stop-handoff.mjs` — short reminder when stopping mid-flow
- `commit-helper.mjs` — atomic commit per AC + traceability check

## CLI commands

```bash
cclaw init                 # install assets in the current project
cclaw sync                 # reapply assets to match the current code
cclaw upgrade              # sync after upgrading the npm package
cclaw uninstall            # remove cclaw assets from the project
cclaw version              # print version
cclaw help                 # short help
```

Flow-control commands (`plan`, `status`, `ship`, `migrate`, `build`, `review`) are intentionally **not** part of the CLI. They live as `/cc` instructions inside the harness.

## More docs

- [docs/v8-vision.md](docs/v8-vision.md) — locked decisions, full kill-list, references review
- [docs/scheme-of-work.md](docs/scheme-of-work.md) — flow walk-through with all checkpoints
- [docs/skills.md](docs/skills.md) — six auto-trigger skills and what they enforce
- [docs/config.md](docs/config.md) — `.cclaw/config.yaml` reference
- [docs/harnesses.md](docs/harnesses.md) — what each harness installs
- [docs/quality-gates.md](docs/quality-gates.md) — AC traceability + Five Failure Modes
- [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md) — from cclaw 7.x

## License

MIT. See [LICENSE](LICENSE).
