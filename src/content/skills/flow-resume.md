---
name: flow-resume
trigger: /cc invoked with no task argument, OR with an argument while flow-state.json has currentSlug != null
---

# Skill: flow-resume

`/cc` without an argument means **"continue what we were doing"**. `/cc <task>` with an existing active flow means the user might either be resuming or starting a new branch — the orchestrator has to ask, never silently pick.

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
─ Triage: <complexity> / acMode=<inline | soft | strict>
─ Progress: <N committed / M total AC>  or  <N conditions verified> in soft mode
─ Last specialist: <none | design | planner | reviewer | security-reviewer | slice-builder>
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

The slots inside `<...>` (relative time, next step, option text) render in the user's conversation language. `/cc`, `/cc-cancel`, slug, stage names, `acMode`, `AC-N`, file paths, frontmatter keys, and specialist names stay in their original form (mechanical tokens; see `conversation-language.md`). Bracketed shortcut letters (`[r]`, `[s]`, `[n]`) stay English.

## Inferring next step

| currentStage | progress condition | next step |
| --- | --- | --- |
| `plan` | not yet committed | "review the plan in `flows/<slug>/plan.md`, then send `/cc` to dispatch slice-builder" |
| `build` | strict mode, AC committed > 0, AC pending > 0 | "continue with AC-<next pending>" |
| `build` | soft mode, build.md exists | "review build evidence in `flows/<slug>/build.md`, then send `/cc` to enter review" |
| `build` | strict mode, all AC committed | "ready for review; send `/cc` to dispatch reviewer" |
| `review` | open block findings exist | "fix-only loop: send `/cc` to dispatch slice-builder mode=fix-only against open ledger rows" |
| `review` | clear / warn-only convergence | "ready for ship; send `/cc` to dispatch ship" |
| `ship` | compound complete | "flow already shipped; start a new task or invoke `/cc-cancel` to clear state" |

## Resume rules

1. **Triage is preserved.** A resumed flow keeps its `acMode`, `complexity`, and `path`. The user does not re-pick. If they want to change mode, the answer is "/cc-cancel and start fresh".
2. **Last-specialist context is restored** by reading `flows/<slug>/<stage>.md` (which now contains the design's Decisions section inline; legacy `flows/<slug>/decisions.md` is read too when it exists from a pre-v8.14 flow). The orchestrator does not summarise from memory; it re-reads the artifact.
3. **Time gate.** If the resume summary's "last touched" is >7 days ago, surface a warning ("flow is stale — verify scope still applies") but still allow resume.
4. **Sub-agent dispatch resumes from the same stage.** A build that was paused mid-RED for AC-3 resumes by dispatching slice-builder for AC-3, not by restarting AC-1.

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
─ Triage: small/medium / acMode=soft
─ Progress: 2 of 3 conditions verified
─ Last specialist: slice-builder
─ Open findings: 0
─ Next step: <one sentence describing what /cc will do next>

[r] <option text conveying: resume — dispatch slice-builder for the next condition>
[s] <option text conveying: show — open flows/<slug>/build.md and stop>
```

User picks the resume option (whichever label the user-language copy used; the harness returns the index, not the string).

Orchestrator dispatches `slice-builder` against the next pending condition.
