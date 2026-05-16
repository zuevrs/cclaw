---
name: flow-resume
trigger: /cc invoked with no task argument, OR with an argument while flow-state.json has currentSlug != null
---

# Skill: flow-resume

v8.61 — `/cc` invocations resolve through a deterministic dispatch matrix; the orchestrator never asks "resume or start?". This skill is a reference doc for the matrix; the canonical contract lives in the orchestrator body (`Detect — /cc invocation matrix (v8.61)`).

## When to use

Read this skill on every `/cc` / `/cc <task>` / `/cc-cancel` invocation. The skill body documents the matrix; the orchestrator dispatches per the matrix without an in-chat picker.

## When NOT to apply

- **Pre-v8 state files** (`schemaVersion < 2`). detect hard-stops on those with the migration prompt; resume never runs against unmigrated state.
- **Mid-stage tool output.** The resume decision is made at the orchestrator's turn boundary, not mid-dispatch.

## Detection

Read `.cclaw/state/flow-state.json`. A flow is **active** when `currentSlug != null`. (The finalize step resets `currentSlug` to `null` after moving artifacts to `flows/shipped/<slug>/`; a project that just finished a slug is back to no-active-flow.)

## /cc invocation matrix (v8.61; locked)

| Invocation | Active flow? | Behaviour |
| --- | --- | --- |
| `/cc` (no args) | yes | **Continue silently.** Jump back into the saved `currentStage`, dispatch the next specialist (or chain the next always-auto step). No picker, no resume summary. |
| `/cc` (no args) | no | Error in plain prose, in the user's language: `No active flow. Start with /cc <task>, /cc research <topic>, or /cc extend <slug> <task>.` End the turn. |
| `/cc <task>` | yes | Error in plain prose, in the user's language: `Active flow: <slug> (stage: <stage>). Continue with /cc. Cancel with /cc-cancel.` End the turn. Do NOT auto-cancel. Do NOT queue. |
| `/cc <task>` | no | **Start a new flow.** Run the Detect git-check, the extend-mode fork, and the research-mode fork in that order; if neither fires, dispatch the `triage` sub-agent. |
| `/cc research <topic>` | yes | Error (same shape as `/cc <task>` + active flow). End the turn. |
| `/cc research <topic>` | no | Start a research-mode flow. |
| `/cc extend <slug> <task>` | yes | Error (same shape as `/cc <task>` + active flow). End the turn. |
| `/cc extend <slug> <task>` | no | Start an extend-mode flow. |
| `/cc-cancel` | yes | Run the `/cc-cancel` runtime (move artifacts to `cancelled/<slug>/`, reset state). |
| `/cc-cancel` | no | Error in plain prose, in the user's language: `No active flow to cancel.` End the turn. |

## Plain-prose errors

The error messages above are **plain prose, in the user's language**. They are NOT structured asks; there is no option list, no "[y/n]" picker. The user re-invokes `/cc` or `/cc-cancel` from their command palette to recover. `<slug>`, `<stage>`, and command tokens (e.g. `/cc`, `/cc-cancel`) stay English (wire protocol); the surrounding sentence renders in the user's language.

## The `/cc` continue path is silent

When `/cc` (no args) lands on an active flow, the orchestrator continues silently — no announcement, no slim-summary regen, no "Resuming `<slug>`…" line. The user sees the next specialist's slim summary (or the chained stage's output) directly.

If the user wants context, they can:

- read `.cclaw/flows/<slug>/.continue-here.md` directly (the per-stage checkpoint);
- invoke `/cc-status` when the harness exposes it (not yet shipped; v8.62+ scope);
- read the most recent stage's artifact under `.cclaw/flows/<slug>/`.

## Resume rules

1. **Triage is fully immutable in v8.61.** A resumed flow keeps its `ceremonyMode`, `complexity`, `path`, `runMode`, and `mode`. The user does not re-pick. If they want to change any, the answer is "/cc-cancel and start fresh". v8.61 retired the v8.34 mid-flight `runMode` toggle — both `--mode=auto` and `--mode=step` are honoured for back-compat but collapse to `auto` (no behaviour change).
2. **Last-specialist context is restored** by reading `flows/<slug>/<stage>.md`. The orchestrator does not summarise from memory; it re-reads the artifact when it needs context.
3. **Time gate.** If `flow-state.json > startedAt` is >7 days ago, the orchestrator may surface a one-line warning ("flow is stale — verify scope still applies") on the next chained stage's slim summary; never block resume.
4. **Sub-agent dispatch resumes from the same stage.** A build that was paused mid-RED for AC-3 resumes by dispatching slice-builder for AC-3, not by restarting AC-1.
5. **Resume after a stop-and-report status block.** When the previous turn ended with a stop-and-report status block (per `runbooks/always-auto-failure-handling.md`), `/cc` continues from the saved `currentStage`. For build-failure / reviewer-fix stops, the auto-fix iteration counter is **preserved**.

## v8.61 retirement of the mid-flight runMode toggle

The v8.34 `/cc --mode=auto` / `/cc --mode=step` toggle is preserved on the parser surface for back-compat (so harness namespace routers that forward the flag don't error), but v8.61 collapsed both values to `auto`. `--mode=step` emits a one-line `step-mode retired in v8.61; flow runs auto` note and otherwise behaves as if the flag were absent. The toggle does not consume task text — `/cc --mode=auto refactor the auth module` is still parsed as `/cc refactor the auth module`.

## Common pitfalls

- Ignoring `flow-state.json` and starting fresh on every `/cc` invocation. The state file IS the resume point — re-prompting the user when a flow is already in progress is a contract violation.
- Re-running the triage sub-agent on resume. The user already triaged; the saved decision is immutable.
- Re-prompting the user for the slug ("which task?") when `currentSlug` is set. Read it from state.
- Treating `/cc` with no argument as an error. It is the canonical resume command — `/cc` advances any active flow.
- Offering `Cancel` as an option in any in-chat ask. `/cc-cancel` is a separate explicit user-typed command; the matrix surfaces it only as plain prose inside the stop-and-report status block.
- Auto-cancelling the active flow when `/cc <task>` lands. NEVER. The matrix errors out and asks the user to choose `/cc` (continue) or `/cc-cancel` (discard); the orchestrator does not pick for them.

## Worked example (schema; render in the user's language)

```
> /cc

[orchestrator silently continues the active flow; next slim summary appears here]
```

vs.

```
> /cc add a new feature

Active flow: 20260515-auth-cleanup (stage: review). Continue with /cc. Cancel with /cc-cancel.
```

vs.

```
> /cc

No active flow. Start with /cc <task>, /cc research <topic>, or /cc extend <slug> <task>.
```
