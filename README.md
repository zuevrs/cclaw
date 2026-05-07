# cclaw

**cclaw is a lightweight harness-first flow toolkit for coding agents.** It installs three slash commands, six on-demand specialists, and a tiny runtime into your project so Claude Code, Cursor, OpenCode, or Codex can move from idea to shipped change with a clear plan, AC traceability, and almost no ceremony.

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

Three slash commands. Four stages. Six specialists. One mandatory gate (AC traceability).

## What changed in v8

cclaw v8.0 is a breaking redesign. We dropped the 7.x stage machine: no more `brainstorm` / `scope` / `design` / `spec` / `tdd` mandatory stages, no more 18 specialists, no more 9 state files, no more 30 stage gates. v7.x runs are not migrated; see [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md).

What we kept: plans with acceptance criteria, AC ↔ commit traceability, durable artifacts your team and graph tools can index.

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

Specialists are proposed only when the task is large, abstract, risky, security-sensitive, or spans multiple components. Trivial and small/medium tasks run inline.

## Artifacts

```
.cclaw/
  plans/<slug>.md           current work + AC
  builds/<slug>.md          implementation log + AC↔commit chain
  reviews/<slug>.md         findings, Five Failure Modes
  ships/<slug>.md           release notes, push/PR refs
  decisions/<slug>.md       written by architect (optional)
  learnings/<slug>.md       written by compound when quality gate passes
  state/flow-state.json     ~500 bytes, schemaVersion: 2
  shipped/<slug>/           all of the above moved here on ship
  knowledge.jsonl           cross-feature learnings index
```

Frontmatter on every artifact carries `slug`, `stage`, `status`, an `ac:` array, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`. AC use `AC-N` ids and link to commit SHAs and `file:path:line` references for Graphify / GitNexus indexing.

## AC traceability gate

The single mandatory gate. Ship is blocked unless every AC in the active plan is `status: committed` with a real commit SHA. The `commit-helper.mjs` hook runs `git commit` and updates flow-state for you when you stage AC-related changes:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

## Compound, automatic with a quality gate

After ship, cclaw automatically checks whether the run produced something worth remembering:

- a non-trivial decision was recorded by `architect` or `planner`, or
- review needed three or more iterations, or
- a security review ran or `security_flag` is true, or
- the user explicitly asked to capture.

If yes → `learnings/<slug>.md` is written and one line appended to `knowledge.jsonl`. If no → silently skipped, so the index stays signal-rich. Then everything moves to `.cclaw/shipped/<slug>/` with a `manifest.md`.

## Five failure modes

Reviews always check for: hallucinated actions, scope creep, cascading errors, context loss, tool misuse. Hard cap is 5 review/fix iterations — then stop and report.

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

## More docs

- [docs/v8-vision.md](docs/v8-vision.md) — locked decisions, full kill-list, references review
- [docs/scheme-of-work.md](docs/scheme-of-work.md) — flow walk-through with all checkpoints
- [docs/config.md](docs/config.md) — `.cclaw/config.yaml` reference
- [docs/harnesses.md](docs/harnesses.md) — what each harness installs
- [docs/quality-gates.md](docs/quality-gates.md) — AC traceability + Five Failure Modes
- [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md) — from cclaw 7.x

## License

MIT. See [LICENSE](LICENSE).
