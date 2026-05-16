# cclaw

**A multi-stage planning + review harness for coding agents.**

cclaw drops a `/cc` slash command into Claude Code, Cursor, OpenCode, or Codex. It routes the task, picks the right amount of ceremony, and runs the work through a fixed pipeline: route → plan → build → qa → review → critic → ship. Each stage emits a slim summary back to the harness and writes a tracked artifact under `.cclaw/flows/<slug>/`. Sub-agents are isolated; the orchestrator keeps the slug's history.

cclaw installs `/cc` and `/cc-cancel` into each harness. Inside `/cc`, three entry modes cover task work, research, and continuation flows — see [When to use which command](#when-to-use-which-command) and [Modes](#modes).

## Why cclaw

- **Pipeline, not autopilot, but no friction either.** v8.61 — the flow runs end-to-end without approval pickers at plan / review / critic gates (always-auto). Hard failures stop and report with a clear status block; the user resumes with `/cc` (continue) or `/cc-cancel` (discard). See [Failure handling](#failure-handling-v861-always-auto) below.
- **Two-model review.** A read-only reviewer walks ten axes; an adversarial critic falsifies what the reviewer cleared. They share no context and write to separate artifacts (`review.md`, `critic.md`).
- **Right-sized ceremony.** Trivial edits run inline (one commit, no plan). Small/medium tasks get a soft-mode plan and a single TDD cycle. Large-risky tasks get a full per-criterion build with a pre-implementation plan-critic gate.
- **Unified flow shape (v8.62).** One pipeline for every task: triage → architect → builder → reviewer → critic → ship. Plan-stage depth scales with `ceremonyMode` (lite for soft, rich for strict) instead of branching to a different specialist stack. Three flow paths collapsed into one.
- **Lightweight router as a sub-agent.** v8.61 — triage moved from the main orchestrator context to a dedicated `triage` specialist (one of seven sub-agents). The router is still zero-question by default (no structured ask, no clarifying prompt). Explicit override flags (`/cc --inline <task>` / `/cc --soft <task>` / `/cc --strict <task>`) short-circuit the heuristic when you want to pin a ceremony level. Classification work (surface detection, assumption capture, prior-learnings, interpretation forks) moved into the specialist that already has the codebase context — the `architect`'s Bootstrap + Frame phases on strict and soft.
- **Research mode.** `/cc research <topic>` is a separate entry point for pre-task uncertainty: brainstorming, scope exploration, architecture comparison. Runs the `architect` specialist standalone (Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose), emits a `research.md` synthesis artifact, and stops. Optional handoff into a follow-up `/cc <clarified task>` flow that consumes the research as `priorResearch` context.
- **Continuation flow.** `/cc extend <slug> <task>` loads a previously-shipped slug as parent context for iterative work that explicitly builds on a previously-shipped slug. Loads the parent's `plan.md` / `build.md` / `learnings.md` (and `review.md` / `critic.md` / `qa.md` when present) into `flowState.parentContext`. Triage inherits `ceremonyMode` / `surfaces` from the parent under v8.61 always-auto (legacy `runMode` parents fold to `auto`; explicit `--strict` / `--soft` / `--inline` flags still override). The new flow's `plan.md` carries a `## Extends` section authored by the `architect` (Bootstrap → parent-context linkage step) plus `parent_slug:` frontmatter that points back at the parent.
- **Same runtime, four harnesses.** Claude Code, Cursor, OpenCode, and Codex all read the same `.cclaw/` install. Each harness gets the same `/cc` body plus harness-namespaced ambient rules.
- **Compound learnings.** Non-trivial slugs emit a `learnings.md`. Future runs read prior shipped lessons through `knowledge.jsonl` before authoring a plan; outcome signals (`good` / `unknown` / `manual-fix` / `follow-up-bug` / `reverted`) down-weight priors that didn't hold up.

## When to use which command

| Intent | Command | What it does |
| --- | --- | --- |
| Execute a task end-to-end (code change) | `/cc <task>` | Full flow: triage → plan → build → review → critic → ship |
| Think / brainstorm / research a topic without committing to a task | `/cc research <topic>` | Standalone exploration; outputs `research.md`; optional handoff to `/cc <task>` |
| Extend a previously-shipped slug with related work | `/cc extend <slug> <task>` | New flow with parent's plan/build/learnings loaded as context |
| Cancel the active flow | `/cc-cancel` | Discards current `.cclaw/flows/<slug>/`, frees the orchestrator |

## Quickstart

```bash
cd /path/to/your/repo
npx cclaw-cli@latest

# Inside your harness:
/cc add caching to the search endpoint

# v8.61 — the flow runs always-auto: plan → build → review → critic → ship
# without approval pickers. cclaw stops only when a hard failure fires
# (build broken, reviewer can't converge in 3 fixes, critic block-ship,
# catastrophic git/dispatch failure). Resume with /cc; discard with
# /cc-cancel. See "If something goes wrong" below.
ls .cclaw/flows/20260515-search-caching/
# plan.md  build.md  review.md  critic.md  ship.md
```

For CI / scripted installs, use the non-interactive escape hatch:

```bash
npx cclaw-cli@latest --non-interactive install --harness=cursor
```

There is no `cclaw plan`, `cclaw build`, or `cclaw status`. Flow control lives inside `/cc`.

### `/cc` invocation matrix (v8.61)

| Invocation | Active flow? | Behaviour |
| --- | --- | --- |
| `/cc` (no args) | yes | Continue the active flow silently. No "resume?" picker. |
| `/cc` (no args) | no | Error: "No active flow. Start with `/cc <task>`, `/cc research <topic>`, or `/cc extend <slug> <task>`." |
| `/cc <task>` | yes | Error: "Active flow: `<slug>` (stage: `<stage>`). Continue with `/cc`. Cancel with `/cc-cancel`." cclaw does NOT auto-cancel or queue. |
| `/cc <task>` | no | Start a new flow (dispatch triage). |
| `/cc research <topic>` | yes / no | Same pattern — error when active, start when not. |
| `/cc extend <slug> <task>` | yes / no | Same pattern — error when active, start when not. |
| `/cc-cancel` | yes | Cancel active flow (move artifacts to `flows/cancelled/<slug>/`, reset state). |
| `/cc-cancel` | no | Error: "No active flow to cancel." |

### If something goes wrong

cclaw v8.61 runs always-auto, so the recovery loop is uniform:

1. cclaw stops at the first hard failure and writes a status block to chat naming the stage, the reason, and the recovery options.
2. You read the status block (the artifact under `.cclaw/flows/<slug>/` carries the full detail).
3. You decide: `/cc` to continue (after editing the diff / plan / review.md as needed), or `/cc-cancel` to discard the slug entirely.

There is no in-chat picker, no `[y/n]` ask, no "approve this?" gate. The status block is plain prose; recovery is always one of two typed commands.

## Modes

v8.59 ships three top-level entry points. All invocations use the same `/cc` slash-command surface; the orchestrator picks which mode to run based on the first token after `/cc`.

### `/cc <task>` — task mode (the historical default)

Runs the full route → plan → build → ship pipeline. v8.61 — the router moved to a `triage` sub-agent dispatch (Hop 2 of the orchestrator). It still picks `complexity` × `ceremonyMode` × `path` from heuristics and announces the choice in one line, then dispatches the first specialist. No clarifying questions; no structured ask. If you want to pin a ceremony level explicitly, pass one of:

```bash
/cc --inline <task>    # forces inline edit (one commit, no plan)
/cc --soft <task>      # forces soft-mode plan → build → review → ship
/cc --strict <task>    # forces strict + architect's full Frame → Compose pass + per-criterion commits + plan-critic gate
```

The flags are mutually exclusive. v8.61 retired the user-facing `--mode=auto` / `--mode=step` runMode toggle — both are accepted on the parser for back-compat but collapse to `auto` (the only behavioural mode in v8.61). When the project has no `.git/`, the router auto-downgrades strict → soft even with `--strict` (per-criterion commits need a SHA chain to be useful).

What used to live at the router — surface detection, assumption capture, prior-learnings lookup, interpretation forks — now lives inside the specialist that has the codebase context to do it well: the `architect`'s Bootstrap + Frame phases on strict + soft, nothing on inline. Pre-v8.58 state files continue to validate verbatim; readers default to `mode: "task"` when the field is absent.

### `/cc research <topic>` — research mode (v8.58 new entry point)

Runs the `architect` specialist in standalone activation mode — same phases as the intra-flow architect (Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose), but the artifact is `research.md` (not `plan.md`) and there is no AC table / Edge cases / Topology / Feasibility stamp. Output: `.cclaw/flows/<slug>/research.md`. No build / review / critic / ship. v8.62 — research mode finalises silently on architect return; v8.61 always-auto means there is no Phase 7 picker.

```bash
/cc research storage strategy for shared agent memory
/cc --research auth library trade-offs                 # equivalent
```

After research finalises, the orchestrator surfaces a plain-prose handoff:

> Ready to plan? Run `/cc <clarified task description>` and I'll carry the research forward as context.

The next `/cc <task>` invocation on the same project reads `flow-state.json > priorResearch` and consumes the most-recent shipped research as input to its plan stage (the architect's Bootstrap phase includes the research artifact in its reads). The handoff is optional — if research finalises and you never run a follow-up `/cc`, nothing else fires.

Research mode skips the router entirely. There is no triage gate; no `complexity` / `ceremonyMode` heuristic runs. The orchestrator stamps a sentinel triage block (`mode: "research"`, `ceremonyMode: "strict"`, `path: ["plan"]`) so downstream readers that assume `triage` is present continue to work.

### `/cc extend <slug> <task>` — continuation mode (v8.59 new entry point)

Initialises a new flow that explicitly **extends a previously-shipped slug**. The orchestrator loads the parent's `plan.md`, `build.md`, `learnings.md`, and (when present) `review.md` / `critic.md` / `qa.md` as `flowState.parentContext` and surfaces them to `architect` / `reviewer` / `critic` as load-bearing context. Things already settled by the parent are NOT re-decided in the new flow.

```bash
/cc extend 20260514-auth-flow add SAML login                   # canonical
/cc extend 20260514-auth-flow --strict refactor session store  # ceremony override wins over inheritance
/cc extend 20260514-cli-help fix typo in --help                # inheritance + always-auto
```

The orchestrator runs the same pipeline as a standard `/cc <task>` (plan → build → qa? → review → critic → ship); the only difference is at init:

- **Parent validation.** `loadParentContext(projectRoot, <slug>)` (`src/parent-context.ts`) confirms the slug is shipped + has a non-empty `plan.md`. Four failure modes are explicit: `in-flight` (slug still active), `cancelled` (under `flows/cancelled/`), `corrupted` (shipped but `plan.md` missing), `missing` (slug not found anywhere). Each surfaces a one-line error and ends the turn.
- **State stamp.** The new flow's `flow-state.json > parentContext` carries the parent's slug + status + shippedAt + structured artifact paths. Plan.md frontmatter carries `parent_slug: <parent>` (v8.59-native) plus `refines: <parent>` (back-compat with the knowledge-store chain, qa-runner skip rule, plan-critic skip gate, architect's Bootstrap brownfield path).
- **Triage inheritance.** The new flow's `ceremonyMode` / `surfaces` default to the parent's values. `runMode` is v8.61 always-auto regardless of the parent (legacy `step` parents fold to `auto`). Explicit `--strict` / `--soft` / `--inline` flags override the ceremonyMode inheritance. A security-keyword escalation heuristic (`security` / `auth` / `migration` / `schema` / `payment` / `gdpr` / `pci`) auto-escalates a soft/inline parent → strict for the new flow.
- **Specialist consumption.** The `architect`'s Bootstrap → Phase 0.5 (parent-context linkage) reads parent's `## Spec` / `## Decisions` / `## Selected Direction` and authors a mandatory `## Extends` section at the top of `plan.md` with parent slug + 1-line decision summary + clickable links to parent artifacts. `reviewer` runs a lightweight parent-contradictions cross-check (silent reversals of a parent D-N are `required` findings). `critic` §3 adds a skeptic question on parent decision contradictions.
- **Knowledge-store integration.** When `parentContext` is set, `findNearKnowledge` prepends the parent's `knowledge.jsonl` entry to the top of the prior-learnings result (load-bearing context overrides Jaccard ranking).

v8.59 loads the **immediate** parent only — multi-level chains (`grandparent → parent → child`) are not auto-walked. Specialists may use `findRefiningChain` on demand when transitive context is needed; multi-level auto-loading at orchestrator level is v8.60+ scope.

```mermaid
flowchart LR
    A[/cc input/] -->|"research <topic>" or --research| R[Research mode]
    A -->|"extend <slug> <task>"| E[Extend mode]
    A -->|"<task>"| T[Task mode]

    R --> D1[architect standalone<br/>Bootstrap → Compose]
    D1 --> RM["research.md"]
    RM --> H{Handoff?}
    H -->|"accept research"| END[Finalize]
    H -->|next /cc| T

    E --> LC[loadParentContext<br/>shipped + plan.md required]
    LC -->|ok| EI[Stamp parentContext<br/>+ refines + parent_slug]
    EI --> EHE[Triage inheritance<br/>ceremonyMode/surfaces<br/>runMode = auto v8.61]
    EHE --> T
    LC -->|in-flight/cancelled<br/>/missing/corrupted| EERR[Surface error<br/>end turn]

    T --> RT[Router<br/>complexity × ceremonyMode × path]
    RT -->|inline| INL[Build inline]
    RT -->|soft| PL[architect Bootstrap+Frame<br/>surfaces, assumptions, priorLearnings via learnings-research]
    RT -->|strict| DS[architect full ceremony<br/>Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose]
    PL --> BD[plan → build → review → critic → ship<br/>specialists read parentContext]
    DS --> BD
```

## Worked example

You type:

```text
/cc add caching to the search endpoint
```

The orchestrator runs through these stages in order, chaining automatically (v8.61 always-auto). The slim-summary blocks the orchestrator emits sit under `## Triage`, `## Plan`, `## Build`, `## QA`, `## Review`, `## Critic`, `## Ship` section headers in chat. Artifacts land on disk.

- **Triage (v8.61 sub-agent).** The orchestrator dispatches the `triage` specialist with the raw `/cc` argument. Triage returns a 5-field decision in one slim summary — complexity: small-medium · ceremony mode: soft · path: plan → build → review → critic → ship · runMode: auto · mode: task. Slug: `20260515-search-caching`. Zero clarifying asks. The decision is persisted to `flow-state.json > triage` and is immutable for the slug. (v8.58 — surface detection / assumption capture / prior-learnings lookup moved into the architect's Bootstrap + Frame phases on every non-inline path; v8.61 — the triage routing prose moved out of the orchestrator body into `triage.md`.)
- **Plan.** The `architect` writes `plan.md` silently — Spec section (Objective / Success / Out of scope / Boundaries), Frame, **Plan / Slices** (SL-N work units — HOW we build), **Acceptance Criteria (verification)** (AC-N verification rows back-referencing slices via the `Verifies` column — HOW we prove done), Edge cases, Topology, Feasibility stamp, Traceability block. 4 slices, 3 AC, 2 prior lessons surfaced via the read-only `learnings-research` helper. Confidence: high. v8.62 — no mid-plan dialogue; if the architect's pick turns out wrong the reviewer surfaces it at review time.
- **Build.** `builder` runs one TDD cycle **per slice**: RED → GREEN → REFACTOR. Each work commit carries an `SL-N` prefix (`red(SL-1):` / `green(SL-1):` / `refactor(SL-1):`) the reviewer reads via `git log --grep="(SL-N):"`. After all slices land, builder writes one `verify(AC-N): passing` commit per AC (empty diff when slice tests already cover the AC; test-files-only diff when the AC needs broader verification — perf budget, integration, contract). The reviewer cross-checks both chains. Tests: 14 passing (was 11). Coverage delta: +2.3%. Build failures trigger an auto-fix loop (up to 3 iterations); failure after 3 stops and reports.
- **Review.** Ten-axis reviewer opens 2 findings on the first iteration: cache-key collision on case-sensitive queries (`correctness`, `required`) and missing TTL refresh on stale entries (`architecture`, `consider`). Reviewer `critical` / `required-no-fix` triggers an auto-dispatch fix-only loop (up to 3 iterations); failure after 3 stops and reports. v8.62 — the reviewer's `security` axis absorbed the retired `security-reviewer` specialist's threat-model + sensitive-change coverage; on `security_flag: true` slugs the reviewer walks the threat-model checklist verbatim in a single dispatch.
- **Critic.** Adversarial falsificationist pass — predictions, gap analysis, Criterion check across AC + Edge cases + NFR rows, goal-backward verification, realist check. Verdict: pass. `block-ship` stops immediately (no auto-iteration — re-running on unchanged code returns the same verdict).
- **Ship.** All 3 AC committed. `ship.md` carries the release-notes draft and the AC↔commit map. Chains automatically to push under v8.61 always-auto.

After ship, the orchestrator moves the artifacts to `.cclaw/flows/shipped/<slug>/` and (when the slug earned capture) appends one row to `.cclaw/state/knowledge.jsonl`.

### Failure handling (v8.61 always-auto)

cclaw stops at hard failures per a fixed matrix. The recovery loop is always the same: read the status block, decide, type `/cc` (continue) or `/cc-cancel` (discard).

| Failure | Behaviour |
| --- | --- |
| Build failure | Auto-fix loop, up to 3 iterations. After 3 unresolved → stop and report. |
| Reviewer `critical` / `required-no-fix` | Auto-dispatch fix-only loop, up to 3 iterations. After 3 unresolved → stop and report. |
| Critic `block-ship` | Stop immediately and report. No auto-iteration. |
| Catastrophic (git op fail, dispatch fail, missing tool) | Stop and report. |
| `Confidence: low` from any specialist | Stop and report. The specialist's `Notes:` line is surfaced verbatim. |

The status block names the stage, the reason, and the recovery options. Example:

```
Stopped at review (iteration 3). Reason: reviewer returned 2 critical findings after fix-only loop hit the 3-iteration cap.
To proceed: /cc to continue (continues from the saved state), or /cc-cancel to discard the slug.
```

## What you get

| Surface | Count + detail |
| --- | --- |
| **Specialists** | 7 sub-agents: `triage` (on-demand routing dispatch at Hop 2 of every fresh `/cc <task>`; emits a 5-field slim summary the orchestrator parses), `architect` (the only plan-stage specialist; runs as a single on-demand dispatch on every non-inline path, covers Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose phases silently; switches to standalone research mode for `/cc research <topic>`; absorbs classification work — assumption capture, surface detection, prior-learnings dispatch, interpretation forks; v8.63 — authors both `## Plan / Slices` and `## Acceptance Criteria (verification)` tables), `builder` (per-slice RED → GREEN → REFACTOR cycles on strict with `<type>(SL-N):` prefixes plus one `verify(AC-N): passing` commit per AC after slices land; single-cycle on soft), `plan-critic` (pre-implementation gate, strict + complexity≠trivial + AC≥2; v8.63 — also checks slice-AC separation, slice quality, AC verifiability, coverage gaps), `qa-runner` (UI/web surfaces, ceremonyMode≠inline), `reviewer` (ten-axis review with both slice + AC traceability chains on v8.63 strict; on `security_flag: true` walks the threat-model checklist in the `security` axis verbatim — the v8.62 absorption of the retired `security-reviewer` specialist), `critic` (post-implementation adversarial pass with v8.63 §4b slice + AC coverage check). Each runs in isolation with a mandatory contract read. |
| **Research helpers** | `repo-research` (brownfield scan) and `learnings-research` (prior shipped lessons) dispatched in parallel before every plan. |
| **Ceremony modes** | `strict` (per-slice RED → GREEN → REFACTOR with `<type>(SL-N):` prefixes + per-AC `verify(AC-N): passing` commits — dual-chain reviewer cross-check), `soft` (single feature-level TDD cycle, plain commit), `inline` (one commit, no plan). Triage picks the mode; readers accept the legacy `acMode` key for one release. |
| **Plan template** | 15 sections (`Frame`, `Non-functional`, `Approaches`, `Selected Direction`, `Decisions`, `Pre-mortem`, `Not Doing`, `Plan`, `Spec`, `Plan / Slices` (SL-N work units — v8.63), `Acceptance Criteria (verification)` (AC-N verification rows referencing slices via `Verifies` — v8.63), `Feasibility stamp`, `Edge cases`, `Topology`, `Traceability block`) in strict mode; 6 sections (`Plan`, `Spec`, `Testable conditions`, `Verification`, `Touch surface`, `Notes`) in soft mode. v8.63 separates work-units (slices) from verification (AC); pre-v8.63 archived flows used a single `## Acceptance Criteria` table that conflated the two. |
| **Postures** | 6 per-criterion postures (`test-first`, `characterization-first`, `tests-as-deliverable`, `refactor-only`, `docs-only`, `bootstrap`). Each maps to a fixed commit-shape recipe the reviewer enforces ex-post. |
| **Review** | 10 reviewer axes — 8 base (`correctness`, `readability`, `architecture`, `security`, `perf`, `test-quality`, `complexity-budget`, `edit-discipline`) plus 2 gated (`qa-evidence` when qa-runner ran, `nfr-compliance` when `## Non-functional` is non-empty). Append-only findings table, convergence detector, severity-aware ship gate. |
| **Critic step** | Falsificationist pass after review clears: §1 predictions, §2 gap analysis, §3 four adversarial techniques + 6 human-perspective lenses (executor / stakeholder / skeptic for plan-stage, security / new-hire / ops for code-stage; adversarial mode only), §4 Criterion check (AC + Edge cases + NFR), §5 goal-backward, §6 realist check, §7 verdict, §8 summary. |
| **Auto-trigger skills** | 21 skills (`triage-gate`, `plan-authoring`, `tdd-and-verification`, `review-discipline`, `commit-hygiene`, `completion-discipline`, `pre-edit-investigation`, `qa-and-browser`, `debug-and-browser`, `ac-discipline`, `source-driven`, `summary-format`, `documentation-and-adrs`, `parallel-build`, `refinement`, `flow-resume`, `receiving-feedback`, `anti-slop`, `conversation-language`, `api-evolution`, `pre-flight-assumptions`). Auto-applied per stage, not user-invoked. |
| **On-demand runbooks** | 13 runbooks loaded by trigger (`dispatch-envelope`, `parallel-build`, `finalize`, `cap-reached-recovery`, `adversarial-rerun`, `handoff-gates`, `handoff-artifacts`, `compound-refresh`, `pause-resume`, `critic-steps`, `qa-stage`, `extend-mode`, `always-auto-failure-handling`). Kept out of the orchestrator body to hold the prompt budget. v8.61 added `always-auto-failure-handling` as the canonical failure-routing matrix. |
| **Anti-rationalization catalog** | v8.49 — `.cclaw/lib/anti-rationalizations.md` carries the cross-cutting rebuttal table (posture-bypass, completion-discipline, edit-discipline, verification rows). Each specialist's prompt cites the catalog and adds its own specialist-specific rows. |
| **Outcome signals** | v8.50 — 5-value enum (`good`, `unknown`, `manual-fix`, `follow-up-bug`, `reverted`) recorded on `knowledge.jsonl` rows. Three capture paths (orchestrator scans on every `/cc` for follow-up-bug references; compound time scans for revert commits and same-touch-surface manual-fix commits). Prior-learnings lookup multiplies similarity by signal weight before threshold filtering. |
| **Ambiguity score** | `plan.md` frontmatter still carries the three ambiguity fields (`ambiguity_score` / `ambiguity_dimensions` / `ambiguity_threshold`, default threshold `0.2`) for back-compat with the v8.53 brownfield gates; v8.62 retired the procedural authoring beat alongside the dead `design` specialist's Phase 7 picker. |
| **Discipline skills** | v8.48 — `completion-discipline` (no `✅ complete` without paired fresh evidence), `pre-edit-investigation` (three-probe gate before any edit), `receiving-feedback` (builder fix-only response protocol), plus the v8.48 `edit-discipline` reviewer axis. |
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
architect:
  ambiguity_threshold: 0.2          # v8.53 — ambiguity soft-warning threshold; v8.62 — surfaced via the architect's slim summary now that the design Phase 7 picker is gone
```

## Architecture deep dive

The runtime is under 1 KLOC. The prompt content is where the work lives. If you want to understand how `/cc` actually works, read the source — the on-disk reference lives under `src/content/`:

- [`src/content/start-command.ts`](src/content/start-command.ts) — orchestrator body (detect, dispatch, always-auto chain, critic step, ship, compound, finalize). v8.61 dropped the inline triage prose; the orchestrator dispatches the `triage` sub-agent at Hop 2.
- [`src/content/specialist-prompts/`](src/content/specialist-prompts/) — 7 specialist contracts (v8.62 collapsed `design` + `ac-author` → `architect`, renamed `slice-builder` → `builder`, absorbed `security-reviewer` into `reviewer.ts`'s `security` axis).
- [`src/content/skills/`](src/content/skills/) — 21 auto-trigger skill bodies.
- [`src/content/runbooks-on-demand.ts`](src/content/runbooks-on-demand.ts) — 13 on-demand runbooks the orchestrator opens by trigger (v8.61 added `always-auto-failure-handling`).
- [`src/content/artifact-templates.ts`](src/content/artifact-templates.ts) — plan / build / qa / review / critic / plan-critic / ship / learnings templates.
- [`src/content/anti-rationalizations.ts`](src/content/anti-rationalizations.ts) — cross-cutting rebuttal catalog (v8.49+).
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Artifact tree (after install)

```
.cclaw/
  config.yaml               flow defaults
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
      research.md           (v8.58+, /cc research <topic> only — architect standalone synthesis)
    shipped/<slug>/         finalized tasks (including research-mode flows)
    cancelled/<slug>/       /cc-cancel destination
  lib/
    agents/                 7 specialist contracts (v8.62 unified-flow roster: triage / architect / builder / plan-critic / qa-runner / reviewer / critic; plus 2 read-only research helpers: learnings-research / repo-research)
    skills/                 21 auto-trigger skill bodies
    templates/              artifact templates
    runbooks/               13 on-demand runbooks (v8.61 + always-auto-failure-handling.md)
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
