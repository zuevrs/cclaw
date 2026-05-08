# cclaw

**cclaw is a lightweight harness-first flow toolkit for coding agents.** It installs three slash commands, six on-demand specialists, twelve auto-trigger skills (including TDD cycle and conversation-language), ten artifact templates, four stage runbooks, eight reference patterns, five research playbooks, five recovery playbooks, thirteen worked examples, an antipatterns library, a decision protocol, a meta-skill, and a tiny runtime — together a deep content layer wrapped around a runtime under 1 KLOC — so Claude Code, Cursor, OpenCode, or Codex can move from idea to shipped change with a clear plan, AC traceability, TDD per AC, and almost no ceremony.

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

Three slash commands. Four stages (`plan → build → review → ship`, where **build IS a TDD cycle**: RED → GREEN → REFACTOR per AC). Six specialists. Eleven skills (including a TDD-cycle skill that's always-on while building). Ten templates. Four runbooks. Eight reference patterns. Five research playbooks. Five recovery playbooks. Thirteen worked examples. Two mandatory gates (AC traceability + TDD phase chain).

## What changed in v8

cclaw v8.0 is a breaking redesign. We dropped the 7.x stage machine: no more `brainstorm` / `scope` / `design` / `spec` / `tdd` mandatory stages, no more 18 specialists, no more 9 state files, no more 30 stage gates. v7.x runs are not migrated; see [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md).

What we kept and made deeper:

- plans with **acceptance criteria + YAML frontmatter** (`slug`, `stage`, `status`, `ac[]`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`);
- **build is a TDD stage** — every AC goes through RED → GREEN → REFACTOR; `commit-helper.mjs --phase=red|green|refactor` enforces the cycle (production files in RED are rejected, GREEN without prior RED is rejected, REFACTOR is mandatory);
- **AC ↔ commit traceability** enforced by `commit-helper.mjs`;
- **artifact templates** for every stage (`plan`, `build`, `review`, `ship`, `decisions`, `learnings`, `manifest`, `ideas`, `iron-laws`);
- **twelve auto-trigger skills** — plan-authoring, AC traceability, refinement, parallel-build, security-review, review-loop, commit-message-quality, AC-quality, refactor-safety, breaking-changes, conversation-language (always-on), anti-slop (always-on), plus a meta-skill that ties them together;
- **stage runbooks** (`.cclaw/lib/runbooks/{plan,build,review,ship}.md`) — strict checklists per stage with common pitfalls;
- **reference patterns** (`.cclaw/lib/patterns/`) — eight task-type playbooks (api-endpoint, auth-flow, schema-migration, ui-component, perf-fix, refactor, security-hardening, doc-rewrite) the orchestrator opens before authoring AC;
- **research playbooks** (`.cclaw/lib/research/`) — reading the codebase (files + tests + integration boundaries), time-boxing, using prior shipped slugs;
- **recovery playbooks** (`.cclaw/lib/recovery/`) — AC traceability break, review hard cap reached, parallel-build slice conflict, frontmatter corruption, schemaVersion mismatch;
- **examples library** (`.cclaw/lib/examples/`) — eight real-looking plan / build / review / ship / decision / learning / commit-helper artifacts;
- **antipatterns** (`.cclaw/lib/antipatterns.md`) — twelve known failure modes the reviewer cites as findings;
- **decision protocol** (`.cclaw/lib/decision-protocol.md`) — short-form digest of "is this even a decision?"; full D-N schema lives in `lib/agents/architect.md`, worked decisions in `lib/examples/`;
- **resumable refinement** via frontmatter on shipped slugs (`refines: <old-slug>`);
- durable artifacts your team and graph tools (Graphify, GitNexus, etc.) can index.

## First 5 minutes

Requirements: Node.js 20+ and a git project.

```bash
cd /path/to/your/repo
npx cclaw-cli init                            # auto-detect harness from project root
npx cclaw-cli init --harness=claude,cursor,opencode,codex   # explicit selection
```

`init` resolves harnesses in this order:

1. `--harness=<id>[,<id>]` flag if passed.
2. Existing `.cclaw/config.yaml` (so subsequent `init` / `sync` / `upgrade` are deterministic).
3. Auto-detect from project root markers: `.claude/`, `.cursor/`, `.opencode/`, `.codex/`, `.agents/skills/`, `CLAUDE.md`, `opencode.json`, `opencode.jsonc`.
4. If nothing detected and no flag passed → exit with an actionable error. cclaw never silently picks a harness for you.

Then work entirely inside your harness:

```text
/cc <task>          plan / build / review / ship — orchestrator routes everything
/cc-cancel          stop the active run cleanly (artifacts move to .cclaw/flows/cancelled/<slug>/)
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

Specialists are proposed only when the task is large, abstract, risky, security-sensitive, or spans multiple components. Trivial and small/medium tasks run inline. Each prompt is 150-280 lines and includes an explicit output schema, two or more worked examples, edge cases, common pitfalls, and hard rules (see `.cclaw/lib/agents/*.md` after install). The orchestrator pulls additional context from runbooks, patterns, examples, and recovery playbooks as needed; see [docs/skills.md](docs/skills.md) for the auto-trigger layer that wraps every invocation.

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

The same shape applies to `build.md` (commit log), `review.md` (findings + Five Failure Modes pass), `ship.md` (release notes + push/PR refs), `decisions.md` (architect output), `learnings.md` (compound output). Templates live in `.cclaw/lib/templates/`.

## Artifact tree

```
.cclaw/
  config.yaml               cclaw config (harness, flow defaults)
  ideas.md                  append-only idea backlog (/cc-idea)
  knowledge.jsonl           cross-feature learnings index, append-only
  state/
    flow-state.json         ~500 bytes, schemaVersion: 2
  hooks/
    session-start.mjs       rehydrates flow state on harness boot
    stop-handoff.mjs        short reminder when stopping mid-flow
    commit-helper.mjs       atomic commit per AC + traceability + TDD phase gate
  flows/                    everything that comes out of a /cc run
    <slug>/                 one folder per active flow
      plan.md               current work + AC
      build.md              implementation log + TDD evidence
      review.md             Concern Ledger + iteration logs
      ship.md               preflight + AC↔commit map + rollback + finalization
      decisions.md          architect output (optional; only when architect ran)
      learnings.md          compound output (optional; only when gated)
    shipped/<slug>/         plan.md, build.md, review.md, ship.md,
                            decisions.md, learnings.md, manifest.md
    cancelled/<slug>/       when /cc-cancel is invoked
  lib/                      reference content shipped by the installer
    agents/                 6 specialist prompts (each ends with a Composition footer
                            locking it to its lane — no nested orchestration)
    skills/                 12 auto-trigger skills (2 always-on: conversation-language,
                            anti-slop; 10 stage- or event-gated)
    templates/              9 templates (plan, build, review, ship, decisions,
                            learnings, manifest, ideas, iron-laws)
    runbooks/               4 stage runbooks (plan, build, review, ship)
    patterns/               8 task-type playbooks
    research/               3 research playbooks
    recovery/               5 recovery playbooks
    examples/               8 worked examples
    antipatterns.md         12 named failure modes
    decision-protocol.md    short-form digest; full schema in lib/agents/architect.md
```

`.cclaw/state/` and `.cclaw/worktrees/` are appended to `.gitignore` on init (transient per-session data). The rest of `.cclaw/` is committable; graphify, team review, and the next agent all need it.

The split is deliberate. Active and archived flow artifacts go under `flows/` so the orchestrator never confuses them with the read-only library under `lib/`. Runtime (`state/`, `hooks/`) stays at the top so harness hooks can find it without traversal. Active flows are grouped by slug — open `flows/<slug>/` and every artifact for that flow is right there, instead of scattered across six per-stage subdirectories.

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

If yes → `flows/<slug>/learnings.md` is written from the template, and one line is appended to `knowledge.jsonl` recording the slug, ship_commit, signals, and `refines` chain. If no → silently skipped, so the index stays signal-rich. Then everything moves to `flows/shipped/<slug>/` with a `manifest.md`.

## Parallel-build (cap: 5 slices, git worktree)

Inline is the default. Parallel-build is opt-in and only when planner declares it. Pre-conditions: ≥4 AC, ≥2 distinct touchSurface clusters, every AC `parallelSafe: true`, no AC depends on outputs of another AC in the same wave.

A **slice = 1+ AC with a shared touchSurface**. If planner produces more than 5 slices, planner must merge thinner slices into fatter ones — never generate "wave 2", "wave 3". The 5-slice cap is the v7-era constraint kept on purpose: orchestration cost grows non-linearly past 5 sub-agents, and 5 fits comfortably under every harness's sub-agent quota.

When the harness supports sub-agent dispatch, each parallel slice runs in its own worktree:

```bash
git worktree add .cclaw/worktrees/<slug>-slice-1 -b cclaw/<slug>/slice-1
git worktree add .cclaw/worktrees/<slug>-slice-2 -b cclaw/<slug>/slice-2
git worktree add .cclaw/worktrees/<slug>-slice-3 -b cclaw/<slug>/slice-3
```

Each slice-builder runs RED → GREEN → REFACTOR for every AC it owns sequentially inside its worktree. After the wave, `reviewer` in `integration` mode reads from each worktree's branch and the orchestrator merges them in. If the harness does not support sub-agent dispatch (or worktree creation fails), parallel-build degrades silently to inline-sequential — recorded but not an error.

For ≤4 AC the orchestrator picks `inline` even when AC look "parallelSafe". Dispatch overhead is not worth saving 1-2 AC of wall-clock.

## When sub-agents help (and when they don't)

Use a sub-agent for:

- **Parallel slice dispatch** during `parallel-build` (cap: 5).
- **Specialist context isolation** for `architect`, `security-reviewer`, integration `reviewer` when the harness supports it. A fresh sub-agent reads a small focused filebag instead of the orchestrator's full history.

Don't use a sub-agent for:

- Trivial / small / medium slugs (≤4 AC). Run inline.
- Sequential work that doesn't actually parallelize.
- Routine work the orchestrator can finish in 1-2 turns.

## Five Failure Modes + review Ralph loop

Reviews check the Five Failure Modes — hallucinated actions, scope creep, cascading errors, context loss, tool misuse — every iteration. The Five Failure Modes pass is wrapped by the `review-loop` auto-trigger skill so the agent cannot skip it.

Reviews are not single-shot. They are a Ralph loop with an explicit ledger:

1. Iteration 1 lists every finding as F-1, F-2, … in an append-only **Concern Ledger** at the top of `flows/<slug>/review.md`. Each row carries severity (`block` / `warn`), status (`open` / `closed` / `superseded`), and a `file:line` citation.
2. Iteration N+1 must reread every open row, mark it `closed | open | superseded by F-K`, and append new findings as F-(max+1). It cannot delete or rewrite earlier rows.
3. The loop ends when (a) every row is `closed`, (b) two consecutive iterations record zero new `block` findings AND every open row is `warn`, or (c) the 5-iteration hard cap fires with at least one open block row — at which point `/cc` stops and reports instead of looping forever.

A typical run converges in 1-3 iterations. The hard cap is a circuit breaker, not a target.

## Conversation language

cclaw replies in the user's language for prose. It NEVER translates wire-protocol identifiers — slugs, `AC-N`, `D-N`, `F-N`, frontmatter keys, file paths, hook output, specialist names, or commit tags. This is enforced by the always-on `conversation-language` skill so a Russian-speaking user, for example, gets Russian explanations but still sees `flow-state.json` and `AC-1` verbatim.

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
