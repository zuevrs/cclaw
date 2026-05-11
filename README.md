# cclaw

**A harness-first flow toolkit for coding agents.** `cclaw` turns each `/cc <task>` into a small opinionated loop — classify, optionally co-design, plan, build with TDD, review, ship — running inside Claude Code, Cursor, OpenCode, or Codex. Under 1 KLOC of orchestrator runtime; everything else lives as on-disk Markdown the agent reads on demand.

## Install

Requirements: Node.js 20+ and a git project.

```bash
cd /path/to/your/repo
npx cclaw-cli@latest init                       # interactive: picks your harness
npx cclaw-cli init --harness=claude,cursor      # explicit, no picker
```

`init` auto-detects existing harnesses (`.claude/`, `.cursor/`, `.opencode/`, `.codex/`) and is idempotent. Three slash commands then become available inside your harness:

- `/cc <task>` — start a new flow, or resume the active one
- `/cc-cancel` — abandon the active flow (artifacts move to `.cclaw/flows/cancelled/<slug>/`)
- `/cc-idea` — drop a half-formed idea into `.cclaw/ideas.md` without starting a flow

Flow control (`plan`, `build`, `review`, `ship`) intentionally does **not** live in the CLI. It is the orchestrator's job inside the harness.

## 30-second hello

```text
You:    /cc fix typo in src/util.ts line 42
cclaw:  classified trivial / high confidence — going straight to inline edit
cclaw:  edit applied, committed 4fe5daa "fix typo in util.ts"
```

Trivial tasks ship in one turn with a plain commit. Anything larger walks through the four-stage loop.

## The four-stage flow

`/cc <task>` runs a triage gate, picks a path, and then dispatches one stage at a time:

| Path | When | Stages |
| --- | --- | --- |
| `inline` (trivial) | one file, low risk | edit + commit |
| `soft` (small / medium) | a few files, no migrations | `plan → build → review → ship` |
| `strict` (large / risky) | structural change, auth, schema | `design → plan → build → review → ship` |

Every stage runs as a **fresh sub-agent dispatch** that reads its own contract from `.cclaw/lib/agents/<id>.md`, writes a single artifact under `.cclaw/flows/<slug>/`, and returns a six-line slim summary with an explicit `Confidence: high | medium | low` line. The orchestrator decides whether to chain to the next stage, pause, or loop back to fix-only based on that summary.

**Build is a TDD cycle.** In strict mode every Acceptance Criterion goes RED → GREEN → REFACTOR with one commit per phase via `commit-helper.mjs`; ship is gated on every AC having a real SHA. Soft mode runs the cycle once for the whole feature; inline skips it.

When the planner declares topology `parallel-build` (≥4 AC across ≥2 disjoint touch surfaces, every AC `parallelSafe: true`), strict-mode build fans out into git worktrees — capped at 5 slices, never split into "wave 2". Integration review reads each branch before the orchestrator merges. Harnesses without sub-agent dispatch fall back to inline-sequential with an explicit user accept-fallback step.

## What makes it different

- **Cross-flow memory is a closed loop.** Every shipped slug appends a deduped entry to `.cclaw/state/knowledge.jsonl`. The next `/cc` reads it at triage, surfaces the top three nearby slugs as `triage.priorLearnings`, and feeds them to `design`, `planner`, and `reviewer` as context. `cclaw knowledge` lists the catalogue.
- **Triage with zero prompts when it is safe.** Trivial tasks classified high-confidence skip the structured ask entirely. Everything else gets a single combined-form question (path and run-mode in one ask). No multi-step intake.
- **Sub-agents come with a mandatory contract read.** Every dispatch envelope lists the specialist's `.md` and its wrapping skill as required first reads. A sub-agent that skips them is acting on a hallucinated role.
- **Stage-windowed skill loading.** A `build` dispatch sees the skills that apply to build; a `review` dispatch sees the skills that apply to review. Seventeen skills are on disk, but each specialist only sees its slice.
- **Calibrated confidence is a routing signal.** `Confidence: low` is a hard pause even in autopilot. `Confidence: medium` requires a `Notes:` line explaining what drove it down. The orchestrator routes on the calibration, not on its own memory of the dispatch.

## Specialists and research helpers

Five on-demand specialists plus two read-only research helpers, every one a sub-agent with its own contract:

| id | when |
| --- | --- |
| `design` | large-risky discovery: clarify, frame, approaches, decisions inline, optional pre-mortem, sign-off. Multi-turn in main context. |
| `planner` | breaks the task into Acceptance Criteria and picks topology (sequential vs parallel-build) |
| `slice-builder` | implements one slice with TDD; commits per AC via `commit-helper.mjs` |
| `reviewer` | seven-axis review (`correctness · test-quality · readability · architecture · complexity-budget · security · performance`), with per-iteration dedup and a 5-iteration cap |
| `security-reviewer` | threat-model + sensitive-change pass; auto-fires when the diff touches auth, secrets, crypto, or migrations |
| `repo-research` (helper) | brownfield repo scan; called by `planner` before authoring |
| `learnings-research` (helper) | scans `knowledge.jsonl` for prior shipped slugs that overlap |

Strict-mode review additionally runs an adversarial pre-mortem pass at ship gate, and an unresolved `severity=required + axis=architecture` finding blocks ship across every AC mode until the user explicitly accepts.

Each prompt is 200-600 lines with an output schema, worked examples, and hard rules. See `.cclaw/lib/agents/*.md` after `init`.

## Skills layer

Seventeen auto-trigger skills wrap the specialists: `triage-gate`, `plan-authoring`, `tdd-and-verification`, `ac-discipline`, `review-discipline`, `commit-hygiene`, `parallel-build`, `source-driven`, `documentation-and-adrs`, `debug-and-browser`, `api-evolution`, `refinement`, `flow-resume`, `pre-flight-assumptions`, `conversation-language`, `anti-slop`, `summary-format`. Each carries a stages tag; the prompt block rendered into a specialist contains only the skills that apply to its stage. Bodies live at `.cclaw/lib/skills/*.md` and load on demand.

## Artifact tree

```
.cclaw/
  config.yaml                  harness selection + opt-in flags
  ideas.md                     append-only idea backlog (/cc-idea)
  state/
    flow-state.json            active slug, stage, triage
    knowledge.jsonl            cross-flow learnings, append-only
  hooks/
    session-start.mjs          rehydrate flow state on harness boot
    stop-handoff.mjs           short reminder when stopping mid-flow
    commit-helper.mjs          atomic commit per AC + traceability check
  flows/
    <slug>/                    active flow: plan.md, build.md, review.md, ship.md
    shipped/<slug>/            archived after ship
    cancelled/<slug>/          after /cc-cancel
  lib/                         read-only reference content
    agents/                    5 specialist + 2 research-helper prompts
    skills/                    18 skill files (17 auto-trigger + cclaw-meta)
    templates/                 11 artifact templates
    runbooks/                  4 per-stage runbooks
    patterns/                  2 reference patterns (auth-flow, security-hardening)
    antipatterns.md            7 named failure modes
    decision-protocol.md       short-form architectural decision schema
```

`.cclaw/state/` and `.cclaw/worktrees/` are gitignored on `init`. Everything else is committable and meant to be read by the next agent or by you on review.

## CLI

```bash
cclaw init                     # install assets, wire harness
cclaw sync                     # idempotent reapply (also runs orphan cleanup)
cclaw upgrade                  # post-package-update sync
cclaw knowledge                # list captured learnings (--tag, --surface, --json, --all)
cclaw uninstall                # remove cclaw assets
cclaw version | help
```

`cclaw knowledge` is the read-side of the compound loop. It groups entries by tag, sorts by recency, and accepts `--tag=<tag>` / `--surface=<substring>` filters or `--json` for piping into `jq`.

## AC traceability and commit-helper

In strict mode `commit-helper.mjs` is the only supported way to commit during `/cc`:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

The hook checks that `AC-1` is declared in `plan.md`, writes the new SHA back into `flow-state.json`, and refuses to run when the state schema is out of date. Ship is blocked unless every AC has a real SHA chain. Soft and inline modes use plain `git commit` and skip the gate.

## When to use cclaw, and when to use something else

cclaw is opinionated: discovery on risky work, planning, TDD-enforced builds, multi-iteration review, ship gate, automatic compounding. The price is process — even a small task pays for one triage ask.

- **Reach for cclaw** when you want a structured loop with cross-flow memory and a real review pass on every shipped change, especially on a codebase you will come back to next week.
- **Reach for something lighter** (a vanilla `CLAUDE.md`, [`andrej-karpathy-skills`](https://github.com/forrestchang/andrej-karpathy-skills)) for one-off edits, throwaway prototypes, or scripts where ceremony costs more than it returns.
- **Reach for a broader harness** ([`gstack`](https://github.com/garrytan/gstack), [`superpowers`](https://github.com/obra/superpowers)) when you want browser-driven QA, design generation, parallel-sprint workflows, or a much larger specialist catalogue. cclaw's small surface is intentional; it is not trying to be a full replacement for those.

## Compound learnings (automatic, gated)

After ship, cclaw checks whether the run produced something worth remembering — a non-trivial decision was recorded by `design` or `planner`, review needed three or more iterations, a security review ran, or the user asked to capture. If yes, `flows/<slug>/learnings.md` is written and one deduped line is appended to `.cclaw/state/knowledge.jsonl`. If no, silently skipped so the index stays signal-rich. Every fifth capture also triggers a knowledge-refresh pass (dedup / consolidate / supersede) so the index does not bloat.

## Conversation language

cclaw replies in the user's language for prose. It never translates wire-protocol identifiers — slugs, `AC-N`, `D-N`, `F-N`, frontmatter keys, file paths, hook output, specialist names, or commit tags stay in their original form. Enforced by the always-on `conversation-language` skill.

## More docs

- [CHANGELOG.md](CHANGELOG.md) — full release history (v8.0 onward; v7→v8 migration at the bottom)
- [docs/skills.md](docs/skills.md) — the auto-trigger skill layer
- [docs/config.md](docs/config.md) — `.cclaw/config.yaml` reference
- [docs/harnesses.md](docs/harnesses.md) — what each harness installs
- [docs/scheme-of-work.md](docs/scheme-of-work.md) — end-to-end flow walk-through
- [docs/v8-vision.md](docs/v8-vision.md) — locked design decisions for v8
- [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md) — coming from cclaw 7.x

## License

MIT — see [LICENSE](LICENSE). Contributions welcome.
