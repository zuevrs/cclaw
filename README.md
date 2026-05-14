# cclaw

**A TDD harness for coding agents. Type `/cc <task>` and walk away.**

cclaw drops a `/cc` slash command into Claude Code, Cursor, OpenCode, or Codex. It triages the task, picks the right amount of ceremony, and runs the work through a multi-specialist pipeline: design → plan → build → review → critic → ship. Every commit comes from a failing test. Every review has a falsificationist second pass. Every shipped task leaves a learning behind.

## Why cclaw

- **TDD by default.** Build is RED → GREEN → REFACTOR, one commit per acceptance criterion (strict mode) or one cycle per feature (soft mode).
- **Two-model review.** Reviewer writes; critic falsifies. Both run as separate sub-agents so you get fresh eyes on every change.
- **Right-sized ceremony.** Trivial edits run inline (one commit, no plan). Risky migrations get a seven-axis review with adversarial pre-mortem. The triage step picks for you.
- **Multi-harness.** Same `.cclaw/` directory works for Claude Code, Cursor, OpenCode, and Codex. Pick one or install for all of them.
- **Compound learnings.** Non-trivial tasks emit a `learnings.md`. Future runs read prior lessons before authoring a plan.

## Quickstart

```bash
# 1. Open the TUI menu in your repo (auto-detects harness, defaults to Install)
cd /path/to/your/repo
npx cclaw-cli@latest

# 2. Open your harness (Claude Code, Cursor, OpenCode, or Codex)
#    and type:
/cc add caching to the search endpoint

# 3. Watch the orchestrator work. When it pauses, type /cc to resume.
#    Outputs land in .cclaw/flows/<slug>/
ls .cclaw/flows/20260514-search-caching/
# plan.md  build.md  review.md  critic.md  ship.md
```

For CI / scripted installs, use the non-interactive escape hatch:

```bash
npx cclaw-cli@latest --non-interactive install --harness=cursor
```

That's it. No `cclaw plan`, no `cclaw ship`, no `cclaw status`. Flow control lives in `/cc` inside the harness.

## Worked example

You type:

```text
/cc add caching to the search endpoint
```

The orchestrator runs through these stages in order, pausing at each gate so you can review. The summaries below are illustrative — the actual orchestrator output is a sequence of slim-summary blocks under section headers (`## Triage`, `## Plan`, `## Build`, `## Review`, `## Critic`, `## Ship`), not boxed UI.

- **Triage.** complexity: small-medium · review level: soft · path: plan → build → review → critic → ship · slug: `20260514-search-caching`
- **Plan.** `ac-author` writes `.cclaw/flows/20260514-search-caching/plan.md` — Spec section (Objective / Success / Out of scope / Boundaries), 3 AC, 2 prior lessons surfaced from `knowledge.jsonl`. Confidence: high.
- **Build.** `slice-builder` runs the TDD cycle for each AC:
  - AC-1: red → green → refactor (3 commits)
  - AC-2: red → green (2 commits, refactor skipped: "no shape change")
  - AC-3: red → green → refactor (3 commits)
  - Tests: 14 passing (was 11). Coverage delta: +2.3%.
- **Review.** Reviewer (seven-axis) opens 2 findings:
  - F-1: cache key collision on case-sensitive queries (axis: correctness, severity: required)
  - F-2: missing TTL refresh on stale entries (axis: architecture, severity: consider)
  - Fix-only re-review closes both findings.
- **Critic.** Falsificationist pass — gap analysis, pre-commitment predictions, goal-backward verification. Verdict: pass (1 pre-commitment prediction logged).
- **Ship.** All 3 AC committed. Release notes drafted in `ship.md`. Ready to push? [y]es / [n]o

After `y`, cclaw moves the artifacts into `.cclaw/flows/shipped/20260514-search-caching/` and (if the task earned it) appends one row to `.cclaw/state/knowledge.jsonl` so the next run can read this lesson.

## What you get

| Feature | Detail |
| --- | --- |
| **Specialists** | 5 sub-agents (ac-author, slice-builder, reviewer, critic, security-reviewer) + 1 main-context coordinator (design). Each runs in isolation with a mandatory contract read. |
| **Research helpers** | `repo-research` (brownfield scan) and `learnings-research` (prior shipped lessons) dispatched in parallel before every plan. |
| **TDD modes** | `strict` (per-AC RED → GREEN → REFACTOR), `soft` (one cycle per feature), `inline` (single commit, no plan). |
| **Plan template** | `## Spec` (v8.46: Objective / Success / Out of scope / Boundaries), `## Frame`, optional `## Non-functional`, `## Acceptance Criteria` table, `## Edge cases`, `## Topology`, `## Feasibility stamp`. |
| **Review** | Seven-axis pass (correctness · test-quality · readability · architecture · complexity-budget · security · perf) plus a gated eighth axis (`nfr-compliance`) when the plan carries non-functional rows. Append-only findings table and convergence detector. |
| **Critic step** | Adversarial falsificationist pass: gap analysis, pre-commitment predictions, goal-backward verification. Runs after reviewer clears. |
| **Compound learnings** | Gated by signal (design decision, ≥3 review iterations, security flag, explicit `--capture-learnings`). `.cclaw/state/knowledge.jsonl` is the durable index. |
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

Run `npx cclaw-cli@latest` and the TUI auto-detects whatever you have. For CI / scripted installs, pass `--non-interactive install --harness=<id>[,<id>]` (comma-separated, supported ids: `claude`, `cursor`, `opencode`, `codex`).

## Configuration

`.cclaw/config.yaml` is optional. Defaults are good. Common knobs:

```yaml
harnesses: [claude, cursor]
reviewerTwoPass: false              # opt-in: spec-review + code-quality-review split
compoundRefreshEvery: 5             # how often to dedup knowledge.jsonl
compoundRefreshFloor: 10            # minimum entries before refresh kicks in
captureLearningsBypass: false       # true = silent skip on non-trivial slugs
legacy-artifacts: false             # true brings back v8.11-era extra artifacts
```

## Architecture deep dive

The runtime is under 1 KLOC. The prompt content is where the work lives. If you want to understand how `/cc` actually works, read the source — the on-disk reference lives under `src/content/`:

- [`src/content/start-command.ts`](src/content/start-command.ts) — the orchestrator body (detect, triage, dispatch, pause/resume, critic step, ship, compound, finalize).
- [`src/content/specialist-prompts/`](src/content/specialist-prompts/) — 6 specialist contracts (design, ac-author, slice-builder, reviewer, critic, security-reviewer).
- [`src/content/skills/`](src/content/skills/) — 17 auto-trigger skill bodies.
- [`src/content/runbooks-on-demand.ts`](src/content/runbooks-on-demand.ts) — 13 on-demand runbooks the orchestrator opens by trigger.
- [`src/content/artifact-templates.ts`](src/content/artifact-templates.ts) — plan / build / review / critic / ship / learnings templates.
- [`CHANGELOG.md`](CHANGELOG.md) — release history (v8.46 back to v8.0).

## Artifact tree (after install)

```
.cclaw/
  config.yaml               flow defaults
  ideas.md                  /cc-idea drops land here
  state/
    flow-state.json         active flow state (~500 bytes)
    knowledge.jsonl         compound learnings index
  flows/
    <slug>/                 one folder per active task
      plan.md
      build.md
      review.md
      critic.md             (v8.42+)
      ship.md
    shipped/<slug>/         finalized tasks
    cancelled/<slug>/       /cc-cancel destination
  lib/
    agents/                 6 specialist contracts
    skills/                 17 auto-trigger skill bodies
    templates/              artifact templates
    runbooks/               13 on-demand runbooks
    patterns/               2 reference patterns
```

## CLI surface

Two invocations cover every use case — there is no `cclaw plan`, `cclaw status`, `cclaw build`, `cclaw ship` (flow control lives inside `/cc`) and no bare subcommand surface (`init`, `sync`, and `upgrade` were retired in v8.29 + v8.37).

```bash
# Interactive (humans): opens a TUI menu — Install / Uninstall / Quit
npx cclaw-cli@latest

# Non-interactive (CI / scripts): explicit command, no TUI
npx cclaw-cli@latest --non-interactive install [--harness=<id>[,<id>]]
npx cclaw-cli@latest --non-interactive uninstall
npx cclaw-cli@latest --non-interactive knowledge [--tag=<tag>] [--surface=<sub>] [--type=<kind>] [--all] [--json]
npx cclaw-cli@latest --version
npx cclaw-cli@latest --help
```

`install` is idempotent and runs orphan cleanup, so it handles first-time setup, re-sync after a package upgrade, and stale-file cleanup in one command. The TUI menu and the `--non-interactive install` path share the same installer code — they're byte-for-byte identical in write behaviour.

## Contributing

cclaw is dogfooded — every release is shipped via `/cc` against itself. To contribute:

1. Fork and clone.
2. `npm install && npm test` (the test suite is the spec; PRs without test updates are rare).
3. Run `/cc <your change>` inside a cclaw-installed harness, or write tests + code directly.
4. Open a PR. CI runs lint, typecheck, unit tests, integration tests, and a smoke runtime test.

The runtime stays under 1 KLOC; new behavior usually means new prompt content under `src/content/`, not new code under `src/`.

## License

MIT. See [LICENSE](LICENSE).
