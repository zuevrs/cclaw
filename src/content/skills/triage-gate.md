---
name: triage-gate
trigger: at the start of every new /cc invocation, before any specialist runs
---

# Skill: triage-gate

Every new flow opens with a **triage gate**. v8.58 reshapes the gate from a heavy classification step into a **lightweight router**. The router decides only complexity, ceremonyMode, path, runMode, and mode; the heavy work that used to live here — surface detection, assumption capture, prior-learnings lookup, interpretation forks — moved into the specialist that already has the codebase context to do it (design Phase 0-2 on strict; ac-author Phase 0-1 on soft; nothing on inline).

The default behaviour is **zero questions**. The orchestrator announces what it decided in one short line and proceeds straight to the dispatch (or, on inline, straight to the edit). Three explicit override flags — `/cc --inline` / `/cc --soft` / `/cc --strict` — short-circuit the heuristic when the user wants a different ceremony than the heuristic would pick.

## When this skill applies

- Always at the start of `/cc <task>` when no active flow exists AND the task argument does NOT start with the v8.58 research-mode token (`research `) or carry the `--research` flag — research flows skip the router entirely (see `/cc.md > Detect — research-mode fork`).
- Skipped on `/cc` (no argument) when an active flow is detected — see `flow-resume.md`.
- Skipped on `/cc-cancel` and `/cc-idea` (these never open a flow).
- Skipped on `/cc research <topic>` and `/cc --research <topic>` — these dispatch design in standalone mode with a sentinel triage block; the router runs no heuristics.

## When NOT to apply

- **Active flow detected** (`flow-state.json > currentSlug != null`). The saved triage is read as ground truth; `flow-resume.md` runs instead and the router does NOT re-prompt.
- **`/cc-cancel`** (shelves the active flow) and **`/cc-idea`** (one-shot idea capture). Neither opens a flow.
- **Research-mode entry point** (`/cc research <topic>` / `/cc --research <topic>`). The Detect step's research fork stamps a sentinel triage block (`mode: "research"`, `complexity: "large-risky"`, `ceremonyMode: "strict"`, `path: ["plan"]`, `runMode: null`) and dispatches design standalone; the router runs no heuristics.
- **Resume from a pre-v8.58 flow with populated `triage` already on disk.** The orchestrator reads the saved triage (including pre-v8.58 fields like `triage.surfaces` / `triage.priorLearnings` / `triage.assumptions`); the router is not re-opened mid-flow.

## v8.58 routing contract

The router stamps exactly five fields on `flow-state.json > triage`:

1. **`complexity`** — heuristic-driven: `trivial` / `small-medium` / `large-risky` (see §"Heuristics — how to pick" below).
2. **`ceremonyMode`** — mapped from complexity: `trivial → inline`, `small-medium → soft`, `large-risky → strict`. Override flags pin this directly.
3. **`path`** — `["build"]` for inline; `["plan", "build", "review", "critic", "ship"]` for soft + strict. The v8.52 `"qa"` insertion happens later, at the design Phase 2 / ac-author Phase 1 surface-write step; not at this router hop.
4. **`runMode`** — `null` on inline (no stages to chain); `"step"` (default) or `"auto"` on soft + strict (from `--mode=` or the default).
5. **`mode`** — `"task"` for every `/cc <task>` entry. `"research"` is stamped only by the Detect research-mode fork; never by this router.

The router does NOT decide (v8.58 — moved out):

- **`surfaces`** — moved to design Phase 2 (strict) / ac-author Phase 1 (soft) / not-written (inline). The v8.52 qa-runner gate reads `triage.surfaces` literally; only the WRITER moved.
- **`assumptions`** — moved to design Phase 0 (strict) / ac-author Phase 0 (soft) / not-captured (inline).
- **`priorLearnings`** — moved to design Phase 1 / Phase 4 (strict) / ac-author Phase 3's `learnings-research` dispatch (soft) / not-queried (inline).
- **`interpretationForks`** — moved to design Phase 1 (strict) / ac-author Phase 0 (soft) / not-surfaced (inline).
- **`criticOverride`** — relocated to the v8.44 `.cclaw/state/triage-audit.jsonl` audit log surface.
- **`notes`** — narrative context lives in `plan.md` / `research.md`.

Pre-v8.58 state files that already carry the moved fields are read verbatim by specialists on resume (back-compat). The fields stay on the `TriageDecision` type as optional `@deprecated v8.58` properties for one release; slated for removal in v8.59+.

## Zero-question fast path (v8.58 — the only path on `/cc <task>` without an override flag)

In every case where no override flag is present, the router runs the heuristic and proceeds without asking:

1. Run the §"Heuristics" classification to pick complexity / ceremonyMode / path.
2. Pick `runMode` from `--mode=` (if present) or the default (`step` on soft + strict, `null` on inline).
3. Stamp `mode: "task"`.
4. Build the slug (`YYYYMMDD-<semantic-kebab>`).
5. Patch `flow-state.json > triage` with the five fields + `rationale` + `decidedAt`.
6. Append one line to `.cclaw/state/triage-audit.jsonl` with `autoExecuted: true` (the v8.58 default) and `userOverrode: false` (unless an override flag fired).
7. Emit a one-line announcement in the user's language, e.g.:

```
─ small-medium / soft / plan → build → review → critic → ship  ·  runMode=step  ·  slug=20260515-status-pill
```

Mechanical tokens (`small-medium` / `soft` / stage names / `runMode` / `slug`) stay English; descriptive prose around them is in the user's language. The user is NOT asked anything at this hop; there is no structured ask. Proceed straight to the first dispatch.

## Override flags (v8.58)

Three flags short-circuit the heuristic; each maps directly to a ceremonyMode:

| Flag | Effect |
| --- | --- |
| `/cc --inline <task>` | `complexity: "trivial"`, `ceremonyMode: "inline"`, `path: ["build"]`, `runMode: null`, `mode: "task"`. Stamp `rationale: "user override: --inline"`. |
| `/cc --soft <task>` | `ceremonyMode: "soft"`, `path: ["plan", "build", "review", "critic", "ship"]`, `runMode: "step"` (or `--mode=`'s value), `mode: "task"`. `complexity` = heuristic's value. Append `+ user override: --soft` to rationale. |
| `/cc --strict <task>` | `ceremonyMode: "strict"`, `path: ["plan", "build", "review", "critic", "ship"]`, `runMode: "step"` (or `--mode=`'s value), `mode: "task"`. `complexity: "large-risky"`. Append `+ user override: --strict` to rationale. |

Flag parsing rules:

- The flags do NOT consume the task text — `/cc --strict refactor the auth module` parses as "strict ceremonyMode + task = refactor the auth module".
- The flags are **mutually exclusive**. `/cc --inline --soft <task>` surfaces a one-line note (`mutually exclusive ceremonyMode flags; using the last one (--soft)`) and proceeds with the last flag.
- A flag value that does not match (`--ceremony=fast`) is ignored with a one-line `unknown ceremonyMode flag, ignored` note; the router falls back to the zero-question path.
- The v8.34 `--mode=auto` / `--mode=step` runMode toggle is **orthogonal** to the ceremonyMode flags. `/cc --strict --mode=auto <task>` is valid and stamps `ceremonyMode: "strict"` + `runMode: "auto"` in one triage write.
- The audit log records `userOverrode: true` whenever the chosen ceremonyMode differs from the heuristic's recommendation.

## Legacy v8.14-v8.57 combined-form ask (REMOVED in v8.58)

v8.14 introduced a combined-form structured ask (two questions in one form: path + runMode). v8.58 **removes** the combined form entirely — the router is zero-question by default, override flags handle the explicit-choice case, and there is no fallback to the legacy form. Harness fallback prose for the legacy form has been deleted from this skill; if your project depends on the v8.14-v8.57 combined-form gate, pin to cclaw v8.57 or use the `--strict` / `--soft` / `--inline` flags to express intent.

## Heuristics — how to pick

Rank the request against these signals. The router picks the **highest** complexity any signal triggers (escalation is one-way).

| Signal | Pushes toward |
| --- | --- |
| typo, rename, comment, single-file format change, ≤30 lines, no test impact | trivial / inline |
| 1-3 modules, ≤5 testable behaviours, no auth/payment/data-layer touch, no migration | small/medium / soft |
| ≥4 modules touched OR ≥6 distinct behaviours OR architectural decision needed OR migration required OR auth/payment/data-layer touch OR explicit security flag | large-risky / strict (plan stage expands into discovery sub-phase) |
| user explicitly asked for "discuss first" / "design only" / "what do you think" | large-risky (forces discovery sub-phase under plan) |
| user explicitly asked for "just fix it" on a single file | trivial / inline |
| **user prompt is vague** ("make it better", "fix bugs", "add some auth") | always escalate one class from heuristic baseline; design Phase 1 (Clarify) or ac-author Phase 0 (assumption check) then asks the user to specify mid-flight |

The "highest wins" rule is intentional. Agents underestimate scope more often than they overestimate; if any signal says large-risky, route to large-risky.

v8.58 note: prior versions surfaced a confidence dimension (`high` / `medium` / `low`) and used it to gate the structured-ask path. v8.58 routes zero-question regardless of confidence; vague prompts escalate one class (so design Phase 1 / ac-author Phase 0 picks up the clarification surface), but the user is never interrupted at the router. The confidence dimension lives only inside the rationale string now (`rationale: "small-medium (medium confidence): 3 modules, ~150 LOC"`), not as a separate field.

## What the orchestrator records

After the heuristic runs (or an override flag fires), patch `.cclaw/state/flow-state.json`:

```json
{
  "triage": {
    "complexity": "small-medium",
    "ceremonyMode": "soft",
    "path": ["plan", "build", "review", "critic", "ship"],
    "mode": "task",
    "rationale": "3 modules, ~150 LOC, no auth touch.",
    "decidedAt": "2026-05-08T12:34:56Z",
    "runMode": "step"
  }
}
```

`runMode` is `step` by default on non-inline paths; `auto` when the user explicitly passed `--mode=auto`; `null` on inline / trivial paths (no stages to chain). `mode` is `"task"` for every `/cc <task>` entry; pre-v8.58 state files lack the field and readers default to `"task"`.

The `userOverrode` and `autoExecuted` bits (write-only telemetry) live in the v8.44 audit log at `.cclaw/state/triage-audit.jsonl`, NOT on the triage object — append the audit-log entry immediately after persisting the triage write.

The triage block is **immutable for the lifetime of the flow** — with one v8.34 exception. `complexity` / `ceremonyMode` / `path` / `mode` cannot change mid-flight; if the user wants to escalate (e.g. discovers it is bigger than thought), `/cc-cancel` and start a fresh flow with new triage. `runMode` is the **single mutable field**: the user passes `/cc --mode=auto` or `/cc --mode=step` to flip mid-flight (`flow-resume.md > Mid-flight runMode toggle` carries the full mechanics). The inline path rejects the toggle (no stages to chain).

## Path semantics

| path value | what runs | when |
| --- | --- | --- |
| `["build"]` (inline trivial) | direct edit + commit, no plan, no review | `complexity == "trivial"` OR `--inline` flag |
| `["plan", "build", "review", "critic", "ship"]` (small/medium) | one ac-author sub-agent for plan; one slice-builder for build; one reviewer for review; critic; ship fan-out | `complexity == "small-medium"` OR `--soft` flag |
| `["plan", "build", "review", "critic", "ship"]` (large-risky) | **plan stage expands** into design (main context, multi-turn) → ac-author; build/review/critic/ship behave as small/medium plus parallel-build fan-out and adversarial pre-mortem when applicable | `complexity == "large-risky"` OR `--strict` flag |

`triage.path` at the router hop holds the canonical four-or-five stages: `plan`, `build`, `review`, `critic`, `ship`. **`discovery` is never an entry in `path`.** **The `"qa"` stage is NOT inserted at this router hop in v8.58** — the v8.52 qa-stage insertion moved to the design Phase 2 / ac-author Phase 1 surface-write step (which has the codebase context to detect UI / web surfaces). When that write detects UI / web surfaces and `ceremonyMode != "inline"`, the same write rewrites `triage.path` to insert `"qa"` between `"build"` and `"review"`. The qa-runner gate continues to read the rewritten path; only the writer moved.

The path-validation rule is: `triage.path` ⊆ `{plan, build, qa, review, critic, ship}`. Any state file that contains a `"discovery"` entry is from an older schema and must be normalised — strip the `"discovery"` entry and continue with the remaining stages.

## No-git auto-downgrade (v8.23)

Before the router patches `flow-state.json`, the Detect step runs the git-check: does `<projectRoot>/.git/` exist? If not, the router **auto-downgrades** `ceremonyMode` from whatever the heuristic recommended (or whatever override flag the user passed) to `soft`, regardless of complexity class, and records the audit-trail field:

```json
{
  "triage": {
    "complexity": "large-risky",
    "ceremonyMode": "soft",
    "downgradeReason": "no-git",
    "rationale": "..."
  }
}
```

The downgrade is structural, not stylistic:

- **strict mode requires per-criterion commits.** Without `.git/`, there is no SHA chain for the reviewer to grep via `git log --grep="(AC-N):"`. The downgrade to soft is structural; treating it as advisory crashes on the first commit attempt.
- **parallel-build relies on `git worktree`.** Soft mode falls back to sequential slice dispatch when `triage.downgradeReason == "no-git"`.
- **Inline path's terminal `git commit`** is gracefully suppressed — the orchestrator surfaces "no-git: change applied, no commit recorded" instead of crashing.

Surface the downgrade as a one-sentence warning at the router announcement, in the user's conversation language. The downgrade is **one-way for the lifetime of the flow**. The `--strict` / `--soft` / `--inline` override flags do not bypass the no-git auto-downgrade — even `/cc --strict <task>` in a no-git project lands on `ceremonyMode: "soft"` with `downgradeReason: "no-git"`.

## When to skip the gate

The gate is **never skipped silently**. v8.58 supports three explicit skip forms:

1. **Override flag** — `/cc --inline <task>` / `/cc --soft <task>` / `/cc --strict <task>` short-circuit the heuristic; the chosen ceremonyMode is stamped verbatim and the audit log records `userOverrode: true` whenever the choice differs from the heuristic.
2. **Active flow** — `flow-resume.md` resumes the saved triage; the router does not re-prompt.
3. **Research-mode entry point** — `/cc research <topic>` / `/cc --research <topic>` stamp a sentinel triage and dispatch design standalone; the router runs no heuristics.

v8.57 supported `--triage=trivial` / `--triage=small-medium` / `--triage=large-risky` and `--no-triage`. v8.58 removes these flags in favour of `--inline` / `--soft` / `--strict` (more explicit about the ceremonyMode choice). Pre-v8.58 invocations with `--triage=` flags are treated as unknown arguments (one-line `unknown flag, ignored` note) and fall back to the zero-question path.

## Worked examples

### Trivial — zero-question (default)

User: `/cc Rename getCwd to getCurrentWorkingDirectory across the repo.`

The router emits one line and proceeds:

```
─ trivial / inline / inline edit  ·  runMode=null  ·  slug=20260515-rename-getcwd
```

Then dispatches the inline edit + commit and stops. The v8.44 audit-log line records `autoExecuted: true`.

### Small/medium — zero-question (default)

User: `/cc Add a status pill to the approvals dashboard.`

```
─ small-medium / soft / plan → build → review → critic → ship  ·  runMode=step  ·  slug=20260515-status-pill
```

Then dispatches ac-author Phase 0 (assumption capture happens inside the specialist, not at the router).

### Large-risky — zero-question (default)

User: `/cc Migrate the user store from Postgres to DynamoDB.`

```
─ large-risky / strict / design → plan → build → review → critic → ship  ·  runMode=step  ·  slug=20260515-user-store-migration
```

Then dispatches design Phase 0 (assumption capture, surface detection, prior-learnings lookup all happen inside design, not at the router).

### Override flag — explicit choice

User: `/cc --strict Clean up the auth helper.`

```
─ large-risky / strict / design → plan → build → review → critic → ship  ·  runMode=step  ·  slug=20260515-auth-helper-cleanup
```

Heuristic would have picked `small-medium / soft` (single helper file, ~80 LOC), but the user pinned `--strict`. The audit log records `userOverrode: true`. Then dispatches design Phase 0.

### Vague prompt — escalate one class

User: `/cc Make auth less broken.`

Heuristic baseline: `small-medium`. Vague-prompt rule escalates one class:

```
─ large-risky / strict / design → plan → build → review → critic → ship  ·  runMode=step  ·  slug=20260515-auth-improvements
```

Then dispatches design; Phase 1 (Clarify) asks the user to specify which auth surface is broken (interpretation forks live in design now, not at the router).

## Common rationalizations

**Cross-cutting rationalizations:** the canonical completion / verification / commit-discipline rows live in `.cclaw/lib/anti-rationalizations.md` (v8.49). The rows below stay here because they cover triage-specific framings ("obviously trivial — skip the router", "just fix it" cue handling, mid-flight runMode toggle, large-risky padding, no-git auto-downgrade, research-mode-as-ceremonyMode confusion).

| rationalization | truth |
| --- | --- |
| "This is obviously trivial — skip the router entirely." | v8.58's router is zero-question by default; there is no separate skip. The router runs the heuristic and announces in one line, whether or not the result is trivial. |
| "User said 'just fix it' — go straight to inline." | "just fix it" is a heuristic signal but not a free pass. The router still checks file count / LOC / sensitive surface; if any signal says large-risky, route to large-risky. The user can pass `--inline` if they want to override. |
| "Vague prompt — let me ask a clarifying question at the router." | The router does not ask. Vague prompts escalate one class so design Phase 1 (or ac-author Phase 0) picks up the clarification surface inside the specialist, not at the router. |
| "Let me render the legacy v8.14 combined-form ask to be safe." | v8.58 removed the combined-form ask. The router is zero-question + override flags only; do not synthesize a structured ask at this hop. |
| "Mid-flight the user wants to switch from step to auto — let me patch `triage.runMode`." | v8.34 lifts immutability for `runMode` only: the user passes `/cc --mode=auto` and the orchestrator patches `triage.runMode`. `complexity` / `ceremonyMode` / `path` / `mode` stay immutable — those require `/cc-cancel` + fresh `/cc`. Inline path rejects the toggle. |
| "Mid-flight the user wants to switch from soft to strict — `/cc --strict` should re-triage." | v8.58 override flags ONLY work on a fresh `/cc <task>` (no active flow). On a resume, the `--strict` flag is ignored with a one-line `override flags only apply to fresh /cc; resume continues with saved ceremonyMode` note. |
| "`large-risky` to be safe on this one-file rename." | Don't pad the heuristic. The user reads it and learns to ignore your triage; padding undermines the gate's signal-to-noise. |
| "No-git auto-downgrade is a warning, not a hard rule." | Strict mode requires per-criterion commits — without `.git/`, there is no SHA to record. The downgrade is structural even with `--strict` override. |
| "Research mode is just another ceremonyMode — I should ask the user to pick it at the router." | Research is a separate ENTRY POINT (`/cc research <topic>`), not a ceremonyMode option. The router never offers research-mode as an alternative to task-mode; the user types `research ` as a prefix or passes `--research` to enter research mode. |

## Common pitfalls

- **Rendering a structured ask at the router.** v8.58's router is zero-question. If you find yourself about to invoke `AskUserQuestion` / `AskQuestion` / `prompt` / an "ask" content block at this hop, stop — the router is wrong.
- **Asking a clarifying question at the router because the prompt is vague.** Vague prompts escalate one complexity class; the clarification surface is owned by design Phase 1 (strict) or ac-author Phase 0 (soft), not the router.
- **Writing `triage.surfaces` / `triage.assumptions` / `triage.priorLearnings` / `triage.interpretationForks` at the router.** Those fields are populated by the specialist that consumes them. The router writes only `complexity` / `ceremonyMode` / `path` / `runMode` / `mode` / `rationale` / `decidedAt`.
- **Inserting `"qa"` into `triage.path` at the router.** The v8.52 qa-stage insertion moved to the design Phase 2 / ac-author Phase 1 surface-write step. The router writes `["plan", "build", "review", "critic", "ship"]` (or `["build"]` on inline); the specialist rewrites to insert `"qa"` when UI / web surfaces are detected.
- **Synthesizing a combined-form ask from the v8.14-v8.57 prose.** The combined form is removed in v8.58; do not reach for it as a fallback.
- **Confusing the v8.58 ceremonyMode flags (`--inline` / `--soft` / `--strict`) with the v8.34 runMode flags (`--mode=auto` / `--mode=step`).** They are orthogonal — a single `/cc` can carry both (`/cc --strict --mode=auto <task>` is valid).
- **Re-running the router on resume.** Resume reads the saved triage and continues from `currentStage`; never re-runs the router.
- **Treating `/cc research <topic>` as a task.** The Detect step's research-mode fork is the entry point for research flows; the router is skipped entirely. If you find the router running on a `research ` prefix, the fork failed.

## Next step

After the router announces (or after an override flag fires), the orchestrator dispatches the first specialist directly. The assumption surface, surface detection, and prior-learnings lookup all live inside the first specialist's first turn — design Phase 0-2 on strict, ac-author Phase 0-1 on soft, none on inline. `triage.assumptions` / `triage.surfaces` / `triage.priorLearnings` are first-class fields on `flow-state.json` and continue to be populated (just by the specialist, not by the orchestrator). On the inline path, the orchestrator goes straight to the build dispatch — there is no assumption surface (a one-line edit has no assumptions worth surfacing).
