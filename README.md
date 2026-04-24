# cclaw

**Install once, ship every time.** cclaw is an installer-first workflow
runtime that gives your AI coding agent one inspectable path from idea to
shipped PR — **plus an automatic closeout chain** that turns every ship
into reusable knowledge:

> **brainstorm → scope → design → spec → plan → tdd → review → ship**  
> **↳ auto-closeout: retro → compound → archive** *(resumable, never manual)*

Every stage has real gates the agent cannot skip, every decision leaves a
file-backed audit trail, and the same slash commands work across Claude
Code, Cursor, OpenCode, and OpenAI Codex.

You install cclaw **once** from the terminal, then everything happens
inside your harness — no hidden control plane, no background daemon, no
operational knobs to memorise.

---

## Who this is for

- Solo builders who want **shipped outcomes** instead of endless chat.
- Engineering teams that need a **single, repeatable path** for AI-assisted
  changes across multiple harnesses and languages.
- Staff engineers and tech leads who want **enforceable discipline**:
  locked-in decisions, no placeholders, mandatory TDD, traceable plans.
- Maintainers who want a compact, file-backed flow their harness agents can actually follow.

---

## How it works

```
  ┌─────────┐   ┌──────┐   ┌────────┐   ┌──────┐   ┌──────┐
  │  Idea   │ → │ /cc  │ → │Classify│ → │Track │ → │Stages│
  └─────────┘   └──────┘   └────────┘   └──────┘   └──┬───┘
                                                      │
      ┌───────────────────────────────────────────────┘
      ▼
  brainstorm → scope → design → spec → plan → tdd → review → ship
      │          │        │       │      │      │      │       │
      ▼          ▼        ▼       ▼      ▼      ▼      ▼       ▼
   01.md      02.md    03.md   04.md  05.md  06.md  07.md   08.md
      │                                                      │
      └──── gates + subagents + knowledge capture             │
            happen at every step                              │
                                                              ▼
                                              ┌─────────────────────────┐
                                              │  automatic closeout     │
                                              │  (resumable state       │
                                              │   machine, never manual)│
                                              └────────────┬────────────┘
                                                           ▼
                                        retro ──► compound ──► archive
                                        09.md     (knowledge  (runs/
                                                   promoted)   <slug>/)
```

Every stage reads and writes real files under `.cclaw/`. `flow-state.json`
holds the single source of truth for "where are we" — including
`closeout.shipSubstate` so a ship → retro → compound → archive chain
resumes at the exact step after any interruption. `knowledge.jsonl`
accumulates reusable lessons **throughout** the flow, not only at the
end; stage artifacts live under `.cclaw/artifacts/` until archive rolls
them into `.cclaw/runs/<date-slug>/`.

```
You ──► /cc <idea>
        │
        ▼
   harness loads stage contract + HARD-GATE
        │
        ▼
   cclaw reads state + knowledge, guides execution
        │
        ▼
   artifacts written, handoff captured
        │
        ▼
   next stage is explicit in flow-state.json
```

---

## 30-second install

```bash
npx cclaw-cli
```

Interactive setup will pick which harnesses to install into. For CI or
scripted installs:

```bash
npx cclaw-cli init --harnesses=claude,cursor --no-interactive
```

That's the entire required CLI interaction for the normal workflow.
Everything day-to-day happens inside your harness (Claude Code, Cursor,
OpenCode, or Codex); optional maintenance commands are listed in the
CLI reference.

### What gets generated

```text
.cclaw/
├── commands/           # four entrypoints: /cc, /cc-next, /cc-ideate, /cc-view
├── skills/             # flow-critical skills loaded by the harness
├── templates/          # artifact skeletons for each stage
├── rules/              # opt-in language rule packs
├── agents/             # subagent definitions
├── hooks/              # harness-agnostic hook runtime
├── artifacts/          # active run artifacts (00-idea.md -> 09-retro.md)
├── runs/               # archived run snapshots: YYYY-MM-DD-slug/
├── state/              # flow-state.json + stage activity log
└── knowledge.jsonl     # append-only lessons + patterns
```

Plus harness-specific shims:

- `.claude/commands/cc*.md` + `.claude/hooks/hooks.json`
- `.cursor/commands/cc*.md` + `.cursor/hooks.json` + `.cursor/rules/cclaw-workflow.mdc`
- `.opencode/commands/cc*.md` + `.opencode/plugins/cclaw-plugin.mjs`
- `.agents/skills/cc*/SKILL.md` + `.codex/hooks.json` (Codex; skills are
  activated via `/use cc` or description-based auto-matching. Hooks
  require Codex CLI ≥ v0.114 and `[features] codex_hooks = true` in
  `~/.codex/config.toml`; `cclaw init --codex` offers to patch that flag
  for you. `.codex/commands/` and the legacy `.agents/skills/cclaw-cc*/`
  folders are auto-cleaned on sync.)
- `AGENTS.md` with a managed routing block (includes a Codex-specific note)

### `.cclaw/config.yaml` — the minimal surface

`cclaw init` writes five keys, on purpose:

```yaml
version: ${CCLAW_VERSION}
flowVersion: 1.0.0
harnesses:
  - claude
  - cursor
  - opencode
  - codex
strictness: advisory     # advisory | strict — one knob for prompt-guard + TDD
gitHookGuards: false     # opt in to managed .git/hooks/pre-commit + pre-push
```

If cclaw detects a Node / Python / Go project at init time, a sixth
`languageRulePacks` line appears (auto-populated from `package.json`,
`pyproject.toml` / `requirements.txt`, `go.mod`). That is the full
default surface — a new user sees nothing they need to understand yet.

Advanced knobs (`ironLaws.strictLaws` per-law escapes,
`tdd.testPathPatterns` / `tdd.productionPathPatterns`,
`compound.recurrenceThreshold`, `defaultTrack`, `trackHeuristics`,
`sliceReview`) are **opt-in**: add them by hand when you need them.
`cclaw upgrade` preserves exactly what you wrote — it never silently
reintroduces defaults you removed.

Full key-by-key reference: [`docs/config.md`](./docs/config.md).

---

## The four commands you actually use

All four appear as slash commands in every supported harness. This is the
top-level user surface — everything else is either automatic or happens
inside `/cc-next`, automatic closeout, or `cclaw archive`.

| Command | What it does |
|---|---|
| **`/cc <idea>`** | Classify the task, discover origin docs (`docs/prd/**`, ADRs, root `PRD.md`, …), sniff the stack, recommend a track, then start the first stage of that track. `/cc` without arguments resumes the current flow. |
| **`/cc-next`** | The one progression primitive. Reads `flow-state.json`, checks gates + mandatory subagent delegations, and either resumes the current stage or advances to the next. `/cc-next` in a new session is how you **resume**. |
| **`/cc-ideate`** | Repository improvement ideate mode. Scans for TODOs, flaky tests, oversized modules, docs drift, and recurring knowledge-store lessons, **persists the ranked backlog** to `.cclaw/artifacts/ideate-<date>-<slug>.md`, and ends with a concrete handoff: launch `/cc` on the selected candidate in the same session, save-and-close, or discard. Resume check on next run reuses any ideate artifact younger than 30 days. Never mutates `flow-state.json`. |
| **`/cc-view`** | Read-only flow visibility. `/cc-view status` (default) shows stage progress, mandatory delegations with their fulfillment mode (isolated / generic-dispatch / role-switch), the ship closeout substate (retro → compound → archive), and the active harness parity row. `/cc-view tree` renders the same picture as a tree with a closeout sub-branch under ship and a per-harness playbook summary. `/cc-view diff` shows stage/gate/closeout/delegation deltas since the last run. Never mutates state (except diff's snapshot baseline). |

Operational extras stay off the slash-command surface: `/cc-next` handles progression and closeout, while `cclaw archive` handles explicit archival/reset.

### Example first-run

```text
> /cc Add rate limiting to the public /api/v1/search endpoint

cclaw:  Classifying task…
        Class: software-medium
        Discovered context: docs/rfcs/rate-limit-strategy.md (rate-limit policy draft)
        Stack: node 20.10.0 (pnpm), fastify 4.26, redis 7
        Recommended track: medium (matched triggers: "add endpoint")
        Override? (A) keep medium  (B) switch track  (C) cancel
> A
cclaw:  Persisting flow-state.json, seeding 00-idea.md, entering brainstorm…
```

After this `flow-state.json` contains:

```json
{
  "currentStage": "brainstorm",
  "track": "medium",
  "skippedStages": ["scope", "design"],
  "stageGateCatalog": { "brainstorm": { "passed": [], "blocked": [] } },
  "completedStages": []
}
```

And `00-idea.md` starts with:

```text
Class: software-medium
Track: medium (matched: "add endpoint")
Stack: node 20.10.0, fastify 4.26, redis 7

## Discovered context

- docs/rfcs/rate-limit-strategy.md — rate-limit policy draft (Q2 2026)

## User prompt

Add rate limiting to the public /api/v1/search endpoint
```

No magic. No ambiguity about where you are.

---

## The eight stages, the three tracks, and auto-closeout

cclaw has eight **critical-path** stages plus an automatic three-step
closeout chain (retro → compound → archive). A single prompt rarely needs
all eight critical-path stages, so `/cc` picks a **track** up front so
the flow matches the task.

| Track | Critical path | Typical trigger |
|---|---|---|
| **quick** | `spec → tdd → review → ship` | `bug`, `hotfix`, `typo`, `rename`, `bump`, `docs only`, one-liners |
| **medium** | `brainstorm → spec → plan → tdd → review → ship` | `add endpoint`, `add field`, `extend existing`, `wire integration` |
| **standard** _(default)_ | all 8 stages (+ mandatory design-time parallel research fleet) | `new feature`, `refactor`, `migration`, `platform`, `schema`, `architecture` |

**Every track ends with the same auto-closeout chain.** Once ship
completes, `/cc-next` automatically drives
`retro → compound → archive` — with `closeout.shipSubstate` carrying the
exact step across sessions, so a crashed or backgrounded run resumes
without re-drafting retros or re-asking structured questions. See
[Ship and closeout](#ship-and-closeout--automatic-resumable).

Each critical-path stage produces a dated artifact under
`.cclaw/artifacts/`: `00-idea.md` (seed), `01-brainstorm.md`, `02-scope.md`,
`02a-research.md` (design research fleet synthesis), `03-design.md` through
`08-ship.md`. Closeout adds `09-retro.md`; archive then rolls the whole
bundle into `.cclaw/runs/<YYYY-MM-DD-slug>/` and resets the active flow for
the next feature.

### Track heuristics are configurable (advisory)

Every team has its own vocabulary. Override the built-in trigger lists in
`.cclaw/config.yaml`:

```yaml
trackHeuristics:
  fallback: standard
  tracks:
    quick:
      triggers: [hotfix, rollback, prod-incident]
      veto: [schema, migration]   # never route quick even if a trigger hits
    standard:
      triggers: [epic, platform-team, core-infra]
```

Honest caveat: this config is **advisory**. cclaw surfaces these lists in
the `/cc` skill and contract prose so the LLM applies them during
classification — there is no Node-level router that mechanically enforces
the outcome. That is why the knobs are deliberately minimal: per-track
`triggers` + `veto` on top of defaults, plus `fallback`. Evaluation order is
fixed (`standard -> medium -> quick`, narrow-to-broad); regex `patterns`
and a `priority` override were removed in v0.38.0 because nothing in
runtime consumed them.

### Mid-flow reclassification

If you seed a task as `quick` and evidence in spec shows it actually needs a
schema migration, cclaw **stops and asks** before quietly advancing.
Reclassification is append-only: the old decision stays in history.

---

## Guardrails that ship in the box

These are the things that make cclaw "enterprise-strong" without turning
it into ceremony:

- **Locked decisions (D-XX IDs).** Scope decisions are numbered and must
  reappear in plan + TDD artifacts. The artifact linter catches any
  silent drift.
- **No placeholders.** `TBD`, `TODO`, `similar to task`, and "static for
  now"-style scope reduction are flagged before a stage completes.
- **Stale-stage detection.** If an upstream artifact changes after a
  downstream stage is already complete, cclaw marks the downstream stage
  stale and refuses to advance until you re-run it (or explicitly
  acknowledge via a manual override).
- **Mandatory subagent delegation** at TDD, with per-harness waivers.
- **Turn Announce Discipline.** Every stage entry/exit emits a visible
  line so users can see what the agent is doing, not just what it says.
- **Inline protocols.** Decision, Completion, and Ethos discipline is embedded in the active stage skill so users do not need to chase generated reference files.
- **Knowledge capture throughout the flow.** Every stage completion
  protocol emits typed entries (`rule` / `pattern` / `lesson`) to
  `.cclaw/knowledge.jsonl` as the flow progresses — not only at retro.
  Retro itself adds a `compound` entry, and the automatic compound pass
  after ship promotes recurring entries into first-class
  rules/protocols/skills (base threshold from
  `compound.recurrenceThreshold`, temporarily lowered to 2 for repositories
  with <5 archived runs, plus a critical-severity single-hit override) so
  the **next** run is easier. Strict JSONL schema keeps the whole thing
  machine-queryable.
- **Automatic integrity checks.** Runtime health is verified on every
  stage transition — no command you need to remember to run.

---

## TDD that actually runs

The `tdd` stage is not prose guidance. It requires:

- an explicit **RED** test run (logged to `.cclaw/state/stage-activity.jsonl`)
- a mandatory **`test-author`** subagent dispatch (logged to
  `.cclaw/state/delegation-log.json`)
- a **GREEN** full-suite run before exit
- optional **REFACTOR** pass with coverage preservation

`/cc-next` will not advance past `tdd` until the delegation log shows the
subagent as `completed` (or, on Codex / OpenCode, role-switched with
`evidenceRefs` — see [Harness support](#harness-support)).

---

## Ship and closeout — automatic, resumable

Shipping writes `08-ship.md`. `/cc-next` then automatically walks the
feature through a deterministic three-step closeout without extra
commands from you:

1. **Retro (`09-retro.md`).** cclaw drafts a retrospective from your
   stage artifacts, the delegation log, and the knowledge entries
   recorded during the run. It then asks exactly **one** structured
   question:
   - **accept** *(default)* — keep the draft, record one `compound`
     knowledge entry, advance.
   - **edit** — you edit `09-retro.md` in place, then `/cc-next` again.
   - **skip** — record a one-line reason, continue (archive will
     surface the skip in the run manifest).
2. **Compound pass.** If the knowledge store has clusters recurring 3+
   times, cclaw proposes concrete lifts into rules/protocols/skills and
   asks once: apply-all / apply-selected / skip. An empty pass advances
   silently.
3. **Archive.** Moves artifacts into `.cclaw/runs/YYYY-MM-DD-<slug>/`,
   snapshots `state/`, writes a manifest, and resets `flow-state.json`
   to the track's initial stage.

The chain is driven by `closeout.shipSubstate` inside `flow-state.json`
(`retro_review` → `compound_review` → `ready_to_archive` → `archived`).
If your session dies mid-closeout, a new `/cc-next` resumes at the
exact step — retro drafts are not regenerated and no structured ask is
repeated silently.

For the default path, `/cc-next` is the only command; explicit archival/reset remains available through `cclaw archive`.

---

## Harness support

cclaw is honest about what each harness can and cannot do, and it
closes every real gap with a documented fallback — not a silent waiver.

| Harness | Dispatch | Fallback | Hook surface | Structured ask |
|---|---|---|---|---|
| Claude Code | full (named subagents) | `native` | full | `AskUserQuestion` |
| Cursor | generic Task dispatcher | `generic-dispatch` | full | `AskQuestion` |
| OpenCode | plugin / in-session | `role-switch` | plugin | `question` (permission-gated; `permission.question: "allow"`) |
| OpenAI Codex | in-session only | `role-switch` (evidenceRefs required) | limited (Bash-only `PreToolUse`/`PostToolUse`; requires `codex_hooks` feature flag) | `request_user_input` (experimental; Plan / Collaboration mode) |

What the fallbacks mean:

- `native` — Claude runs mandatory delegations in isolated subagent
  workers; cclaw records them with `fulfillmentMode: "isolated"`.
- `generic-dispatch` — Cursor has a real Task tool with a fixed
  vocabulary of `subagent_type`s (`explore`, `generalPurpose`, …).
  cclaw maps each named agent (planner / reviewer / test-author /
  security-reviewer / doc-updater) onto the generic dispatcher with a
  structured role prompt.
- `role-switch` — OpenCode and Codex lack an isolated worker primitive.
  The agent announces the role in-session, performs the work, and
  records a delegation row with `fulfillmentMode: "role-switch"` and at
  least one `evidenceRef` pointing at the artifact section that
  captures the output. Under role-switch, a `completed` row **without**
  evidenceRefs is classified as `missingEvidence` by `cclaw doctor` and
  blocks stage completion.
- `waiver` — reserved. Only fires auto-waivers if every installed
  harness declares it. Currently unused — v0.33 removed the old
  Codex-only auto-waiver path.

> **Codex note (v0.40+).** Codex CLI deprecated custom prompts in v0.89
> (Jan 2026), but Codex ≥ v0.114 (Mar 2026) grew an experimental
> lifecycle hooks API. cclaw installs Codex entry points as native
> **skills** under `.agents/skills/cc*/SKILL.md` (invoke with `/use cc`,
> `/use cc-next`, `/use cc-view`, `/use cc-ideate`, or
> by typing `/cc …` in plain text — Codex auto-matches from the skill
> description) **and** writes `.codex/hooks.json` so session-start
> rehydration, stop-handoff, prompt-guard, workflow-guard, and
> context-monitor fire automatically — as long as you enable the
> `codex_hooks` feature flag in `~/.codex/config.toml`. `cclaw init
> --codex` asks for consent before patching that file. Codex's
> `PreToolUse`/`PostToolUse` are Bash-only; the stage skills compensate
> for `Write`/`Edit`/`MCP` tool calls with explicit in-turn checks. Run
> `cclaw doctor` to see the current state of hooks, the feature flag,
> and any legacy layout to clean up.

The full capability matrix lives in
[`docs/harnesses.md`](./docs/harnesses.md). Harness capability gaps are
reported by `cclaw doctor` instead of generating reference files into the
user project.

Runtime state stays small: `flow-state.json` is the source of truth, while
stage activity is an append-only trace for what happened during the run.
Derived diagnostics are produced on demand by `cclaw doctor`.

---

## CLI reference

The CLI is deliberately small. Everything operational happens inside
your harness.

```bash
npx cclaw-cli                   # launches interactive setup (or prints
                                # a one-line status hint if already installed)
npx cclaw-cli sync              # re-materialize generated runtime from config.yaml
npx cclaw-cli upgrade           # refresh generated files; preserves .cclaw/config.yaml
npx cclaw-cli archive           # archive current run and reset flow-state
npx cclaw-cli uninstall         # remove .cclaw + generated harness shims
npx cclaw-cli --version
```

For CI or scripted installs, `cclaw-cli init --harnesses=<list>
--no-interactive` is the non-interactive form. All other tunables
(prompt-guard strictness, TDD enforcement, language rule packs, track
heuristics) are set by editing `.cclaw/config.yaml` directly — see
[`docs/config.md`](./docs/config.md) for the full key reference.

---

## License

[MIT](./LICENSE)
