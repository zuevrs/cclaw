---
name: triage-gate
trigger: at the start of every new /cc invocation, before any specialist runs
---

# Skill: triage-gate

Every new flow opens with a **triage gate**. The orchestrator analyses the user's request, picks a complexity class, names an AC mode, and proposes a path. v8.14 collapses the prior two-question gate into **at most one structured ask**:

- **trivial / high-confidence**: **zero questions**. The orchestrator announces what it is about to do in one short sentence and goes straight to the inline edit. The user can always type `/cc-cancel` to undo and re-open the gate.
- **everything else**: **one structured ask** that bundles **two questions in a single form** (path + run-mode). Both questions are answered in the same turn; nothing else runs until the form returns.

## When this skill applies

- Always at the start of `/cc <task>` when no active flow exists.
- Skipped on `/cc` (no argument) when an active flow is detected — see `flow-resume.md`.
- Skipped on `/cc-cancel` and `/cc-idea` (these never open a flow).

## When NOT to apply

- **Active flow detected** (`flow-state.json > currentSlug != null`). The saved triage is read as ground truth; `flow-resume.md` runs instead and the gate does NOT re-prompt.
- **`/cc-cancel`** (shelves the active flow) and **`/cc-idea`** (one-shot idea capture). Neither opens a flow; the gate has no surface.
- **User passed `--triage=<class>`** on the `/cc` invocation. The override is the audit-trailed skip; append a v8.44 audit-log entry with `userOverrode: true` to `.cclaw/state/triage-audit.jsonl` and proceed.
- **User passed `--no-triage`.** Documented escape hatch (`complexity: small-medium`, `acMode: soft`, rationale "user disabled triage"; append audit-log entry with `userOverrode: true`). Do not re-render the form.
- **Resume from a pre-v8.21 flow with populated `triage` already on disk.** The orchestrator reads the saved triage; the gate is not re-opened mid-flow.

## Zero-question fast path (trivial / high-confidence)

When the heuristic in §"Heuristics — how to pick" classifies the request as `trivial` **with confidence `high`** AND the user did not include any "discuss first" / "design only" / "what do you think" cue, **do not ask anything**. Instead:

1. Print one short sentence in the user's language naming what is happening: complexity (`trivial`), AC mode (`inline`), the touched file(s), and a one-clause affordance: "say /cc-cancel to undo and re-triage".
2. Patch `flow-state.json > triage` with `complexity: "trivial", acMode: "inline", path: ["build"], runMode: null`. `runMode` is `null` because there are no stages to chain on the inline path. Append a v8.44 audit-log entry to `.cclaw/state/triage-audit.jsonl` with `autoExecuted: true` (the fast-path bit lives in the audit log, not on the triage object; see `src/triage-audit.ts > appendTriageAudit`).
3. Proceed straight to the inline edit + commit dispatch (Hop 3 — *Dispatch*; build stage). Pre-flight is skipped on inline by design.

If confidence is `medium` or `low`, **fall through to the structured ask** even when the class is `trivial` — uncertainty wins.

The auto-execute path exists because >80% of "trivial" requests are mechanical renames, comment fixes, and typo patches; surfacing a two-question gate for those is friction without value. The audit trail is preserved by the one-sentence announcement plus the `autoExecuted: true` line in `.cclaw/state/triage-audit.jsonl`, which downstream tooling can grep for.

## Combined-form ask (one structured ask, two questions inside)

For every non-trivial classification (and for trivial when confidence is not `high`), render the gate as **one** structured-ask call that contains **two question objects in one form** — the user picks one option per question and submits the form once. This eliminates the v8.13-era double round-trip ("answer path", then a separate "answer run-mode" turn) that wasted a structured-ask cycle and broke flow in chat-style harnesses.

If the harness exposes a structured question tool with multi-question support — `AskUserQuestion` (Claude Code, accepts `questions: [...]`), `AskQuestion` (Cursor, accepts `questions: [...]`), an "ask" content block (OpenCode, accepts multiple `question` entries), `prompt` (Codex, accepts multiple prompts in one round-trip) — **use it with both questions in a single call**.

If the harness only supports single-question structured ask, render the two questions back-to-back as two structured-ask calls (legacy v8.13 behaviour). The state is the same — only the UX is rougher.

If the harness has no structured ask at all, fall back to the fenced form below.

### Question 1 (in the same form) — path

- prompt: <one sentence in the user's language stating: complexity + confidence, recommended path, why (cite file count / LOC / sensitive surface), AC mode, "pick a path">
- options:
  - <option label conveying: proceed with the recommended path>
  - <option label conveying: switch to trivial — inline edit + commit, skip plan/review>
  - <option label conveying: escalate to large-risky — adds collaborative design phase, strict AC, parallel slices when applicable>
  - <option label conveying: customise — user edits complexity / acMode / path>

The slots above (`<...>`) are intent descriptors. Render the prompt body and every option label in the user's conversation language; do not copy the descriptor text. The prompt MUST embed the four heuristic facts (complexity + confidence, recommended path, why, ac mode) so the user can decide without reading another block. Keep it under 280 characters; truncate the rationale before truncating the facts.

### Question 2 (in the same form) — run mode

- prompt: <one sentence in the user's language asking which run mode to use>
- options:
  - <option label conveying: step mode — pause after each stage; next /cc advances (the default)>
  - <option label conveying: auto mode — chain plan → build → review → ship; stop only on hard gates>

Default `step` if the user dismisses the form or the harness only returns Question 1. On the inline path (chosen via Question 1's "switch to trivial" option) the run-mode answer is **ignored** at patch time — `runMode` is set to `null` because there are no stages to chain.

`/cc`, `plan`, `build`, `review`, `ship`, `step`, `auto` stay in their original form (mechanical tokens; see `conversation-language.md`); the descriptive prose around them is in the user's language.

## Fallback — when no structured ask tool exists

Only when the harness has no structured ask facility (rare; legacy CLI mode), print the entire combined form as **one** fenced block:

```
<Triage block heading in the user's language>
─ Complexity: <trivial | small/medium | large-risky>  (confidence: <high | medium | low>)
─ Recommended path: <inline | plan → build → review → ship>  (large-risky uses the same four-stage path; the discovery sub-phase is an expansion of `plan`, not a separate path entry)
─ Why: <one short sentence in the user's language; cite file count, LOC estimate, sensitive-surface flag>
─ AC mode: <inline | soft | strict>

<Question 1 — path>
[1] <option text conveying: proceed with the recommendation>
[2] <option text conveying: switch to trivial>
[3] <option text conveying: escalate to large-risky>
[4] <option text conveying: customise the triage>

<Question 2 — run mode (not asked on inline)>
[s] <option text conveying: step mode — pause after each stage; next /cc advances (default)>
[a] <option text conveying: auto mode — chain stages; stop only on hard gates>
```

The user replies with two tokens on the same turn (`1s` / `3a` / etc.). The slots inside `<...>` are intent only; the actual fallback rendered to the user uses the user's language. Bracketed shortcut letters (`[1]`, `[s]`) and mechanical tokens (`/cc`, `plan`, `build`, `review`, `ship`, `step`, `auto`, complexity / acMode keywords) stay in their original form regardless of conversation language.

The fenced form is a fallback, not the primary path. Always try the structured tool first.

## Heuristics — how to pick

Rank the request against these signals. The orchestrator picks the **highest** complexity any signal triggers (escalation is one-way).

| Signal | Pushes toward |
| --- | --- |
| typo, rename, comment, single-file format change, ≤30 lines, no test impact | trivial / inline |
| 1-3 modules, ≤5 testable behaviours, no auth/payment/data-layer touch, no migration | small/medium / soft |
| ≥4 modules touched OR ≥6 distinct behaviours OR architectural decision needed OR migration required OR auth/payment/data-layer touch OR explicit security flag | large-risky / strict (plan stage expands into discovery sub-phase) |
| user explicitly asked for "discuss first" / "design only" / "what do you think" | large-risky (forces discovery sub-phase under plan) |
| user explicitly asked for "just fix it" on a single file | trivial / inline (still confirm — they may underestimate) |

The "highest wins" rule is intentional. Agents underestimate scope more often than they overestimate; if any signal says large-risky, surface large-risky.

If the heuristic gives `small/medium` but the user said something like "feature spanning auth and billing", upgrade and explain why in the `Why` line.

## Confidence levels

- **high** — at least two signals agree on the same class, AND the user's prompt is concrete (named files, named behaviours, or named acceptance).
- **medium** — only one signal triggered, OR the prompt is concrete but no scope cues.
- **low** — prompt is vague ("make it better", "fix bugs", "add some auth"). Always escalate one class on `low` confidence and ask the user to clarify before locking.

`Recommended path` for low confidence is always at least `plan → …` (never `inline`); the user explicitly opting into trivial after seeing the triage is fine.

## What the orchestrator records

After the combined form returns (or after the zero-question fast path executes), patch `.cclaw/state/flow-state.json`:

```json
{
  "triage": {
    "complexity": "small-medium",
    "acMode": "soft",
    "path": ["plan", "build", "review", "ship"],
    "rationale": "3 modules, ~150 LOC, no auth touch.",
    "decidedAt": "2026-05-08T12:34:56Z",
    "runMode": "step"
  }
}
```

`runMode` is `step` by default on non-inline paths; `auto` when the user explicitly opted into autopilot in Question 2; `null` on inline / trivial paths (no stages to chain). The `userOverrode` and `autoExecuted` bits (write-only telemetry) live in the v8.44 audit log at `.cclaw/state/triage-audit.jsonl`, NOT on the triage object — append the audit-log entry immediately after persisting the triage write. Pre-v8.44 state files retain these fields on `TriageDecision`; readers tolerate their presence, but new writes target the audit log.

The triage block is **immutable for the lifetime of the flow** — with one v8.34 exception. `complexity` / `acMode` / `path` cannot change mid-flight; if the user wants to escalate (e.g. discovers it is bigger than thought), `/cc-cancel` and start a fresh flow with new triage. `runMode` is the **single mutable field**: the user passes `/cc --mode=auto` or `/cc --mode=step` to flip mid-flight (`flow-resume.md > Mid-flight runMode toggle` carries the full mechanics). The inline path rejects the toggle (no stages to chain).

## Path semantics

| path value | what runs | when |
| --- | --- | --- |
| `["build"]` (inline trivial) | direct edit + commit, no plan, no review | `complexity == "trivial"` |
| `["plan", "build", "review", "ship"]` (small/medium) | one ac-author sub-agent for plan; one slice-builder for build; one reviewer for review; ship fan-out | `complexity == "small-medium"` |
| `["plan", "build", "review", "ship"]` (large-risky) | **plan stage expands** into design (main context, multi-turn) → ac-author; build/review/ship behave as small/medium plus parallel-build fan-out and adversarial pre-mortem when applicable | `complexity == "large-risky"` |

`triage.path` only ever holds the four canonical stages: `plan`, `build`, `review`, `ship`. **`discovery` is never an entry in `path`.** When the orchestrator promises a "discovery sub-phase" it means the `plan` stage runs design (Phase 0-7 in main context) then ac-author — see `/cc.md` "Plan stage on large-risky" for the dispatch contract.

The orchestrator's path-validation rule is single-stage: `triage.path` ⊆ `{plan, build, review, ship}`. Any state file that contains a `"discovery"` entry is from an older schema and must be normalised — strip the `"discovery"` entry and continue with the remaining stages.

## No-git auto-downgrade (v8.23)

Before the triage decision is patched into `flow-state.json`, the orchestrator runs the Hop 1 git-check: does `<projectRoot>/.git/` exist? If not, the gate **auto-downgrades** `acMode` from whatever the heuristic recommended to `soft`, regardless of complexity class, and records the audit-trail field:

```json
{
  "triage": {
    "complexity": "large-risky",
    "acMode": "soft",
    "downgradeReason": "no-git",
    "rationale": "..."
  }
}
```

The downgrade is structural, not stylistic:

- **strict mode requires per-AC commits.** The slice-builder writes one commit per posture-phase (e.g. `red(AC-N): ...`, `green(AC-N): ...`, `refactor(AC-N): ...`) and the reviewer reconstructs the chain ex-post via `git log --grep="(AC-N):"`. Without `.git/`, there is nothing to commit and nothing to grep — the chain cannot exist. Soft mode is git-optional (the build still works without commits, just without an audit trail); strict mode is not.
- **parallel-build relies on `git worktree add`.** v8.13's parallel fan-out clones the working tree into `.cclaw/worktrees/<slug>-s-N` via `git worktree`; without `.git/`, the dispatch envelope can't construct the worktree. Soft mode falls back to sequential slice dispatch; the slice-builder reads `triage.downgradeReason == "no-git"` and suppresses the parallel envelope.
- **inline path's terminal `git commit`** is gracefully suppressed too — the orchestrator surfaces "no-git: change applied, no commit recorded" instead of crashing.

Surface the downgrade to the user as a one-sentence warning at triage time, in the user's conversation language: "no `.git/` detected — running in soft acMode; parallel-build is disabled until you initialise a repo." The mechanical tokens (`acMode`, `soft`, `.git/`, `/cc`) stay English.

The downgrade is **one-way for the lifetime of the flow**. Running `git init` mid-flight does NOT re-upgrade the triage — `/cc-cancel` + fresh `/cc` is the only path that re-triages with git now present. This mirrors the general invariant that triage is immutable for the lifetime of the flow (above, in "What the orchestrator records").

Ship-gate's `no-vcs` finalization option remains available regardless of the downgrade — a user can still ship a soft-mode flow without git by picking the no-vcs path at Hop 6 (Finalize). See `runbooks/ship-gate.md`.

## When to skip the gate

The gate is **never skipped silently**. Three explicit forms of skip:

1. User passed `--triage=trivial` (or `--triage=small-medium` / `--triage=large-risky`) on the `/cc` invocation — append a v8.44 audit-log entry with `userOverrode: true`, skip the question, log the choice in the rationale: "user passed --triage=trivial".
2. Active flow detected with a recorded triage — `flow-resume.md` resumes that triage; you do not re-prompt.
3. User typed `/cc <task> --no-triage` — record `complexity: small-medium, acMode: soft, path: plan→build→review→ship`, rationale "user disabled triage"; append an audit-log entry with `userOverrode: true`. This is the documented escape hatch; surfacing it as a footnote on the help text is fine, but it should not be the default.

## Worked examples

### Trivial — high confidence (zero-question fast path)

User: "Rename `getCwd` to `getCurrentWorkingDirectory` across the repo."

The orchestrator **does not ask**. It prints one sentence and proceeds straight to the inline edit:

```
Triage: trivial / inline — mechanical rename across ~12 call sites in 5 files; running inline now. Say /cc-cancel to undo and re-triage.
```

Then it dispatches the edit + commit and stops. A v8.44 audit-log line in `.cclaw/state/triage-audit.jsonl` with `autoExecuted: true` records the fast-path use (the bit no longer lives on `triage` itself).

### Trivial — medium confidence (combined form, single ask)

User: "Clean up the auth helper."

```
Triage
─ Complexity: trivial  (confidence: medium — prompt is vague: "clean up" could be cosmetic or behavioural)
─ Recommended path: inline
─ Why: single helper file, ~80 LOC, no caller touch.
─ AC mode: inline
```

```
Question 1 — path
[1] Proceed as recommended
[2] Switch to trivial (inline edit + commit, skip plan/review)
[3] Escalate to large-risky (add collaborative design phase, strict AC, parallel slices)
[4] Custom (let me edit complexity / acMode / path)

Question 2 — run mode (ignored on inline)
[s] Step mode — pause after each stage; next /cc advances (default)
[a] Auto mode — chain plan → build → review → ship; stop only on hard gates
```

### Small/medium — medium confidence

User: "Add a status pill to the approvals dashboard."

```
Triage
─ Complexity: small/medium  (confidence: medium)
─ Recommended path: plan → build → review → ship
─ Why: 1 new component + 1 hook, ~120 LOC, no auth/payment touch.
─ AC mode: soft
```

### Large-risky — escalation triggered

User: "Migrate the user store from Postgres to DynamoDB."

```
Triage
─ Complexity: large-risky  (confidence: high)
─ Recommended path: plan → build → review → ship  (plan stage expands: design → ac-author)
─ Why: data-layer migration, schema change, requires runbook + rollback plan.
─ AC mode: strict
```

### Low confidence — escalate one class

User: "Make auth less broken."

```
Triage
─ Complexity: small/medium  (confidence: low — escalated from trivial because prompt is vague)
─ Recommended path: plan → build → review → ship
─ Why: "auth" touches sensitive surface; need a plan to scope concretely.
─ AC mode: soft
```

The user is expected to clarify in (4) Custom or accept (1) Proceed; either way the triage is now recorded.

## Common rationalizations

The triage gate is the easiest place to skip "because the task is obvious". When you catch yourself thinking the left column, do the right column. Surface the rationalization in the triage rationale line so the audit trail records why the gate ran (or didn't) the way it did.

| rationalization | truth |
| --- | --- |
| "This is obviously trivial — skip the gate entirely." | Confidence must be `high` AND no "discuss first" cue for the zero-question fast path. If either is missing, the structured ask runs; "obviously" is the canonical anchoring bias. |
| "User said 'just fix it' — go straight to inline." | "just fix it" is a cue but not a free pass. The heuristic still ranks file count / LOC / sensitive surface; if any signal says large-risky, surface large-risky and let the user override. |
| "Vague prompt + confidence low → small/medium is fine." | On `low` confidence, always escalate one class. The user reads the triage and learns to ignore your scope estimates; escalation produces an honest gate. |
| "Combined form is overkill for a small slug — let me ask Question 1, then Question 2 separately." | The combined form is the v8.14 default on every supporting harness (Cursor / Claude Code / OpenCode / Codex). Splitting back to two asks wastes a round-trip on every non-inline flow. |
| "I'll re-render the triage on resume to confirm — safer." | Resume reads the saved triage and continues from `currentStage` — never re-prompts. Re-rendering is a contract violation; the user already chose. |
| "Mid-flight the user wants to switch from step to auto — let me patch `triage.runMode`." | v8.34 lifts the immutability rule for `runMode` only: the user passes `/cc --mode=auto` or `/cc --mode=step` and the orchestrator patches `triage.runMode` (see `flow-resume.md > Mid-flight runMode toggle`). `complexity` / `acMode` / `path` stay immutable — those still require `/cc-cancel` + fresh `/cc`. Inline path rejects the toggle (no `runMode` to flip). |
| "`large-risky` to be safe on this one-file rename." | Don't pad the heuristic. The user reads it and learns to ignore your triage; padding undermines the gate's signal-to-noise. |
| "No-git auto-downgrade is a warning, not a hard rule." | Strict mode requires per-AC commits — without `.git/`, there is no SHA to record. The downgrade is structural; treating it as advisory crashes on the first commit attempt. |

## Common pitfalls

- **Rendering the triage as a code block when a structured ask tool is available.** Try the harness's structured ask facility (`AskUserQuestion` / `AskQuestion` / `prompt` / "ask" content block) first; the fenced form is a fallback only.
- Stating "I think this is medium-complexity" and then immediately invoking ac-author. Wait for the user's pick — orchestrator-decided routing without an explicit user confirmation is the most common cause of mis-scoped flows.
- Picking `large-risky` for a one-file rename "to be safe". Do not pad the heuristic; the user reads it and learns to ignore your triage.
- **Asking the gate on a trivial / high-confidence request.** The zero-question fast path exists for exactly this case; surfacing a form for a typo-fix is friction without value. If you are about to ask, double-check the confidence is not `high`.
- **Splitting the combined form into two separate structured-ask calls when the harness supports multi-question.** v8.13's double round-trip is now a regression; pack both questions into one form on every supporting harness (Cursor `AskQuestion`, Claude Code `AskUserQuestion`, OpenCode "ask", Codex `prompt`).
- Forgetting that the run-mode answer is **ignored on the inline path**. `triage.runMode` is `null` on inline; do not write `"step"` or `"auto"` there.
- Forgetting to write `triage` into `flow-state.json`. The resume detector reads it; an absent triage breaks resume and the reviewer's posture-aware git-log inspection (which needs `triage.acMode` to know whether to run the strict-mode chain check at all).
- Re-running the gate on resume. Resume reads the saved triage (path + runMode) and continues from `currentStage`; it never re-prompts. (Pre-v8.44 state files may still carry `autoExecuted` / `userOverrode` on the triage object; readers tolerate them but resume does not re-stamp them.)

## Next step

After the combined form returns AND the path is **not** `inline`, the orchestrator dispatches the first specialist directly. As of v8.21 there is no separate "Hop 2.5" assumption-confirmation step in between — the assumption surface lives inside the first specialist's first turn (design Phase 0 on large-risky; ac-author Phase 0 on small-medium). `triage.assumptions` is still a first-class field on `flow-state.json` and is populated by whichever specialist runs first. On the inline path (whether reached via the zero-question fast path or via Question 1 option (2)), the orchestrator goes straight to the build dispatch — there is no assumption surface (a one-line edit has no assumptions worth surfacing).
