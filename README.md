# cclaw

**cclaw is a file-backed flow runtime for coding agents.** It turns Claude Code, Cursor, OpenCode, and Codex into one repeatable path from idea to shipped change: visible stages, hard gates, real subagent evidence, and resumable closeout in your repo.

```text
        idea
         |
         v
   +-------------+      +--------+      +--------+      +------+      +------+      +-----+
   | brainstorm  | ---> | scope  | ---> | design | ---> | spec | ---> | plan | ---> | tdd |
   +-------------+      +--------+      +--------+      +------+      +------+      +-----+
                                                                                       |
                                                                                       v
                                                                                  +--------+      +------+
                                                                                  | review | ---> | ship |
                                                                                  +--------+      +------+
                                                                                                      |
                                                                                                      v
                                                                                         post_ship_review -> archive
```

The promise is simple: at any point you can ask **where are we, what is blocked, what evidence exists, and what should run next?**

## First 5 Minutes

Requirements: Node.js 20+ and a git project root.

```bash
cd /path/to/your/repo
npx cclaw-cli
```

Then work from your coding harness:

```text
/cc <idea>          start, resume, or continue a tracked flow
/cc-idea          generate or refresh an idea backlog
/cc-cancel          end the current run cleanly with a reason
```

`/cc-idea` is a utility command for backlog discovery. It is distinct from
`.cclaw/artifacts/00-idea.md`, which is the stage artifact created by
`/cc <idea>`.

For scripted setup:

```bash
npx cclaw-cli init --harnesses=claude,cursor --no-interactive
```

If generated files or hooks look stale, run `npx cclaw-cli sync`.

## Why cclaw

AI coding sessions fail when decisions live only in chat. cclaw puts the operating truth in files:

```text
.cclaw/
  artifacts/              active stage docs: 00-idea.md through 09-retro.md
  state/flow-state.json   current stage, gates, stale markers, closeout.shipSubstate
  state/delegation-log.json
                           subagent dispatches, waivers, evidence refs
  knowledge.jsonl         reusable lessons harvested from stage artifacts
  archive/                archived run snapshots (durable closeout proof)
```

Legacy `.cclaw/runs/` directories are only auto-removed when empty. If the directory still contains data, migrate it manually to `.cclaw/archive/`.

That gives you:

- **One path** from idea to ship, with `quick`, `medium`, and `standard` tracks.
- **Real gates** for evidence, tests, review, delegation, stale-stage recovery, and closeout.
- **Subagents with accountability**: controller owns state, workers do bounded tasks, overseers validate, evidence lands in `delegation-log.json`.
- **Recovery instead of confusion**: `npx cclaw-cli sync` tells you blockers and next fixes.
- **Portable harness behavior** across Claude Code, Cursor, OpenCode, and Codex.

## The Daily Loop

```text
1. Start or resume
   /cc <idea>

2. Work the current stage
   The agent writes/updates per-stage files like .cclaw/artifacts/00-idea.md, 01-brainstorm-<slug>.md, 02-scope-<slug>.md

3. Prove the gate
   stage-complete records evidence in flow-state.json

4. Inspect when stuck
   npx cclaw-cli sync

5. Close out after ship
   /cc continues post_ship_review -> archive
```

Tracks keep the flow proportional:

```text
quick     spec -> tdd -> review -> ship
medium    brainstorm -> spec -> plan -> tdd -> review -> ship
standard  brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship
```

Track selection is **model-guided and advisory** during `/cc`. Runtime enforcement begins after state is written: subsequent `/cc` turns follow the selected track, required gates, delegation rules, stale-stage markers, and `closeout.shipSubstate`.

## When Blocked

Start here:

```text
npx cclaw-cli sync
```

A useful status should read like an operator note, not a raw dump:

```text
Current: tdd (standard)
Blocked by: NO_SOURCE_CONTEXT
Next: cclaw internal rewind plan "add bootstrap slice", then /cc
Evidence needed: fresh RED/GREEN/REFACTOR slice and verification output
```

Common exits:


| Situation                                         | Next action                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Missing gates                                     | Run `/cc`, finish the stage, then complete with evidence.                            |
| Mandatory delegation missing evidence             | Dispatch the worker/overseer or waive explicitly with rationale.                     |
| `NO_SOURCE_CONTEXT` or `NO_TEST_SURFACE`          | Rewind to `plan`/`spec`, define the source or test surface, then resume TDD.         |
| `NO_IMPLEMENTABLE_SLICE` or `RED_NOT_EXPRESSIBLE` | Rework `design`/`spec`/`plan` until one vertical slice is testable.                  |
| `NO_VCS_MODE`                                     | Restore git, set `vcs: none` with hash evidence, or configure `tdd.verificationRef`. |
| Review blocked                                    | `cclaw internal rewind tdd "review_blocked_by_critical <finding-ids>"`.              |
| Stale stage after rewind                          | Redo the marked stage, then `cclaw internal rewind --ack <stage>`.                   |
| Broken hooks or generated files                   | `npx cclaw-cli sync`, then follow the fail-fast error guidance if it still fails. |


## Subagents Without Theater

```text
user goal
   |
   v
controller ---------------> worker: bounded implementation/test/doc task
   |                         |
   |                         v
   +----------------------> overseer: read-only validation
                             |
                             v
                     evidence refs + terminal status
                             |
                             v
                 .cclaw/state/delegation-log.json
```

The controller owns `flow-state.json`, sequencing, synthesis, and the final answer. Workers own scoped work. Overseers verify. A waiver means the work was **not** done by a real worker and must say why proceeding is acceptable.

## What Is Enforced

Enforced by generated helpers and state checks:

- Stage completion goes through `node .cclaw/hooks/stage-complete.mjs <stage>`.
- Required gates need evidence before advancement.
- Mandatory delegations need terminal evidence or explicit waiver.
- Stale stages block until redone and acknowledged.
- Review criticals route back to TDD.
- Ship continues through `post_ship_review -> archive` with `closeout.shipSubstate`.

Advisory/model-guided:

- Initial track heuristic wording.
- Proactive subagents that are not mandatory for the active stage/tier.
- Reference patterns that shape prompts but do not add runtime states.

## The Deeper Contract

The README is the front door. The full operating contract lives here:

- [Scheme of Work](./docs/scheme-of-work.md): stages, gates, recovery, closeout, state files.
- [Configuration](./docs/config.md): strictness, tracks, TDD, compound, language packs, hooks.
- [Harnesses](./docs/harnesses.md): Claude, Cursor, OpenCode, Codex capabilities and fallbacks.
- [Generated Agent Block Example](./docs/agents-block.example.md): what gets injected into harness guidance.

## CLI Reference

```bash
npx cclaw-cli                   # interactive setup or installed status hint
npx cclaw-cli init --harnesses=<list> --no-interactive
npx cclaw-cli sync              # regenerate managed runtime files
npx cclaw-cli upgrade           # refresh generated files while preserving config
npx cclaw-cli archive           # explicit archive/reset; normal closeout uses /cc
npx cclaw-cli uninstall         # remove .cclaw and generated harness shims
npx cclaw-cli --version
```

## License

[MIT](./LICENSE)