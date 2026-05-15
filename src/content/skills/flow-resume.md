---
name: flow-resume
trigger: /cc invoked with no task argument, OR with an argument while flow-state.json has currentSlug != null
---

# Skill: flow-resume

`/cc` without an argument means **"continue what we were doing"**. `/cc <task>` with an existing active flow means the user might either be resuming or starting a new branch — the orchestrator has to ask, never silently pick.

## When to use

Invoked on `/cc` with no task argument (the canonical resume gesture), and on `/cc <task>` when `flow-state.json > currentSlug` is non-null (collision case — show the resume summary alongside the new-task ask). Skipped on `/cc <task>` with an empty / null `currentSlug` (fresh start; `triage-gate.md` runs instead) and on `/cc-cancel` (no resume; just shelves the active flow).

## When NOT to apply

- **Fresh `/cc <task>` with `currentSlug == null`.** No flow to resume — `triage-gate.md` runs from a clean slate.
- **`/cc-cancel`.** The cancel verb shelves the active flow into `flows/cancelled/<slug>/` and resets `flow-state.json`; resume is structurally meaningless after.
- **`/cc-idea`.** Idea capture writes a single artifact and exits without touching `flow-state.json`; no resumable state is produced.
- **Mid-stage tool output.** Resume summarises *at* a stage boundary (the saved `currentStage` is canonical); rendering a resume summary mid-dispatch leaks half-finished work into the picker.
- **Pre-v8 state files** (`schemaVersion < 2`). detect hard-stops on those with the migration prompt; resume never runs against unmigrated state.

## Detection

Read `.cclaw/state/flow-state.json`:

- `currentSlug == null` AND no `/cc` argument → ask user "What do you want to work on?". This is just an empty start, not a resume.
- `currentSlug == null` AND `/cc <task>` argument → fresh start. Run `triage-gate.md`.
- `currentSlug != null` AND no `/cc` argument → **resume**. Render the resume summary and proceed.
- `currentSlug != null` AND `/cc <task>` argument → **collision**. Render the resume summary AND ask whether to resume the active flow or shelve it and start the new one.

## Resume summary (mandatory format)

```
Active flow: <slug>
─ Stage: <plan | build | review | ship>  (last touched <relative-time, in the user's language>)
─ Triage: <complexity> / ceremonyMode=<inline | soft | strict>
─ Progress: <N committed / M total AC>  or  <N conditions verified> in soft mode
─ Last specialist: <none | design | ac-author | reviewer | security-reviewer | slice-builder>
─ Open findings: <K>  (review only; 0 outside review)
─ Next step: <one sentence in the user's language describing what /cc will do next>
```

Then ask:

```
[r] <option text conveying: resume — dispatch the next specialist for <stage>>
[s] <option text conveying: show — open the artifact for the current stage and stop>
[n] <option text conveying: new — shelve this flow as cancelled and start the new task fresh>
```

`[n]` is shown only when the user passed a new task argument; otherwise drop it. `Cancel` is **not** an option — if the user wants to nuke this flow without starting a new one, they invoke `/cc-cancel` themselves. Surface that command in plain prose, in the user's language, only when the user looks stuck.

The slots inside `<...>` (relative time, next step, option text) render in the user's conversation language. `/cc`, `/cc-cancel`, slug, stage names, `ceremonyMode`, `AC-N`, file paths, frontmatter keys, and specialist names stay in their original form (mechanical tokens; see `conversation-language.md`). Bracketed shortcut letters (`[r]`, `[s]`, `[n]`) stay English.

## Inferring next step

| currentStage | progress condition | next step |
| --- | --- | --- |
| `plan` | not yet committed | "review the plan in `flows/<slug>/plan.md`, then send `/cc` to dispatch slice-builder" |
| `build` | strict mode, `build.md` exists but reviewer not yet dispatched | "continue building (next AC per `plan.md`)" — orchestrator runs `git log --grep="(AC-N):" --oneline` per AC if it needs a precise "next AC" pointer |
| `build` | soft mode, build.md exists | "review build evidence in `flows/<slug>/build.md`, then send `/cc` to enter review" |
| `build` | strict mode, every AC has matching posture-driven commits visible in `git log --grep` | "ready for review; send `/cc` to dispatch reviewer" |
| `review` | open block findings exist | "fix-only loop: send `/cc` to dispatch slice-builder mode=fix-only against open ledger rows" |
| `review` | clear / warn-only convergence | "ready for ship; send `/cc` to dispatch ship" |
| `ship` | compound complete | "flow already shipped; start a new task or invoke `/cc-cancel` to clear state" |

> **v8.40+** — the resume picker shows the total AC count (`AC: N`) as a coarse sizing signal, not "N committed / M total". The legacy "committed N of M" indicator depended on a hook writing `status: committed` back to `flow-state.json` after each AC's REFACTOR commit; v8.40 drops that hook and the chain is reconstructed ex-post via `git log --grep="(AC-N):" --oneline` only when the orchestrator actually needs a precise pointer (e.g. to dispatch the next AC's slice-builder).

## Resume rules

1. **Triage is preserved.** A resumed flow keeps its `ceremonyMode`, `complexity`, and `path`. The user does not re-pick. If they want to change any of those, the answer is "/cc-cancel and start fresh". The **one exception** is `runMode` — see the v8.34 mid-flight toggle below.
2. **Last-specialist context is restored** by reading `flows/<slug>/<stage>.md` (which now contains the design's Decisions section inline; legacy `flows/<slug>/decisions.md` is read too when it exists from a pre-v8.14 flow). The orchestrator does not summarise from memory; it re-reads the artifact.
3. **Time gate.** If the resume summary's "last touched" is >7 days ago, surface a warning ("flow is stale — verify scope still applies") but still allow resume.
4. **Sub-agent dispatch resumes from the same stage.** A build that was paused mid-RED for AC-3 resumes by dispatching slice-builder for AC-3, not by restarting AC-1.

## Mid-flight `runMode` toggle (v8.34)

The user can flip `triage.runMode` between `step` and `auto` at any `/cc` invocation by passing `/cc --mode=auto` or `/cc --mode=step` — including mid-flow (not just at resume / not just from a clean paused state). Common shape:

- **After plan is approved**, the user wants to autopilot through build → review → ship: `/cc --mode=auto`.
- **After a noisy auto-mode run**, the user wants a deliberate pause between stages: `/cc --mode=step`.
- **Resume + toggle in one step** is supported: `/cc --mode=auto` on a paused flow patches `runMode` then immediately advances under the new mode (no extra `/cc` needed).

The toggle patches `.cclaw/state/flow-state.json > triage.runMode` and **persists** across `/cc` invocations — every subsequent `/cc` reads the patched value, no need to re-pass the flag. `complexity` / `ceremonyMode` / `path` / `assumptions` / `priorLearnings` stay verbatim; only `runMode` flips.

When the flag arrives mid-specialist (the user typed `/cc --mode=auto` while a specialist was running — rare; usually the user is in step mode and types it between stages), the patch lands immediately and takes effect at the next stage boundary, never mid-specialist.

**Inline path rejection.** When `triage.path == ["build"]` (inline / trivial), the toggle is structurally meaningless — the flow has no stages to chain. The orchestrator responds with the literal one-line note **`inline path has no runMode`** and proceeds with the inline edit as if no flag had been passed. This is the only `/cc --mode=` failure mode; the toggle never errors out, never asks a follow-up question.

Combine with task text the normal way: `/cc --mode=auto refactor the auth module` is parsed as "toggle to auto, then proceed as `/cc refactor the auth module`". Only `--mode=auto` and `--mode=step` are recognised; any other value (`--mode=skip`, bare `--mode=`) surfaces a one-line "unknown runMode value, ignored" note and otherwise behaves as if the flag were absent.

## Common pitfalls

- Ignoring `flow-state.json` and starting fresh on every `/cc` invocation. The state file IS the resume point — re-prompting the user when a flow is already in progress is a contract violation.
- Re-running the triage gate on resume. The user already chose; respect the saved decision.
- Re-prompting the user for the slug ("which task?") when `currentSlug` is set. Read it from state.
- Treating `/cc` with no argument as an error. It is the canonical resume command — `/cc` advances any paused flow.
- Offering `Cancel` as an option in the resume picker. `/cc-cancel` is a separate explicit user-typed command; the picker shows `Resume` / `Show` (and `New` on collision) only.

## Worked example (schema; render in the user's language)

```
> /cc

Active flow: <slug>
─ Stage: build  (last touched <relative-time>)
─ Triage: small/medium / ceremonyMode=soft
─ Progress: 2 of 3 conditions verified
─ Last specialist: slice-builder
─ Open findings: 0
─ Next step: <one sentence describing what /cc will do next>

[r] <option text conveying: resume — dispatch slice-builder for the next condition>
[s] <option text conveying: show — open flows/<slug>/build.md and stop>
```

User picks the resume option (whichever label the user-language copy used; the harness returns the index, not the string).

Orchestrator dispatches `slice-builder` against the next pending condition.
