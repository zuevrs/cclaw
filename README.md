# cclaw

**A multi-stage planning + review harness for coding agents.**

cclaw drops a `/cc` slash command into Claude Code, Cursor, OpenCode, or Codex. It triages the task, picks the right amount of ceremony, and runs the work through a fixed pipeline: triage → plan → build → qa → review → critic → ship. Each stage emits a slim summary back to the harness and writes a tracked artifact under `.cclaw/flows/<slug>/`. Sub-agents are isolated; the orchestrator keeps the slug's history.

## Why cclaw

- **Pipeline, not autopilot.** Every stage pauses at a structured gate so the human can read the artifact, edit it, or `/cc-cancel`. There is no "let it run for an hour and hope".
- **Two-model review.** A read-only reviewer walks ten axes; an adversarial critic falsifies what the reviewer cleared. They share no context and write to separate artifacts (`review.md`, `critic.md`).
- **Right-sized ceremony.** Trivial edits run inline (one commit, no plan). Small/medium tasks get a soft-mode plan and a single TDD cycle. Large-risky tasks get a full per-criterion build with a pre-implementation plan-critic gate.
- **Same runtime, four harnesses.** Claude Code, Cursor, OpenCode, and Codex all read the same `.cclaw/` install. Each harness gets the same `/cc` body plus harness-namespaced ambient rules.
- **Compound learnings.** Non-trivial slugs emit a `learnings.md`. Future runs read prior shipped lessons through `knowledge.jsonl` before authoring a plan; v8.50 outcome signals (`good` / `unknown` / `manual-fix` / `follow-up-bug` / `reverted`) down-weight priors that didn't hold up.

## Quickstart

```bash
cd /path/to/your/repo
npx cclaw-cli@latest

# Inside your harness:
/cc add caching to the search endpoint

# After cclaw pauses at a gate, type /cc again to resume.
# Artifacts land in .cclaw/flows/<slug>/.
ls .cclaw/flows/20260515-search-caching/
# plan.md  build.md  review.md  critic.md  ship.md
```

For CI / scripted installs, use the non-interactive escape hatch:

```bash
npx cclaw-cli@latest --non-interactive install --harness=cursor
```

There is no `cclaw plan`, `cclaw build`, or `cclaw status`. Flow control lives inside `/cc`.

## Worked example

You type:

```text
/cc add caching to the search endpoint
```

The orchestrator runs through these stages in order, pausing at each gate. The slim-summary blocks the orchestrator emits sit under `## Triage`, `## Plan`, `## Build`, `## QA`, `## Review`, `## Critic`, `## Ship` section headers in chat. Artifacts land on disk.

- **Triage.** complexity: small-medium · ceremony mode: soft · path: plan → build → review → critic → ship · slug: `20260515-search-caching`. The decision is persisted to `flow-state.json > triage` and is immutable for the slug.
- **Plan.** `ac-author` writes `plan.md` — Spec section (Objective / Success / Out of scope / Boundaries), Frame, Acceptance Criteria, Edge cases, Topology, Feasibility stamp, Traceability block. 3 AC, 2 prior lessons surfaced from `knowledge.jsonl`. Confidence: high.
- **Build.** `slice-builder` runs one TDD cycle per criterion: RED → GREEN → REFACTOR. Each commit carries an `AC-N` prefix the reviewer reads via `git log --grep`. Tests: 14 passing (was 11). Coverage delta: +2.3%.
- **Review.** Ten-axis reviewer opens 2 findings on the first iteration: cache-key collision on case-sensitive queries (`correctness`, `required`) and missing TTL refresh on stale entries (`architecture`, `consider`). Fix-only re-review closes both findings.
- **Critic.** Adversarial falsificationist pass — predictions, gap analysis, Criterion check across AC + Edge cases + NFR rows, goal-backward verification, realist check. Verdict: pass.
- **Ship.** All 3 AC committed. `ship.md` carries the release-notes draft and the AC↔commit map. The picker asks before pushing.

After ship, the orchestrator moves the artifacts to `.cclaw/flows/shipped/<slug>/` and (when the slug earned capture) appends one row to `.cclaw/state/knowledge.jsonl`.

## What you get

| Surface | Count + detail |
| --- | --- |
| **Specialists** | 8 sub-agents: `design` (large-risky plans only), `ac-author`, `plan-critic` (pre-implementation gate, strict + complexity≠trivial + AC≥2), `slice-builder`, `qa-runner` (UI/web surfaces, ceremonyMode≠inline), `reviewer`, `security-reviewer`, `critic` (post-implementation adversarial pass). Each runs in isolation with a mandatory contract read. |
| **Research helpers** | `repo-research` (brownfield scan) and `learnings-research` (prior shipped lessons) dispatched in parallel before every plan. |
| **Ceremony modes** | `strict` (per-criterion RED → GREEN → REFACTOR + AC↔commit chain), `soft` (single feature-level TDD cycle, plain commit), `inline` (one commit, no plan). Triage picks the mode; readers accept the legacy `acMode` key for one release. |
| **Plan template** | 14 sections (`Frame`, `Non-functional`, `Approaches`, `Selected Direction`, `Decisions`, `Pre-mortem`, `Not Doing`, `Plan`, `Spec`, `Acceptance Criteria`, `Feasibility stamp`, `Edge cases`, `Topology`, `Traceability block`) in strict mode; 6 sections (`Plan`, `Spec`, `Testable conditions`, `Verification`, `Touch surface`, `Notes`) in soft mode. AC is one section among many. |
| **Postures** | 6 per-criterion postures (`test-first`, `characterization-first`, `tests-as-deliverable`, `refactor-only`, `docs-only`, `bootstrap`). Each maps to a fixed commit-shape recipe the reviewer enforces ex-post. |
| **Review** | 10 reviewer axes — 8 base (`correctness`, `readability`, `architecture`, `security`, `perf`, `test-quality`, `complexity-budget`, `edit-discipline`) plus 2 gated (`qa-evidence` when qa-runner ran, `nfr-compliance` when `## Non-functional` is non-empty). Append-only findings table, convergence detector, severity-aware ship gate. |
| **Critic step** | Falsificationist pass after review clears: §1 predictions, §2 gap analysis, §3 four adversarial techniques + 6 human-perspective lenses (executor / stakeholder / skeptic for plan-stage, security / new-hire / ops for code-stage; adversarial mode only), §4 Criterion check (AC + Edge cases + NFR), §5 goal-backward, §6 realist check, §7 verdict, §8 summary. |
| **Auto-trigger skills** | 21 skills (`triage-gate`, `plan-authoring`, `tdd-and-verification`, `review-discipline`, `commit-hygiene`, `completion-discipline`, `pre-edit-investigation`, `qa-and-browser`, `debug-and-browser`, `ac-discipline`, `source-driven`, `summary-format`, `documentation-and-adrs`, `parallel-build`, `refinement`, `flow-resume`, `receiving-feedback`, `anti-slop`, `conversation-language`, `api-evolution`, `pre-flight-assumptions`). Auto-applied per stage, not user-invoked. |
| **On-demand runbooks** | 11 runbooks loaded by trigger (`dispatch-envelope`, `parallel-build`, `finalize`, `cap-reached-recovery`, `adversarial-rerun`, `handoff-gates`, `handoff-artifacts`, `compound-refresh`, `pause-resume`, `critic-steps`, `qa-stage`). Kept out of the orchestrator body to hold the prompt budget. |
| **Anti-rationalization catalog** | v8.49 — `.cclaw/lib/anti-rationalizations.md` carries the cross-cutting rebuttal table (posture-bypass, completion-discipline, edit-discipline, verification rows). Each specialist's prompt cites the catalog and adds its own specialist-specific rows. |
| **Outcome signals** | v8.50 — 5-value enum (`good`, `unknown`, `manual-fix`, `follow-up-bug`, `reverted`) recorded on `knowledge.jsonl` rows. Three capture paths (orchestrator scans on every `/cc` for follow-up-bug references; compound time scans for revert commits and same-touch-surface manual-fix commits). Prior-learnings lookup multiplies similarity by signal weight before threshold filtering. |
| **Ambiguity score** | v8.53 — design Phase 6 emits a composite ambiguity score (3 dims on greenfield, 4 dims on brownfield) into `plan.md` frontmatter. Phase 7 prefixes a soft warning when the composite exceeds threshold (default `0.2`, configurable). Informational signal, never a hard gate. |
| **Discipline skills** | v8.48 — `completion-discipline` (no `✅ complete` without paired fresh evidence), `pre-edit-investigation` (three-probe gate before any edit), `receiving-feedback` (slice-builder fix-only response protocol), plus the v8.48 `edit-discipline` reviewer axis. |
| **Harness-embedded rules** | v8.55 — every supported harness installs cclaw's Iron Laws + anti-rationalizations + antipatterns into its own ambient surface (`.cursor/rules/`, `.claude/`, `.codex/`, `.opencode/`). cclaw never touches root `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. |
| **Parallel build** | Up to 5 slices on git worktrees when AC are independent and ≥2 touch-surface clusters. `ceremonyMode: strict` required. |
| **Multi-harness install** | Claude Code, Cursor, OpenCode, Codex — same `.cclaw/` runtime, different harness adapters. |

## Harnesses supported

| Harness | Detection | Status |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` or `.claude/` | Supported |
| Cursor | `.cursor/` | Supported |
| OpenCode | `opencode.json[c]` or `.opencode/` | Supported |
| Codex | `.codex/` or `.agents/skills/` | Supported |

Run `npx cclaw-cli@latest` and the TUI auto-detects whatever you have. For CI / scripted installs, pass `--non-interactive install --harness=<id>[,<id>]` (comma-separated; supported ids: `claude`, `cursor`, `opencode`, `codex`).

## Configuration

`.cclaw/config.yaml` is optional. Defaults are good. Common knobs:

```yaml
harnesses: [claude, cursor]
reviewerTwoPass: false              # opt-in: spec-review + code-quality-review split
compoundRefreshEvery: 5             # how often to dedup knowledge.jsonl
compoundRefreshFloor: 10            # minimum entries before refresh kicks in
captureLearningsBypass: false       # true = silent skip on non-trivial slugs
legacy-artifacts: false             # true brings back v8.11-era extra artifacts
design:
  ambiguity_threshold: 0.2          # v8.53 — design Phase 7 soft warning threshold
```

## Architecture deep dive

The runtime is under 1 KLOC. The prompt content is where the work lives. If you want to understand how `/cc` actually works, read the source — the on-disk reference lives under `src/content/`:

- [`src/content/start-command.ts`](src/content/start-command.ts) — orchestrator body (detect, triage, dispatch, pause/resume, critic step, ship, compound, finalize).
- [`src/content/specialist-prompts/`](src/content/specialist-prompts/) — 8 specialist contracts.
- [`src/content/skills/`](src/content/skills/) — 21 auto-trigger skill bodies.
- [`src/content/runbooks-on-demand.ts`](src/content/runbooks-on-demand.ts) — 11 on-demand runbooks the orchestrator opens by trigger.
- [`src/content/artifact-templates.ts`](src/content/artifact-templates.ts) — plan / build / qa / review / critic / plan-critic / ship / learnings templates.
- [`src/content/anti-rationalizations.ts`](src/content/anti-rationalizations.ts) — cross-cutting rebuttal catalog (v8.49+).
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Artifact tree (after install)

```
.cclaw/
  config.yaml               flow defaults
  ideas.md                  /cc-idea drops land here
  state/
    flow-state.json         active flow state (~500 bytes)
    knowledge.jsonl         compound learnings index
    triage-audit.jsonl      v8.44 audit log
  flows/
    <slug>/                 one folder per active task
      plan.md
      build.md
      qa.md                 (v8.52+, UI/web slugs only)
      review.md
      critic.md             (v8.42+)
      plan-critic.md        (v8.51+, strict + complexity≠trivial + AC≥2)
      ship.md
    shipped/<slug>/         finalized tasks
    cancelled/<slug>/       /cc-cancel destination
  lib/
    agents/                 8 specialist contracts
    skills/                 21 auto-trigger skill bodies
    templates/              artifact templates
    runbooks/               11 on-demand runbooks
    patterns/               reference patterns
    anti-rationalizations.md
    antipatterns.md
```

## CLI surface

Two invocations cover every use case. There is no `cclaw plan` / `cclaw status` / `cclaw build` / `cclaw ship` — flow control lives inside `/cc`. The bare subcommand surface (`init`, `sync`, `upgrade`) was retired in v8.29 + v8.37.

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

`install` is idempotent and runs orphan cleanup, so it handles first-time setup, re-sync after a package upgrade, and stale-file cleanup in one command. The TUI menu and the `--non-interactive install` path share the same installer code — they are byte-for-byte identical in write behaviour.

## Contributing

cclaw is dogfooded — every release is shipped via `/cc` against itself. To contribute:

1. Fork and clone.
2. `npm install && npm run build && npm test` (the test suite is the spec; PRs without test updates are rare).
3. Run `/cc <your change>` inside a cclaw-installed harness, or write tests + code directly.
4. Open a PR. CI runs lint, typecheck, unit tests, integration tests, and a smoke runtime test.

The runtime stays under 1 KLOC; new behaviour usually means new prompt content under `src/content/`, not new code under `src/`.

## License

MIT. See [LICENSE](LICENSE).
