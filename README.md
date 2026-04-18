# cclaw

**Install once, ship every time.** cclaw is an installer-first workflow
runtime that gives your AI coding agent one inspectable path from idea to
shipped PR:

> **brainstorm → scope → design → spec → plan → tdd → review → ship**

Every stage has real gates the agent cannot skip, every decision leaves a
file-backed audit trail, and the same six slash commands work across
Claude Code, Cursor, OpenCode, and OpenAI Codex.

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
- Maintainers of AI agents/skills who want **measurable prompt engineering**
  via the built-in eval harness.

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
      │
      └──── gates + subagents + knowledge capture happen at every step
```

Every stage reads and writes real files under `.cclaw/`. `flow-state.json`
holds the single source of truth for "where are we"; `knowledge.jsonl`
accumulates reusable lessons **throughout** the flow, not only at the end;
stage artifacts live under `.cclaw/artifacts/` until the feature is
archived.

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
   artifacts written, checkpoint saved
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

That's the entire CLI interaction. Everything after install happens
inside your harness (Claude Code, Cursor, OpenCode, or Codex).

### What gets generated

```text
.cclaw/
├── commands/           # stage + utility command contracts (markdown)
├── skills/             # stage + utility skills loaded by the harness
├── contexts/           # cross-cutting context modes (research, debugging, …)
├── templates/          # artifact skeletons for each stage
├── rules/              # lint-style rules surfaced to the agent
├── adapters/           # per-harness translation notes
├── agents/             # subagent definitions (planner, reviewer, …)
├── hooks/              # harness-agnostic hook scripts
├── worktrees/          # isolated feature worktrees (power-user, via /cc-ops)
├── artifacts/          # active feature artifacts (00-idea.md → 09-retro.md)
├── runs/               # archived feature snapshots: YYYY-MM-DD-slug/
├── references/         # (optional) pinned copies of reference frameworks
├── evals/              # eval corpus, rubrics, baselines, reports
├── custom-skills/      # user-authored skills (never overwritten)
├── state/              # flow-state.json + delegation-log.json + activity
└── knowledge.jsonl     # append-only, strict-schema lessons + patterns
```

Plus harness-specific shims:

- `.claude/commands/cc*.md` + `.claude/hooks/hooks.json`
- `.cursor/commands/cc*.md` + `.cursor/hooks.json` + `.cursor/rules/cclaw-workflow.mdc`
- `.opencode/commands/cc*.md` + `.opencode/plugins/cclaw-plugin.mjs`
- `.codex/commands/cc*.md` + `.codex/hooks.json`
- `AGENTS.md` with a managed routing block

`.cclaw/config.yaml` holds every tunable key (prompt guard strictness,
TDD enforcement, git-hook guards, language rule packs, track heuristics).
Edit it directly — `cclaw-cli upgrade` preserves your changes. Full key
reference: [`docs/config.md`](./docs/config.md).

---

## The four commands you actually use

All four appear as slash commands in every supported harness. This is the
top-level user surface — everything else is either automatic or happens
inside `/cc-ops` subcommands.

| Command | What it does |
|---|---|
| **`/cc <idea>`** | Classify the task, discover origin docs (`docs/prd/**`, ADRs, root `PRD.md`, …), sniff the stack, recommend a track, then start the first stage of that track. `/cc` without arguments resumes the current flow. |
| **`/cc-next`** | The one progression primitive. Reads `flow-state.json`, checks gates + mandatory subagent delegations, and either resumes the current stage or advances to the next. `/cc-next` in a new session is how you **resume**. |
| **`/cc-ideate`** | Repository improvement discovery. Scans for TODOs, flaky tests, oversized modules, docs drift, and recurring knowledge-store lessons; returns a ranked backlog before you commit to a specific feature. |
| **`/cc-view`** | Read-only flow visibility. `/cc-view status` (default), `/cc-view tree`, `/cc-view diff` (baseline delta map). Never mutates state. |

> Power-user surface: `/cc-ops` is an operational router for manual
> overrides (rewind a stale stage, manage parallel features, re-run a
> compound pass). `/cc-learn` is the strict-schema knowledge writer —
> agents call it automatically from completion protocols; you rarely
> invoke it by hand.

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

## The eight stages, and the three tracks

cclaw has eight stages, but a single prompt rarely needs all of them.
`/cc` picks a **track** up front so the flow matches the task.

| Track | Path | Typical trigger |
|---|---|---|
| **quick** | `spec → tdd → review → ship` | `bug`, `hotfix`, `typo`, `rename`, `bump`, `docs only`, one-liners |
| **medium** | `brainstorm → spec → plan → tdd → review → ship` | `add endpoint`, `add field`, `extend existing`, `wire integration` |
| **standard** _(default)_ | all 8 stages | `new feature`, `refactor`, `migration`, `platform`, `schema`, `architecture` |

Each stage produces a dated artifact under `.cclaw/artifacts/`:
`00-idea.md` (seed) and `01-brainstorm.md` through `08-ship.md`
(plus `09-retro.md` at automatic closeout — see below).

### Track heuristics are configurable

Every team has its own vocabulary. Override the built-in trigger lists in
`.cclaw/config.yaml`:

```yaml
trackHeuristics:
  priority: [standard, medium, quick]
  fallback: standard
  tracks:
    quick:
      triggers: [hotfix, rollback, prod-incident]
      veto: [schema, migration]   # never route quick even if one trigger hits
    standard:
      patterns:
        - "^epic:"
        - "platform-team|core-infra"
```

`priority` + `veto` + regex `patterns` give you deterministic routing
without touching any code.

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
- **Extracted protocols.** Decision, Completion, and Ethos protocols live
  in a single place (`.cclaw/contexts/`), so every skill speaks the same
  dialect.
- **Knowledge capture throughout the flow.** Every stage completion
  protocol can emit entries to `knowledge.jsonl` — not only retro. Strict
  JSONL schema keeps it machine-queryable.
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
subagent as `completed` or explicitly `waived` (for harnesses without
native subagent dispatch, such as Codex — see
[Harness support](#harness-support)).

---

## Ship and closeout

Shipping writes `08-ship.md` and then closes out the feature through a
guided three-step sequence:

1. **Retro** drafts `09-retro.md` from flow artifacts and the delegation
   log; you review and accept.
2. **Compound pass** promotes repeated knowledge entries (frequency ≥ 2,
   maturity = stable) into first-class rules or skills.
3. **Archive** moves artifacts to `.cclaw/runs/YYYY-MM-DD-<slug>/` and
   resets `flow-state.json`.

Retro is not optional — archive is gated on retro completion so you can't
silently lose the learning pass.

> **Coming next:** cclaw will chain these three steps automatically from
> `ship` (one structured `edit`/`accept`/`skip` ask, resumable if the
> session ends). Tracked as the v0.32 closeout-automation wave.

---

## Harness support

cclaw is honest about which harnesses give you full automation and which
need small manual bridges. See
[`docs/harnesses.md`](./docs/harnesses.md) for the full matrix.

| Harness | Subagent dispatch | Hook surface | Structured ask | Status |
|---|---|---|---|---|
| Claude Code | native | full | `AskUserQuestion` | full parity |
| Cursor | partial | full | `AskQuestion` | parity gap: subagent dispatch |
| OpenCode | partial | plugin | plain-text | parity gap: plugin hooks |
| OpenAI Codex | none (waiver) | full | plain-text | parity gap: no subagent |

Capability gaps are captured in `.cclaw/state/harness-gaps.json`. Where
native dispatch is missing, cclaw emits a **structured waiver** rather
than pretending the delegation happened. Closing these gaps is an
ongoing kinetic effort — see the harness tracking doc above.

---

## Eval-driven prompt engineering

cclaw ships with `cclaw-cli eval` — a three-tier regression harness for
the skills and contracts the runtime generates. Use it when you change a
stage skill, tweak a prompt, or swap a model.

Works with any OpenAI-compatible endpoint — Zhipu AI GLM, OpenAI, Together,
self-hosted vLLM — via three environment variables:

```bash
CCLAW_EVAL_API_KEY=...
CCLAW_EVAL_BASE_URL=https://api.z.ai/api/coding/paas/v4   # default
CCLAW_EVAL_MODEL=glm-5.1                                  # default
```

Full details, corpus format, and the eval contract live in
[`docs/evals.md`](./docs/evals.md).

---

## CLI reference

The CLI is deliberately small. Everything operational happens inside
your harness.

```bash
npx cclaw-cli                   # launches interactive setup (or prints
                                # a one-line status hint if already installed)
npx cclaw-cli upgrade           # refresh generated files; preserves .cclaw/config.yaml
npx cclaw-cli uninstall         # remove .cclaw + generated harness shims
npx cclaw-cli eval …            # maintainer surface (see docs/evals.md)
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
