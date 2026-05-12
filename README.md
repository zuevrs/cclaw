# cclaw

**A harness-first flow toolkit for coding agents.** `cclaw` wraps each `/cc <task>` in a small opinionated loop — triage, optionally co-design, plan with AC, build with TDD, review, ship — running inside Claude Code, Cursor, OpenCode, or Codex. Under 1 KLOC of orchestrator runtime; everything else lives as on-disk Markdown the agent reads on demand.

## Install

Requirements: Node.js 20+ and a git project.

```bash
cd /path/to/your/repo
npx cclaw-cli@latest                                              # interactive TUI menu
npx cclaw-cli --non-interactive install --harness=claude,cursor   # CI / scripts: explicit
```

Running `npx cclaw-cli@latest` with no args opens a top-level menu — Install / Sync / Upgrade / Uninstall / Browse knowledge / Show version / Quit — with a smart default (Install when no `.cclaw/`, Sync when there is one). For CI use `--non-interactive <command>`; bare `cclaw init` / `cclaw sync` were dropped in v8.29 and point at the TUI. Install is idempotent and auto-detects existing harnesses from `.claude/`, `.cursor/`, `.opencode/`, `.codex/` markers when no `--harness=` is passed.

Three slash commands then become available in your harness:

- `/cc <task>` — start a new flow, or resume the active one
- `/cc-cancel` — abandon the active flow (artifacts move to `.cclaw/flows/cancelled/<slug>/`)
- `/cc-idea` — drop a half-formed idea into `.cclaw/ideas.md` without starting a flow

Flow control (`plan`, `build`, `review`, `ship`) intentionally does **not** live in the CLI — it is the orchestrator's job inside the harness.

## The four-stage flow

`/cc <task>` runs a triage gate, picks a path, and then dispatches one stage at a time:

| Path | When | Stages |
| --- | --- | --- |
| `inline` | trivial: one file, low risk | edit + commit |
| `soft` | small / medium: a few files, no migrations | `plan → build → review → ship` |
| `strict` | large / risky: structural change, auth, schema, migrations | `design → plan → build → review → ship` |

Every stage is a fresh sub-agent dispatch that reads its own contract from `.cclaw/lib/agents/<id>.md`, writes one artifact under `.cclaw/flows/<slug>/`, and returns a six-line summary with an explicit `Confidence: high | medium | low` line. The orchestrator chains, pauses, or loops back to a fix-only iteration based on that summary.

**Build is a TDD cycle.** In strict mode every Acceptance Criterion goes RED → GREEN → REFACTOR with one commit per phase via `commit-helper.mjs`; ship is gated on every AC having a real SHA. Soft mode runs the cycle once for the whole feature; inline skips it.

When `ac-author` declares topology `parallel-build` (≥4 AC across ≥2 disjoint touch surfaces, every AC `parallelSafe: true`), strict-mode build fans out into git worktrees — capped at five slices, never split into "wave 2". Integration review reads each branch before the orchestrator merges. Harnesses without sub-agent dispatch fall back to inline-sequential with an explicit user accept-fallback step.

## What makes it different

- **Cross-flow memory is a closed loop.** Every shipped slug appends a deduped entry to `.cclaw/state/knowledge.jsonl`. The next `/cc` reads it at triage, surfaces the top three nearby slugs as `triage.priorLearnings`, and feeds them to `design`, `ac-author`, and `reviewer` as context. `cclaw --non-interactive knowledge` (or the TUI's "Browse knowledge") lists the catalogue.
- **Stage-windowed skill loading.** A `build` dispatch sees only the skills tagged for build; a `review` dispatch sees only the skills tagged for review. Seventeen skills live on disk, but each specialist sees its slice.
- **Calibrated confidence is a routing signal.** `Confidence: low` is a hard pause even in autopilot. `Confidence: medium` requires a `Notes:` line. The orchestrator routes on the calibration, not on its own memory of the dispatch.

## Specialists

Five on-demand specialists plus two read-only research helpers:

| id | role |
| --- | --- |
| `design` | large-risky discovery: clarify, frame, approaches, decisions inline, optional pre-mortem, sign-off. Multi-turn in main context. |
| `ac-author` | breaks the task into Acceptance Criteria, picks topology (sequential vs parallel-build), writes `plan.md`. |
| `slice-builder` | implements one slice with TDD; commits per AC via `commit-helper.mjs`. |
| `reviewer` | seven-axis review (correctness / test-quality / readability / architecture / complexity-budget / security / performance). Per-iteration dedup, five-iteration cap. |
| `security-reviewer` | threat-model + sensitive-change pass; auto-fires when the diff touches auth, secrets, crypto, or migrations. |
| `repo-research` (helper) | brownfield scan; called by `ac-author` before authoring. |
| `learnings-research` (helper) | scans `knowledge.jsonl` for prior shipped slugs that overlap. |

Strict-mode review additionally runs an adversarial pre-mortem pass at ship gate. An unresolved `severity=required + axis=architecture` finding blocks ship across every AC mode until the user explicitly accepts.

Each prompt is 200-600 lines with an output schema, worked examples, and hard rules. After `install` they live at `.cclaw/lib/agents/*.md` (shared) and mirrored under your harness's agents directory.

## CLI

```bash
cclaw                                          # open the TUI menu (interactive default)
cclaw --version | --help                       # version / help flags
cclaw --non-interactive install                # CI: install / reapply assets (idempotent + orphan cleanup)
cclaw --non-interactive knowledge              # CI: list captured learnings (--tag, --surface, --json, --all)
cclaw --non-interactive uninstall              # CI: remove cclaw assets
cclaw --non-interactive version | help         # CI: print version / help and exit
```

`--non-interactive` is the CI / scripts escape hatch — bare `cclaw init` / `cclaw sync` etc. error in v8.29 and point at the TUI. The non-interactive surface is five commands: **install**, **knowledge**, **uninstall**, **version**, **help**. `--non-interactive install` is the single idempotent installer — calling it on an already-installed project re-applies cclaw assets and runs orphan cleanup, which is what `--non-interactive sync` / `--non-interactive upgrade` did before v8.37; those names exit 1 with a migration hint pointing at `install`. The TUI menu keeps its `Sync` / `Upgrade` rows so a human reading the menu sees the right intent. `--non-interactive knowledge` is the read-side of the compound loop; it groups entries by tag, sorts by recency, and accepts `--tag=<tag>` / `--surface=<substring>` filters or `--json` for piping into `jq`.

## AC traceability via `commit-helper`

In strict mode, `commit-helper.mjs` is the only supported way to commit during `/cc`:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

The hook checks that `AC-1` is declared in `plan.md`, writes the new SHA back into `flow-state.json`, and refuses to run when the state schema is out of date. Ship is blocked unless every AC has a real SHA chain. Soft and inline modes use plain `git commit` and skip the gate.

## Compound learnings (automatic, gated)

After ship, cclaw checks whether the run produced something worth remembering — a non-trivial decision was recorded by `design` or `ac-author`, review needed three or more iterations, a security review ran, or the user asked to capture. If yes, `flows/<slug>/learnings.md` is written and one deduped line is appended to `.cclaw/state/knowledge.jsonl`. If no, silently skipped so the index stays signal-rich. Every fifth capture triggers a knowledge-refresh pass (dedup / consolidate / supersede) so the index does not bloat.

## When to use cclaw, and when not to

cclaw is opinionated: discovery on risky work, planning, TDD-enforced builds, multi-iteration review, ship gate, automatic compounding. The price is process — even a small task pays for one triage ask.

- **Reach for cclaw** when you want a structured loop with cross-flow memory and a real review pass on every shipped change, especially on a codebase you will come back to next week.
- **Reach for something lighter** (a vanilla `CLAUDE.md`, [`andrej-karpathy-skills`](https://github.com/forrestchang/andrej-karpathy-skills)) for one-off edits, throwaway prototypes, or scripts where ceremony costs more than it returns.
- **Reach for a broader harness** ([`gstack`](https://github.com/garrytan/gstack), [`superpowers`](https://github.com/obra/superpowers)) for browser-driven QA, design generation, parallel-sprint workflows, or a much larger specialist catalogue. cclaw's small surface is intentional; it is not trying to replace those.

## More

- [CHANGELOG.md](CHANGELOG.md) — full release history (v8.0 onward; v7→v8 migration notes at the bottom)
- `.cclaw/lib/skills/*.md` after install — the seventeen auto-trigger skills + cclaw-meta, each with its trigger and depth sections
- `.cclaw/config.yaml` after install — harness selection + opt-in flags

## License

MIT — see [LICENSE](LICENSE). Contributions welcome.
