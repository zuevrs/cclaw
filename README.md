# cclaw

**A TDD harness for coding agents. Type `/cc <task>` and walk away.**

cclaw drops a `/cc` slash command into Claude Code, Cursor, OpenCode, or Codex. It triages the task, picks the right amount of ceremony, and runs the work through a multi-specialist pipeline: design → plan → build → review → critic → ship. Every commit comes from a failing test. Every review has a falsificationist second pass. Every shipped task leaves a learning behind.

## Why cclaw

- **TDD by default.** Build is RED → GREEN → REFACTOR, one commit per acceptance criterion (strict mode) or one cycle per feature (soft mode).
- **Two-model review.** Reviewer writes; critic falsifies. Both run as separate sub-agents so you get fresh eyes on every change.
- **Right-sized ceremony.** Trivial edits run inline (one commit, no plan). Risky migrations get a five-axis review with adversarial pre-mortem. The triage step picks for you.
- **Multi-harness.** Same `.cclaw/` directory works for Claude Code, Cursor, OpenCode, and Codex. Pick one or install for all of them.
- **Compound learnings.** Non-trivial tasks emit a `learnings.md`. Future runs read prior lessons before authoring a plan.

## Quickstart

```bash
# 1. Install into your repo (interactive picker; auto-detects harness)
cd /path/to/your/repo
npx cclaw-cli init

# 2. Open your harness (Claude Code, Cursor, OpenCode, or Codex)
#    and type:
/cc add caching to the search endpoint

# 3. Watch the orchestrator work. When it pauses, type /cc to resume.
#    Outputs land in .cclaw/flows/<task-name>/
ls .cclaw/flows/20260513-search-caching/
# plan.md  build.md  review.md  critic.md  ship.md
```

That's it. No `cclaw plan`, no `cclaw ship`, no `cclaw status`. Flow control lives in `/cc` inside the harness.

## Worked example

You type:

```text
/cc add caching to the search endpoint
```

The orchestrator runs through these stages, pausing at each gate so you can review:

```text
┌─ Triage ─────────────────────────────────────────────────┐
│ complexity: small-medium · review level: soft            │
│ path: plan → build → review → ship                       │
│ task name: 20260513-search-caching                       │
└──────────────────────────────────────────────────────────┘

┌─ Plan ───────────────────────────────────────────────────┐
│ ac-author wrote .cclaw/flows/20260513-search-caching/    │
│   plan.md (3 AC, 2 prior lessons, repo signals: hit)     │
│ Confidence: high                                         │
└──────────────────────────────────────────────────────────┘

┌─ Build ──────────────────────────────────────────────────┐
│ slice-builder ran the TDD cycle for each AC:             │
│   AC-1: red → green → refactor (3 commits)               │
│   AC-2: red → green (2 commits, no refactor needed)      │
│   AC-3: red → green → refactor (3 commits)               │
│ Tests: 14 passing (was 11). Coverage delta: +2.3%.       │
└──────────────────────────────────────────────────────────┘

┌─ Review ─────────────────────────────────────────────────┐
│ reviewer (7-axis) opened 2 findings:                     │
│   F-1: cache key collision on case-sensitive queries     │
│         (correctness, severity: required)                │
│   F-2: missing TTL refresh on stale entries              │
│         (architecture, severity: consider)               │
│ After fix-only re-review: both findings closed.          │
└──────────────────────────────────────────────────────────┘

┌─ Critic ─────────────────────────────────────────────────┐
│ Falsificationist pass: what could go wrong in production?│
│ Verdict: pass (1 pre-commitment prediction logged)       │
└──────────────────────────────────────────────────────────┘

┌─ Ship ───────────────────────────────────────────────────┐
│ All 3 AC committed. Release notes drafted in ship.md.    │
│ Ready to push? [y]es / [n]o                              │
└──────────────────────────────────────────────────────────┘
```

After `y`, cclaw moves the artifacts into `.cclaw/flows/shipped/20260513-search-caching/` and (if the task earned it) appends one row to `.cclaw/knowledge.jsonl` so the next run can read this lesson.

## What you get

| Feature | Detail |
| --- | --- |
| **Specialists** | 6 sub-agents: design, ac-author, slice-builder, reviewer, critic, security-reviewer. Each runs in isolation with a mandatory contract read. |
| **Research helpers** | `repo-research` (brownfield scan) and `learnings-research` (prior shipped lessons) dispatched before every plan. |
| **TDD modes** | `strict` (per-AC RED → GREEN → REFACTOR), `soft` (one cycle per feature), `inline` (single commit, no plan). |
| **Review** | 7-axis pass (correctness · test-quality · readability · architecture · complexity-budget · security · performance) with append-only findings table and convergence detector. |
| **Critic step** | Adversarial falsificationist pass: gap analysis, pre-commitment predictions, goal-backward verification. Runs after reviewer clears. |
| **Compound learnings** | Gated by signal (architect decision, ≥3 review iterations, security flag, explicit `--capture-learnings`). `knowledge.jsonl` is the durable index. |
| **Auto-trigger skills** | 17 skills (e.g., `triage-gate`, `tdd-and-verification`, `review-discipline`, `source-driven`). Auto-applied per stage, not user-invoked. |
| **Parallel build** | Up to 5 slices on git worktrees when AC are independent and ≥2 touch-surface clusters. |
| **Multi-harness install** | Claude Code, Cursor, OpenCode, Codex — same `.cclaw/` runtime, different harness adapters. |

## Harnesses supported

| Harness | Detection | Status |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` or `.claude/` | Supported |
| Cursor | `.cursor/` | Supported |
| OpenCode | `opencode.json[c]` or `.opencode/` | Supported |
| Codex | `.codex/` or `.agents/skills/` | Supported |

Run `npx cclaw-cli init` and the picker pre-selects whatever it detects. Pass `--harness=claude,cursor` to skip the picker.

## Configuration

`.cclaw/config.yaml` is optional. Defaults are good. See [docs/config.md](docs/config.md) for the full schema. Common knobs:

```yaml
harnesses: [claude, cursor]
reviewerTwoPass: false              # opt-in: spec-review + code-quality-review split
compoundRefreshEvery: 5             # how often to dedup knowledge.jsonl
compoundRefreshFloor: 10            # minimum entries before refresh kicks in
captureLearningsBypass: false       # true = silent skip on non-trivial slugs
legacy-artifacts: false             # true brings back v8.11-era extra artifacts
```

## Architecture deep dive

The runtime is under 1 KLOC. The prompt content is where the work lives. If you want to understand how `/cc` actually works:

- [`src/content/start-command.ts`](src/content/start-command.ts) — the orchestrator body (detect, triage, dispatch, pause/resume, compound, finalize)
- [`src/content/specialist-prompts/`](src/content/specialist-prompts/) — 6 specialist contracts (design, ac-author, slice-builder, reviewer, critic, security-reviewer)
- [`src/content/skills/`](src/content/skills/) — 17 auto-trigger skill bodies
- [`src/content/runbooks-on-demand.ts`](src/content/runbooks-on-demand.ts) — 13 on-demand runbooks the orchestrator opens by trigger
- [`src/content/artifact-templates.ts`](src/content/artifact-templates.ts) — plan / build / review / critic / ship / learnings templates

Or read the docs:

- [docs/scheme-of-work.md](docs/scheme-of-work.md) — flow walkthrough with all checkpoints
- [docs/skills.md](docs/skills.md) — what each auto-trigger skill enforces
- [docs/harnesses.md](docs/harnesses.md) — what each harness install layer ships
- [docs/quality-gates.md](docs/quality-gates.md) — AC traceability + Five Failure Modes
- [CHANGELOG.md](CHANGELOG.md) — release history (v8.45 back to v8.0)

## Artifact tree (after install)

```
.cclaw/
  config.yaml               flow defaults
  ideas.md                  /cc-idea drops land here
  knowledge.jsonl           compound learnings index
  state/
    flow-state.json         active flow state (~500 bytes)
  flows/
    <task-name>/            one folder per active task
      plan.md
      build.md
      review.md
      critic.md             (v8.42+)
      ship.md
    shipped/<task-name>/    finalized tasks
    cancelled/<task-name>/  /cc-cancel destination
  lib/
    agents/                 6 specialist contracts
    skills/                 17 auto-trigger skill bodies
    templates/              artifact templates
    runbooks/               13 on-demand runbooks
    patterns/               2 reference patterns
```

## CLI commands

```bash
cclaw init        # install into the current project (interactive picker by default)
cclaw sync        # reapply assets after a package upgrade
cclaw upgrade     # same as sync, with version check
cclaw uninstall   # remove .cclaw/ assets
cclaw version     # print version
cclaw help        # short help
```

Flow control (`plan`, `status`, `ship`, `build`, `review`) is intentionally **not** in the CLI. It lives in `/cc` inside the harness.

## Contributing

cclaw is dogfooded — every release is shipped via `/cc` against itself. To contribute:

1. Fork and clone.
2. `npm install && npm test` (the test suite is the spec; PRs without test updates are rare).
3. Run `/cc <your change>` inside a cclaw-installed harness, or write tests + code directly.
4. Open a PR. CI runs lint, typecheck, unit tests, integration tests, and a smoke runtime test.

The runtime stays under 1 KLOC; new behavior usually means new prompt content under `src/content/`, not new code under `src/`.

## License

MIT. See [LICENSE](LICENSE).
