export interface AutoTriggerSkill {
  id: string;
  fileName: string;
  description: string;
  triggers: string[];
  body: string;
}

const TRIAGE_GATE = `---
name: triage-gate
trigger: at the start of every new /cc invocation, before any specialist runs
---

# Skill: triage-gate

Every new flow opens with a **triage gate**. The orchestrator analyses the user's request, picks a complexity class, names an AC mode, proposes a path, and **asks the user to confirm — twice**: once for the path, once for the run mode (autopilot or step-by-step). Nothing else runs until both questions are answered.

## When this skill applies

- Always at the start of \`/cc <task>\` when no active flow exists.
- Skipped on \`/cc\` (no argument) when an active flow is detected — see \`flow-resume.md\`.
- Skipped on \`/cc-cancel\` and \`/cc-idea\` (these never open a flow).

## How to render the question — STRUCTURED, not prose

If the harness exposes a structured question tool — \`AskUserQuestion\` (Claude Code), \`AskQuestion\` (Cursor), an "ask" content block (OpenCode), \`prompt\` (Codex) — **use it**. Two separate calls, in order. Do **not** print the triage as a code block and rely on the user reading numbered options. v8.2 shipped that way and the harness rendered prose; v8.3 fixes it.

### Question 1 — path

Render the analysis as the question prompt and the four choices as options:

- prompt: \`Triage — Complexity: small/medium (high). Recommended: plan → build → review → ship. Why: 3 modules, ~150 LOC, no auth touch. AC mode: soft. Pick a path.\`
- options:
  - \`Proceed as recommended\`
  - \`Switch to trivial (inline edit + commit, skip plan/review)\`
  - \`Escalate to large-risky (add brainstormer/architect, strict AC, parallel slices)\`
  - \`Custom (let me edit complexity / acMode / path)\`

The prompt MUST embed the four heuristic facts (complexity + confidence, recommended path, why, ac mode) so the user can decide without reading another block. Keep it under 280 characters; truncate the rationale before truncating the facts.

### Question 2 — run mode

Right after the user picks a path, ask:

- prompt: \`Run mode for this flow?\`
- options:
  - \`Step (default) — pause after every stage; I type "continue" to advance\`
  - \`Auto — run plan → build → review → ship without pausing; stop only on block findings or security flag\`

Default \`step\` if the user dismisses the question or the harness lacks a structured ask facility. Inline / trivial flows skip Question 2 (there are no stages to chain).

## Fallback — when no structured ask tool exists

Only when the harness has no structured ask facility (rare; legacy CLI mode), print the same content as a fenced block plus numbered options:

\`\`\`
Triage
─ Complexity: <trivial | small/medium | large-risky>  (confidence: <high | medium | low>)
─ Recommended path: <inline | plan → build → review → ship>  (large-risky uses the same four-stage path; the discovery sub-phase is an expansion of \`plan\`, not a separate path entry)
─ Why: <one short sentence; cite file count, LOC estimate, sensitive-surface flag>
─ AC mode: <inline | soft | strict>
\`\`\`

\`\`\`
[1] Proceed as recommended
[2] Switch to trivial (inline edit + commit, skip plan/review)
[3] Escalate to large-risky (add brainstormer/architect, strict AC, parallel slices)
[4] Custom (let me edit complexity / acMode / path)
\`\`\`

Then a separate block for run mode:

\`\`\`
Run mode
[s] Step — pause after every stage (default)
[a] Auto — chain stages without pausing; stop only on block findings or security flag
\`\`\`

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

If the heuristic gives \`small/medium\` but the user said something like "feature spanning auth and billing", upgrade and explain why in the \`Why\` line.

## Confidence levels

- **high** — at least two signals agree on the same class, AND the user's prompt is concrete (named files, named behaviours, or named acceptance).
- **medium** — only one signal triggered, OR the prompt is concrete but no scope cues.
- **low** — prompt is vague ("make it better", "fix bugs", "add some auth"). Always escalate one class on \`low\` confidence and ask the user to clarify before locking.

\`Recommended path\` for low confidence is always at least \`plan → …\` (never \`inline\`); the user explicitly opting into trivial after seeing the triage is fine.

## What the orchestrator records

After both questions are answered, patch \`.cclaw/state/flow-state.json\`:

\`\`\`json
{
  "triage": {
    "complexity": "small-medium",
    "acMode": "soft",
    "path": ["plan", "build", "review", "ship"],
    "rationale": "3 modules, ~150 LOC, no auth touch.",
    "decidedAt": "2026-05-08T12:34:56Z",
    "userOverrode": false,
    "runMode": "step"
  }
}
\`\`\`

\`userOverrode\` is \`true\` only when the user picked (2), (3), or a (4) custom that disagrees with the recommendation. \`runMode\` is \`step\` by default; record \`auto\` only when the user explicitly opted into autopilot in Question 2.

The triage block is **immutable for the lifetime of the flow**. If the user wants to escalate mid-flight (e.g. discovers it is bigger than thought), \`/cc-cancel\` and start a fresh flow with new triage. Switching from \`step\` to \`auto\` (or vice versa) is also a fresh-flow decision — the orchestrator does not flip mid-flight.

## Path semantics

| path value | what runs | when |
| --- | --- | --- |
| \`["build"]\` (inline trivial) | direct edit + commit, no plan, no review | \`complexity == "trivial"\` |
| \`["plan", "build", "review", "ship"]\` (small/medium) | one planner sub-agent for plan; one slice-builder for build; one reviewer for review; ship fan-out | \`complexity == "small-medium"\` |
| \`["plan", "build", "review", "ship"]\` (large-risky) | **plan stage expands** into brainstormer → checkpoint → architect → checkpoint → planner; build/review/ship behave as small/medium plus parallel-build fan-out and adversarial pre-mortem when applicable | \`complexity == "large-risky"\` |

\`triage.path\` only ever holds the four canonical stages: \`plan\`, \`build\`, \`review\`, \`ship\`. **\`discovery\` is never an entry in \`path\`.** When the orchestrator promises a "discovery sub-phase" it means the \`plan\` stage runs three specialists with checkpoints between each (brainstormer → architect → planner) — see \`/cc.md\` "Plan stage on large-risky" for the dispatch contract.

The orchestrator's path-validation rule is single-stage: \`triage.path\` ⊆ \`{plan, build, review, ship}\`. Any state file that contains a \`"discovery"\` entry is an artefact of a pre-v8.5 orchestrator and must be normalised — strip the \`"discovery"\` entry and continue with the remaining stages.

## When to skip the gate

The gate is **never skipped silently**. Three explicit forms of skip:

1. User passed \`--triage=trivial\` (or \`--triage=small-medium\` / \`--triage=large-risky\`) on the \`/cc\` invocation — record \`userOverrode: true\`, skip the question, log the choice in the rationale: "user passed --triage=trivial".
2. Active flow detected with a recorded triage — \`flow-resume.md\` resumes that triage; you do not re-prompt.
3. User typed \`/cc <task> --no-triage\` — record \`complexity: small-medium, acMode: soft, path: plan→build→review→ship, userOverrode: true\`, rationale "user disabled triage". This is the documented escape hatch; surfacing it as a footnote on the help text is fine, but it should not be the default.

## Worked examples

### Trivial — high confidence

User: "Rename \`getCwd\` to \`getCurrentWorkingDirectory\` across the repo."

\`\`\`
Triage
─ Complexity: trivial  (confidence: high)
─ Recommended path: inline
─ Why: Mechanical rename, ~12 call sites in 5 files, no behavioural change.
─ AC mode: inline
\`\`\`

\`\`\`
[1] Proceed as recommended
[2] Switch to trivial (inline edit + commit, skip plan/review)
[3] Escalate to large-risky (add brainstormer/architect, strict AC, parallel slices)
[4] Custom (let me edit complexity / acMode / path)
\`\`\`

### Small/medium — medium confidence

User: "Add a status pill to the approvals dashboard."

\`\`\`
Triage
─ Complexity: small/medium  (confidence: medium)
─ Recommended path: plan → build → review → ship
─ Why: 1 new component + 1 hook, ~120 LOC, no auth/payment touch.
─ AC mode: soft
\`\`\`

### Large-risky — escalation triggered

User: "Migrate the user store from Postgres to DynamoDB."

\`\`\`
Triage
─ Complexity: large-risky  (confidence: high)
─ Recommended path: plan → build → review → ship  (plan stage expands: brainstormer → architect → planner)
─ Why: data-layer migration, schema change, requires runbook + rollback plan.
─ AC mode: strict
\`\`\`

### Low confidence — escalate one class

User: "Make auth less broken."

\`\`\`
Triage
─ Complexity: small/medium  (confidence: low — escalated from trivial because prompt is vague)
─ Recommended path: plan → build → review → ship
─ Why: "auth" touches sensitive surface; need a plan to scope concretely.
─ AC mode: soft
\`\`\`

The user is expected to clarify in (4) Custom or accept (1) Proceed; either way the triage is now recorded.

## Common pitfalls

- **Rendering the triage as a code block when a structured ask tool is available.** v8.3 fixes this: try the harness's structured ask facility (\`AskUserQuestion\` / \`AskQuestion\` / \`prompt\` / "ask" content block) first; the fenced form is a fallback only.
- Stating "I think this is medium-complexity" and then immediately invoking planner. That is the v8.1 bug. Wait for the user's pick.
- Picking \`large-risky\` for a one-file rename "to be safe". Do not pad the heuristic; the user reads it and learns to ignore your triage.
- Forgetting to ask Question 2 (run mode) after Question 1 (path). \`triage.runMode\` controls Hop 4 (pause); a missing value defaults to \`step\` — safe but wastes a click for users who wanted autopilot.
- Forgetting to write \`triage\` into \`flow-state.json\`. The hook check \`commit-helper.mjs\` and the resume detector both read it; an absent triage breaks both.
- Re-running the gate on resume. Resume reads the saved triage (path + runMode) and continues from \`currentStage\`; it never re-prompts.

## Next step

After both triage questions are answered AND the path is **not** \`inline\`, the orchestrator runs the \`pre-flight-assumptions\` skill (Hop 2.5) before dispatching the first specialist. On the inline path, the orchestrator goes straight to the build dispatch — pre-flight is skipped (a one-line edit has no assumptions worth surfacing).
`;

const PRE_FLIGHT_ASSUMPTIONS = `---
name: pre-flight-assumptions
trigger: after triage-gate, before the first specialist dispatch — only when triage.path is NOT inline
---

# Skill: pre-flight-assumptions

Triage answers "**how much** work is this?" and "**how should we run it?**". Pre-flight answers "**on what assumptions** are we doing it?". They are different questions; v8.4 adds this hop because silently-defaulted assumptions are the most common reason a small/medium build ships the wrong feature.

The pre-flight skill runs **once** per flow, between the triage gate (Hop 2) and the first specialist dispatch (Hop 3). It does not run on the inline / trivial path — a single-file edit has no architectural assumptions worth surfacing.

## What the orchestrator does

1. Read \`triage.path\` from \`flow-state.json\`.
2. If \`path == ["build"]\` (inline), skip this skill entirely. Go to dispatch.
3. Otherwise:
   1. Inspect the repo for stack inference. Read at most:
      - \`package.json\` / \`pnpm-lock.yaml\` (Node, framework + version, test runner);
      - \`pyproject.toml\` / \`requirements.txt\` (Python, framework + version);
      - \`go.mod\` (Go);
      - \`Cargo.toml\` (Rust);
      - \`composer.json\` (PHP);
      - \`Gemfile\` (Ruby);
      - the top-level README or AGENTS.md if it exists.
   2. Inspect the most recent shipped slug under \`.cclaw/flows/shipped/\` (if any) — its \`assumptions:\` block is your seed for what defaults the project already established.
   3. Compose 3–7 short, numbered assumptions covering:
      - **Stack** — language version, framework, runtime target, test runner.
      - **Conventions** — where tests live (\`tests/\`, \`__tests__/\`, alongside source), filename pattern (\`*.test.ts\`, \`*.spec.ts\`, \`*_test.go\`).
      - **Architecture defaults** that apply to this slug — CSS strategy, state strategy, auth strategy, persistence pattern. Skip items that are not relevant.
      - **Out-of-scope defaults** — what we will NOT do unless asked (mobile breakpoints, i18n, telemetry hooks).
   4. Surface them through the harness's structured ask tool. If the harness has none, fall back to a fenced block; same rule as the triage gate.
   5. Persist the user's confirmed list to \`flow-state.json\`'s \`triage.assumptions\`.

## Output shape — STRUCTURED ask

Render the numbered list as the question prompt, plus four options:

- prompt:

  Pre-flight — I'm about to run with these assumptions:

  1. Node 20.11; Next.js 14.1; React 19.0; Tailwind 3.4 (read from package.json).
  2. Tests live in \`tests/\` mirroring the production module path (\`*.test.tsx\`).
  3. CSS strategy: Tailwind utility classes + 1 \`tokens.css\` for color/space tokens (matches existing components).
  4. Auth strategy: session-based cookies via \`next-auth\` (current pattern).
  5. Out-of-scope: mobile breakpoints, i18n strings, telemetry events.

  Correct me now or I proceed with these.

- options:
  - \`Proceed with these\`
  - \`Edit one assumption\`
  - \`Edit several assumptions\`
  - \`Cancel — re-think the request\`

If the user picks "Edit one" or "Edit several", follow up with a free-text ask (textarea / prompt-input) for the corrected list. Re-confirm once with the structured tool, then persist.

If the user dismisses the question (timeout, harness limitation), default to "Proceed with these" — the user has at least seen them once, and the next message can amend if needed.

## Output shape — FALLBACK (no structured ask)

\`\`\`
Pre-flight assumptions
1. Node 20.11; Next.js 14.1; React 19.0; Tailwind 3.4 (from package.json).
2. Tests live in tests/ mirroring production module path.
3. CSS: Tailwind + tokens.css.
4. Auth: session cookies via next-auth.
5. Out of scope: mobile, i18n, telemetry.

Correct me now or I proceed.
[1] Proceed
[2] Edit one assumption — say which number and the replacement
[3] Edit several — paste the corrected list
[4] Cancel
\`\`\`

## Persistence shape

After the user accepts (with or without edits), patch \`flow-state.json\`:

\`\`\`json
{
  "triage": {
    "complexity": "small-medium",
    "acMode": "soft",
    "path": ["plan", "build", "review", "ship"],
    "rationale": "...",
    "decidedAt": "...",
    "userOverrode": false,
    "runMode": "step",
    "assumptions": [
      "Node 20.11, Next.js 14.1, React 19.0, Tailwind 3.4",
      "Tests in tests/ mirroring module path",
      "CSS: Tailwind + tokens.css",
      "Auth: session cookies via next-auth",
      "Out of scope: mobile, i18n, telemetry"
    ]
  }
}
\`\`\`

The list is **immutable** for the lifetime of the flow. If during build a sub-agent finds an assumption was wrong, it stops and surfaces — the orchestrator either runs \`/cc-cancel\` and starts fresh, or accepts the violation as an explicit user decision and records it in the build log.

## How sub-agents read assumptions

Every dispatch envelope from Hop 3 onward includes a one-line note:

\`\`\`
Pre-flight assumptions: see triage.assumptions in flow-state.json
\`\`\`

Sub-agents (planner, slice-builder, reviewer, etc.) read \`flow-state.json > triage.assumptions\` before authoring their artifact. The list is appended verbatim (under \`## Assumptions\`) to:

- \`flows/<slug>/plan.md\` — copy the list once after the Frame, so the plan stays self-contained for review.
- \`flows/<slug>/decisions.md\` — when architect runs, the assumptions are the first input the architect must respect.

A sub-agent that would need to break an assumption raises it as a finding (in slice-builder: stop and surface; in reviewer: \`block\`-severity finding) instead of silently overriding.

## Sizing rules

- **3–7 assumptions, no more.** A long list is noise; the user stops reading after item 5.
- **One sentence per assumption, no half-paragraphs.** Pick the most relevant version / pattern / boundary.
- **Cite where you got each one** when non-obvious — \`(from package.json)\`, \`(from latest shipped slug 'auth-cleanup')\`, \`(my default — confirm)\`. The citation tells the user what is observed vs. defaulted.
- **Never invent specifics you have not read.** If you cannot cite a concrete version from a real file, say so: "(default; the project did not pin a Tailwind version)".

## What the pre-flight is NOT

- It is not a planning step. It does not write AC or design.
- It is not the brainstormer's Frame. The Frame answers "what are we building?"; pre-flight answers "on what stack and conventions?".
- It is not a security review. Sensitive surfaces still get \`security-reviewer\` later in the flow.
- It is not optional in soft / strict modes. The whole point is to surface defaults; skipping it defeats the skill.

## Worked example — Russian conversation

User: "Сделай страницу настроек профиля."

Pre-flight prompt (structured ask):

\`\`\`
Pre-flight — допущения, с которыми буду работать:

1. Next.js 14.1, React 19.0, TypeScript 5.4 (из package.json).
2. Тесты в tests/ рядом с компонентом, файлы *.test.tsx (как в существующих компонентах).
3. CSS: Tailwind + общий tokens.css (как в components/ui/).
4. Тёмная тема через CSS variables, не next-themes (текущая стратегия).
5. Сохранение в БД через существующий route /api/profile (Prisma + Postgres). localStorage не используем.
6. Server component для каркаса страницы, client component только для формы.

Поправь сейчас или продолжаю с этим.
\`\`\`

Options: \`Иду с этим\` / \`Поправить одно\` / \`Поправить несколько\` / \`Отмена\`.

Note: prompt is in Russian (matches user's language), but \`tokens.css\`, \`tests/\`, \`*.test.tsx\`, \`/api/profile\`, \`Prisma\`, \`Tailwind\` stay in their original form — they are mechanical tokens (see \`conversation-language.md\`).

## Common pitfalls

- **Listing 12+ assumptions.** That is a checklist, not an assumptions block. Keep it 3–7.
- **Mixing assumptions with the plan.** The plan goes into \`plan.md\`. The assumptions are pre-plan context.
- **Skipping pre-flight on \`small-medium\` because "the user knows the stack".** The user *does* know; pre-flight makes sure the orchestrator knows the same things.
- **Re-running pre-flight on resume.** It runs once per flow. Resume reads the saved \`assumptions\` from \`flow-state.json\` and proceeds.
- **Defaulting an assumption from training data instead of the repo.** If you cannot cite a file or shipped slug, mark the assumption with "(my default — confirm)" so the user knows it is a guess.
- **Pre-flight on the inline path.** Skip. Trivial change, no assumptions to surface.
`;

const FLOW_RESUME = `---
name: flow-resume
trigger: /cc invoked with no task argument, OR with an argument while flow-state.json has currentSlug != null
---

# Skill: flow-resume

\`/cc\` without an argument means **"continue what we were doing"**. \`/cc <task>\` with an existing active flow means the user might either be resuming or starting a new branch — the orchestrator has to ask, never silently pick.

## Detection

Read \`.cclaw/state/flow-state.json\`:

- \`currentSlug == null\` AND no \`/cc\` argument → ask user "What do you want to work on?". This is just an empty start, not a resume.
- \`currentSlug == null\` AND \`/cc <task>\` argument → fresh start. Run \`triage-gate.md\`.
- \`currentSlug != null\` AND no \`/cc\` argument → **resume**. Render the resume summary and proceed.
- \`currentSlug != null\` AND \`/cc <task>\` argument → **collision**. Render the resume summary AND ask whether to resume the active flow or shelve it and start the new one.

## Resume summary (mandatory format)

\`\`\`
Active flow: <slug>
─ Stage: <plan | build | review | ship>  (last touched <relative-time>)
─ Triage: <complexity> / acMode=<inline | soft | strict>
─ Progress: <N committed / M total AC>  (or "<N conditions verified" in soft mode)
─ Last specialist: <none | brainstormer | architect | planner | reviewer | security-reviewer | slice-builder>
─ Open findings: <K>  (review only; 0 outside review)
─ Next step: <inferred from stage and progress>
\`\`\`

Then ask:

\`\`\`
[r] Resume — continue from <stage>
[s] Show — open the artifact for the current stage and pause
[c] Cancel — /cc-cancel and free the slot
[n] New — shelve this flow as cancelled and start fresh
\`\`\`

\`[n]\` is shown only when the user passed a new task argument; otherwise drop it.

## Inferring next step

| currentStage | progress condition | next step |
| --- | --- | --- |
| \`plan\` | not yet committed | "review the plan in \`flows/<slug>/plan.md\`, then say 'continue' to dispatch slice-builder" |
| \`build\` | strict mode, AC committed > 0, AC pending > 0 | "continue with AC-<next pending>" |
| \`build\` | soft mode, build.md exists | "review build evidence in \`flows/<slug>/build.md\`, then say 'continue' to enter review" |
| \`build\` | strict mode, all AC committed | "ready for review; say 'continue' to dispatch reviewer" |
| \`review\` | open block findings exist | "fix-only loop: dispatch slice-builder mode=fix-only against open ledger rows" |
| \`review\` | clear / warn-only convergence | "ready for ship; say 'continue' to dispatch ship" |
| \`ship\` | compound complete | "flow already shipped; new task or /cc-cancel" |

## Resume rules

1. **Triage is preserved.** A resumed flow keeps its \`acMode\`, \`complexity\`, and \`path\`. The user does not re-pick. If they want to change mode, the answer is "/cc-cancel and start fresh".
2. **Last-specialist context is restored** by reading \`flows/<slug>/<stage>.md\` (and \`decisions/<slug>.md\` if architect ran). The orchestrator does not summarise from memory; it re-reads the artifact.
3. **Time gate.** If the resume summary's "last touched" is >7 days ago, surface a warning ("flow is stale — verify scope still applies") but still allow resume.
4. **Sub-agent dispatch resumes from the same stage.** A build that was paused mid-RED for AC-3 resumes by dispatching slice-builder for AC-3, not by restarting AC-1.

## Common pitfalls

- Ignoring \`flow-state.json\` and starting fresh on every \`/cc\` invocation. That is the v8.0 bug; v8.1 partially fixed it; v8.2 makes it explicit via this skill.
- Re-running the triage gate on resume. The user already chose; respect the saved decision.
- Re-prompting the user for the slug ("which task?") when \`currentSlug\` is set. Read it from state.
- Treating \`/cc\` with no argument as an error. It is the canonical "continue" command.

## Worked example

\`\`\`
> /cc

Active flow: approval-page
─ Stage: build  (last touched 2 hours ago)
─ Triage: small/medium / acMode=soft
─ Progress: 2 of 3 conditions verified
─ Last specialist: slice-builder
─ Open findings: 0
─ Next step: continue with the third condition (tooltip on hover)

[r] Resume — continue from build
[s] Show — open flows/approval-page/build.md and pause
[c] Cancel — /cc-cancel and free the slot
\`\`\`

User: r

Orchestrator dispatches \`slice-builder\` against the third condition.
`;

const PLAN_AUTHORING = `---
name: plan-authoring
trigger: when writing or updating .cclaw/flows/<slug>/plan.md
---

# Skill: plan-authoring

Use this skill whenever you create or modify any \`.cclaw/flows/<slug>/plan.md\`.

## Rules

1. **Frontmatter is mandatory.** Every plan starts with the YAML block from \`.cclaw/lib/templates/plan.md\`. Required keys: \`slug\`, \`stage\`, \`status\`, \`ac\`, \`last_specialist\`, \`refines\`, \`shipped_at\`, \`ship_commit\`, \`review_iterations\`, \`security_flag\`.
2. **AC ids are sequential** starting at \`AC-1\`. They must match the AC table inside the body.
3. **Each AC is observable.** Verification line is mandatory. If you cannot write the verification, the AC is not real.
4. **The traceability block at the end** is rebuilt by \`commit-helper.mjs\`. Do not edit it by hand once a commit was recorded.
5. **Out-of-scope items** stay in the body. Do not let them leak into AC.

## When refining a shipped slug

- Quote at most one paragraph from \`.cclaw/flows/shipped/<old-slug>/plan.md\`.
- Set \`refines: <old-slug>\` in the new plan's frontmatter.
- Do not copy the shipped AC verbatim — write fresh AC for the refinement.

## What to refuse

- Plans without AC.
- Plans whose AC count exceeds 12 (split first).
- Plans that change scope between brainstormer and planner without going back to brainstormer.
`;

const AC_TRACEABILITY = `---
name: ac-traceability
trigger: when committing changes for an active cclaw run with ac_mode=strict
---

# Skill: ac-traceability

This skill applies only when the active flow's \`ac_mode\` is \`strict\` (set at the triage gate for large-risky / security-flagged work). In \`inline\` and \`soft\` modes the commit-helper still runs but does not enforce the AC↔commit chain — see \`triage-gate.md\` for what each mode does.

In \`strict\` mode, cclaw has one mandatory gate: every commit produced inside \`/cc\` references exactly one AC, and the AC ↔ commit chain is recorded in \`flow-state.json\`.

## Rules (strict mode)

1. Use \`node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="..."\` for every AC commit. Do not call \`git commit\` directly.
2. Stage only AC-related changes before invoking the hook.
3. The hook will refuse the commit if:
   - \`AC-N\` is not declared in the active plan;
   - \`flow-state.json\` schemaVersion is not the current cclaw schema;
   - nothing is staged.
4. After the commit succeeds, the hook records the SHA in \`flow-state.json\` under the matching AC and re-renders the traceability block in \`flows/<slug>/plan.md\`.
5. \`runCompoundAndShip\` refuses to ship a strict-mode slug with any pending AC. There is no override.

## In soft / inline modes

- The commit-helper is **advisory**, not blocking. It is fine to run plain \`git commit\` for soft-mode flows.
- A soft-mode plan has bullet-list testable conditions, not numbered AC IDs. There is no \`AC-N\` to reference.
- A single TDD cycle covers the whole feature; you do not run RED → GREEN → REFACTOR per condition.
- Ship gate is a single check ("all listed conditions verified"), not an AC-by-AC ledger.

## When you accidentally committed without the hook (strict mode only)

- \`flow-state.json\` is now out of sync with the working tree.
- Edit \`.cclaw/state/flow-state.json\` by hand to add the SHA to the matching AC entry and verify with the orchestrator before continuing. Do not run the hook with an empty stage to "patch" the state — the hook refuses empty stages by design.
`;

const REFINEMENT = `---
name: refinement
trigger: when /cc detects an existing plan (active or shipped) for the new task
---

# Skill: refinement

\`/cc\` performs existing-plan detection at the start of every invocation. When it finds a fuzzy match, the user is asked to choose one of:

- **amend** — keep the active plan, add new AC, leave already-committed AC intact;
- **rewrite** — replace the active plan body and AC entirely (commits remain in git, but AC ids restart);
- **refine shipped** — create a new plan with \`refines: <old-slug>\` linking to the shipped slug;
- **new** — start an unrelated plan.

## Rules for refinement

1. \`refines: <old-slug>\` is set in the new plan's frontmatter and must match a real shipped slug.
2. Do not move artifacts out of \`.cclaw/flows/shipped/\`. The shipped slug stays read-only.
3. The new plan can quote up to one paragraph from the shipped plan but must restate the full Context for the refinement.
4. AC ids restart at AC-1 in the new plan. Do not number "AC-13" because the shipped slug had 12 AC.
5. \`knowledge.jsonl\` will record the new entry with \`refines: <old-slug>\` so the index forms a chain.

## What the orchestrator surfaces

- last_specialist of the active plan, so the user can see "stopped at architect" or "review iteration 3 in progress".
- The AC table with their statuses (\`pending\` / \`committed\`).
- Whether \`security_flag\` was set.
- A direct link to \`.cclaw/flows/shipped/<slug>/manifest.md\` if the match is a shipped slug.
`;

const PARALLEL_BUILD = `---
name: parallel-build
trigger: when planner topology = parallel-build
---

# Skill: parallel-build

\`parallel-build\` is the only parallelism allowed during build. It is opt-in. The orchestrator never picks it without planner naming it explicitly in \`plans/<slug>.md\` Topology section.

## Pre-conditions (all must hold)

1. **≥4 AC** in the plan.
2. **≥2 distinct touchSurface clusters** — there is at least one pair of AC whose \`touchSurface\` arrays are completely disjoint.
3. Every AC in a parallel wave carries \`parallelSafe: true\`.
4. No AC depends on outputs of another AC in the same wave.

For ≤4 AC the orchestrator picks \`inline\` even when AC look "parallelSafe". The git-worktree + sub-agent dispatch overhead is not worth saving 1-2 AC of wall-clock.

## Slice = 1+ AC with shared touchSurface

A **slice** is one or more AC whose \`touchSurface\` arrays intersect. AC with disjoint touchSurfaces go into different slices; AC with overlapping touchSurfaces stay in the **same** slice (run sequentially inside it). Each slice is owned by exactly one slice-builder sub-agent.

## Hard cap: 5 parallel slices per wave

If the slug produces more than 5 slices, **merge the thinner slices into fatter ones** (group AC by adjacent files / shared module) until you have ≤5. **Do not generate "wave 2", "wave 3", etc.** If after merging you still have >5 slices, the slug is too large — split it into multiple slugs.

This 5-slice cap is the v7-era constraint we kept on purpose:

- orchestration cost grows non-linearly past 5 sub-agents (context shuffling, integration review, conflict surface);
- 5 fits comfortably under the harness sub-agent quota everywhere we tested (Claude Code, Cursor, OpenCode, Codex);
- larger fan-outs reliably produce more integration findings than wall-clock saved.

## Execution

1. Orchestrator reads \`plans/<slug>.md\` Topology section, extracts the slice list (max 5).
2. For each slice, dispatch one \`slice-builder\` sub-agent. Pass:
   - the slice id,
   - the AC ids it owns,
   - the slice's \`touchSurface\` (the only paths the slice may modify),
   - the worktree path (see below).
3. Each slice-builder runs the full TDD cycle (RED → GREEN → REFACTOR) for every AC it owns, sequentially inside the slice, in its own working tree.
4. After all slice-builders return, the orchestrator invokes \`reviewer\` in mode \`integration\` (separate sub-agent if the harness supports it; inline otherwise). Integration reviewer checks path conflicts, double-edits, the AC↔commit chain across all slices, and integration tests covering the slice boundary.
5. If integration finds problems, the orchestrator dispatches \`slice-builder\` in \`fix-only\` mode against the cited file:line refs.

## Git-worktree pattern (when harness supports sub-agent dispatch)

Each parallel slice runs in its own \`git worktree\` rooted at \`.cclaw/worktrees/<slug>-<slice-id>/\`:

\`\`\`bash
$ git worktree add .cclaw/worktrees/<slug>-slice-1 -b cclaw/<slug>/slice-1
$ git worktree add .cclaw/worktrees/<slug>-slice-2 -b cclaw/<slug>/slice-2
$ git worktree add .cclaw/worktrees/<slug>-slice-3 -b cclaw/<slug>/slice-3
\`\`\`

Each slice-builder sub-agent runs with its worktree path as cwd. After all slices finish:

1. Integration reviewer reads from each worktree's branch.
2. The orchestrator merges \`cclaw/<slug>/slice-N\` into the main branch one slice at a time (or fast-forward if the wave was clean).
3. \`git worktree remove .cclaw/worktrees/<slug>-slice-N\` per slice; the cclaw branches stay until ship.

## Fallback: inline-sequential when sub-agent dispatch is unavailable

If the harness does not support sub-agent dispatch (or worktree creation fails — non-git repo, permission denied, etc.), \`parallel-build\` **degrades silently to \`inline\`** and runs all slices sequentially in the main working tree. The orchestrator records the fallback in \`builds/<slug>.md\`:

\`\`\`markdown
> Topology was \`parallel-build\` but the harness does not support sub-agent dispatch (or worktree creation failed). Slices ran sequentially in the main working tree.
\`\`\`

This degradation is not an error and does not reduce review depth.

## Hard rules

- \`integration\` mode reviewer is mandatory after every parallel wave. No shortcut.
- Slice-builders never read each other's worktrees mid-flight.
- A slice-builder that detects a conflict with another slice stops and raises an integration finding instead of hand-merging.
- More than 5 parallel slices is forbidden. Merge or split.
`;

const SECURITY_REVIEW = `---
name: security-review
trigger: when the diff touches authn / authz / secrets / supply chain / data exposure
---

# Skill: security-review

The orchestrator dispatches \`security-reviewer\` automatically when the active task or diff touches sensitive surfaces. You can also invoke it explicitly with \`/cc <task> --security-review\`.

## Rules

1. \`security-reviewer\` is a separate specialist from \`reviewer\`. They can run in parallel against the same diff.
2. \`security-reviewer\` decisions of severity \`security\` are block-level: ship is blocked until they are resolved by slice-builder mode=fix-only and the security review reruns clear.
3. \`security_flag: true\` in plan frontmatter triggers the compound learning gate even if no other quality signal is present.

## Threat-model checklist (mandatory)

For every \`threat-model\` invocation, write \`ok\` / \`flag\` / \`n/a\` for each:

1. Authentication
2. Authorization
3. Secrets (committed credentials, env, signing keys)
4. Supply chain (new third-party deps, version pinning, provenance)
5. Data exposure (logging, transmission, storage of user data)

## Pure UI / docs diffs

State explicitly that all five items are \`n/a\` and write a one-line justification per item. Do not skip the checklist.
`;

const REVIEW_LOOP = `---
name: review-loop
trigger: when reviewer or security-reviewer is invoked
---

# Skill: review-loop

Review is a producer ↔ critic loop, not a single pass. Iteration N proposes findings; \`slice-builder\` (in \`fix-only\` mode) closes them; iteration N+1 re-checks. The loop ends only when one of three convergence signals fires (see "Convergence detector" below). This is the cclaw analogue of the Karpathy "Ralph loop": short cycles, an explicit ledger, and hard rules for when to stop.

Every iteration runs the **Five Failure Modes** checklist:

1. Hallucinated actions
2. Scope creep
3. Cascading errors
4. Context loss
5. Tool misuse

For each mode the reviewer answers yes/no with a citation when "yes". A "yes" without a citation is itself a finding (you cited nothing, that is the finding).

## Concern Ledger

Every \`reviews/<slug>.md\` carries an append-only ledger. Each row is a single finding; rows are never edited or deleted, only appended.

\`\`\`markdown
## Concern Ledger

| ID | Opened in | Mode | Axis | Severity | Status | Closed in | Citation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-1 | 1 | code | correctness | required | closed | 2 | \`src/api/list.ts:14\` |
| F-2 | 2 | code | readability | consider | open | – | \`tests/integration/list.test.ts:31\` |
| F-3 | 1 | code | perf | nit | open | – | \`src/api/list.ts:88\` |
\`\`\`

Rules:

- **F-N** ids are stable and global per slug — never renumber. If a finding is superseded, append \`F-K supersedes F-J\` instead.
- **Axis** is one of \`correctness\` | \`readability\` | \`architecture\` | \`security\` | \`perf\`. Pick the dimension the finding speaks to; never blank.
- **Severity** is one of \`critical\` | \`required\` | \`consider\` | \`nit\` | \`fyi\`. Ship gate threshold depends on \`acMode\` (see below).
- **Status** is \`open\` | \`closed\`. A closed row records the iteration that closed it.
- **Citation** is a real \`file:line\` (or test id, or commit SHA). No prose-only findings — if you cannot cite, you do not have a finding yet.

When iteration N+1 runs, the reviewer reads the ledger first, re-validates each open row (still open? closed by a fix? superseded?), then appends new findings as F-(max+1). Closing a row requires a citation to the fix evidence (commit SHA, test name, or new file:line).

> Severity legacy note: cclaw 8.0–8.3 used \`block\` / \`warn\` / \`info\`. v8.4 maps these to the new five-tier scale on read: \`block → critical | required\` (use \`critical\` only when ship-breaking, otherwise \`required\`), \`warn → consider\`, \`info → fyi\`. Mark migrated rows with \`(migrated from <old-severity>)\` in citation the first time you re-read them.

## Five axes (mandatory walk per iteration)

Walk every diff with the five axes in mind. Per-axis checklist:

| axis | what to check | typical findings |
| --- | --- | --- |
| \`correctness\` | does the code match the AC verification line? edge cases? tests assert state, not interactions? | wrong branch, missing edge case, test passes for wrong reason, mocks-of-things-we-own |
| \`readability\` | clear names, control flow, no dead code, no unnecessary cleverness | unclear name, long fn, hidden side effect |
| \`architecture\` | pattern fit, coupling, abstraction level, diff size | new dep when stdlib works; cross-layer reach; \`>300 LOC\` for one logical change → split |
| \`security\` | pre-screen for surfaces handled deeper by \`security-reviewer\` | unsanitised input, secrets in logs, missing authn/authz, encoding mismatch |
| \`perf\` | hot-path quality | N+1, unbounded loop, sync-where-async, missing pagination |

A reviewer that records zero findings on every axis must explicitly say so in the iteration block ("Five-axis pass: no findings on any axis"); silence is not the same as a clean review.

## Severity ↔ acMode → ship gate

| acMode | open severity → blocks ship |
| --- | --- |
| \`strict\` | \`critical\` OR \`required\` |
| \`soft\` | \`critical\` only (\`required\` carries over) |
| \`inline\` | reviewer not invoked |

\`consider\` / \`nit\` / \`fyi\` never block ship. They carry over to \`ships/<slug>.md\` (and \`learnings/<slug>.md\` for \`consider\`) but do not delay ship.

## Convergence detector (acMode-aware)

The loop ends when ANY of these fires:

1. **All ledger rows closed.** Decision: \`clear\`.
2. **Two consecutive iterations append zero new blocking findings AND every open row is non-blocking.** Decision: \`clear\` with non-blocking carry-over to \`ships/<slug>.md\` and \`learnings/<slug>.md\`. "Blocking" depends on acMode (see table above).
3. **Hard cap reached** (5 iterations) with at least one open blocking row remaining. Decision: \`cap-reached\`. Stop; surface to user.

Tie-breaker: if iteration 5 closes the last blocking row, return \`clear\` (signal #1) even though the cap was hit. The cap exists to bound runaway loops, not to punish a slug that converges on the last attempt.

## Hard cap

- 5 review iterations per slug. After the 5th, the reviewer writes \`status: cap-reached\` and stops.
- The orchestrator surfaces every remaining open ledger row and recommends \`/cc-cancel\` (split into a fresh slug) or \`accept-and-ship\` (only valid if every remaining open row is non-blocking under the active acMode).

## Decision values

- \`block\` — at least one ledger row is blocking under the active acMode + open. \`slice-builder\` (mode=fix-only) must run next; then re-review.
- \`warn\` — open rows exist, all non-blocking, convergence detector signal #2 has fired. Ship may proceed; carry-over.
- \`clear\` — signal #1 (all closed) OR signal #2 (non-blocking convergence). Ready for ship.
- \`cap-reached\` — signal #3 fired with at least one open blocking row remaining.

## Worked example — three-iteration convergence (strict mode)

\`\`\`markdown
## Iteration 1 — code — 2026-04-18T10:14Z

Five-axis pass:
- correctness: F-1 (missing pagination cursor).
- readability: no findings.
- architecture: no findings.
- security: no findings.
- perf: F-2 (no negative test for empty page; potential N+1 if cursor regressed).

Findings:
- F-1 correctness/required — \`src/api/list.ts:14\` — missing pagination cursor.
- F-2 perf/consider — \`tests/integration/list.test.ts:31\` — no negative test for empty page.

Decision: block (F-1 is required-severity in strict). slice-builder (mode=fix-only) invoked next.

## Iteration 2 — code — 2026-04-18T10:39Z

Ledger reread:
- F-1: closed — fix at \`src/api/list.ts:18\` (commit 7a91ab2). Citation matches.
- F-2: open — no fix attempted (consider carry-over).

Five-axis pass: no new findings on any axis.

Decision: warn. Convergence signal #2 needs another zero-blocking iteration.

## Iteration 3 — code — 2026-04-18T11:02Z

Ledger reread:
- F-1: closed (sticky).
- F-2: open (consider carry-over).

Five-axis pass: no findings. Two consecutive zero-blocking iterations recorded.

Decision: clear (signal #2). F-2 carries to ships/<slug>.md and learnings/<slug>.md.
\`\`\`

## Common pitfalls

- Adding "implicit" findings without citations because "the reviewer can see it". The reviewer cannot. Cite \`file:line\` or do not record the finding.
- Renumbering F-N ids when an old finding is superseded. Append a new row \`F-K supersedes F-J\`; never rewrite history.
- Closing a row without a fix citation. Closing is itself a claim — record the SHA / test name / file:line that proves the fix.
- Treating "no new findings" as instant clear. The convergence detector requires *two* consecutive zero-blocking iterations; one is not enough.
- Skipping the convergence check and looping until cap. The detector exists so easy slugs ship fast; do not waste budget.
- Mixing \`code\` and \`text-review\` modes within one iteration. Each iteration declares one mode in its header.
- Recording a finding without an axis. Every row carries an axis (one of \`correctness\` / \`readability\` / \`architecture\` / \`security\` / \`perf\`). Pick the dimension the finding speaks to; never blank.
- Marking everything as \`required\` because "it might matter". Severity is graduated: \`critical\` for ship-breaking, \`required\` for must-fix-before-ship, \`consider\` for suggestion, \`nit\` for minor, \`fyi\` for context only. Padding severity makes it useless.
- Walking only one or two axes when the diff touches all five. The Five-axis pass is mandatory every iteration; record "no findings" for axes you walked but found clean. Silence is a smell — say what you walked.
`;

const COMMIT_MESSAGE_QUALITY = `---
name: commit-message-quality
trigger: before every commit-helper.mjs invocation
---

# Skill: commit-message-quality

\`commit-helper.mjs\` accepts any non-empty message, but the AC traceability chain only stays useful if the messages stay readable.

## Rules

1. **Imperative voice** — "Add StatusPill component", not "Added" or "Adding".
2. **Subject ≤72 characters** — long subjects truncate in \`git log --oneline\` and CI signals.
3. **Subject does not repeat the AC id** — the hook already appends \`refs: AC-N\`.
4. **Body when needed** — second-line blank, then a short rationale paragraph and any non-obvious context. Use \`--message\` for the subject; if the message must be multi-line, write it to a file and pass \`--file\`.
5. **Cite finding ids in fix commits** — \`fix: F-2 separate rejected token\`.

## Anti-patterns

- "WIP", "fixes", "stuff", "more". The reviewer rejects these as F-1 \`block\`.
- Subject lines that paraphrase the diff. Diff is the diff; the message is the why.
- Co-author trailers in solo commits.

## When to amend

Never amend a commit produced by \`commit-helper.mjs\` after the SHA is recorded in \`flow-state.json\`. Amend changes the SHA and breaks the AC chain. If the message is wrong, write a short note in \`builds/<slug>.md\` and move on; it is recoverable in review.
`;

const AC_QUALITY = `---
name: ac-quality
trigger: when authoring or reviewing AC entries
---

# Skill: ac-quality

Three checks per AC:

1. **Observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
2. **Independently committable** — a single commit covering only this AC is meaningful.
3. **Verifiable** — there is an explicit verification line (test name, manual step, or command).

## Smell check

| smell | example | rewrite |
| --- | --- | --- |
| sub-task | "implement the helper" | "search returns BM25-ranked results for queries with multiple terms" |
| vague verification | "tests pass" | "verified by tests/unit/search.test.ts: 'returns BM25-ranked hits'" |
| internal detail | "refactor the cache" | "cache hit rate >90% on the dashboard repaint scenario" |
| compound AC | "build the page and add analytics" | split into two AC |

## Numbering

- AC ids start at \`AC-1\` and are sequential.
- Refinement slugs restart at \`AC-1\` even when they refine a slug that had AC-1..AC-12.
- Do not reuse an AC id within the same slug; if you delete an AC, the remaining ids stay sequential after compaction.

## When to add an AC mid-flight

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a follow-up (\`/cc-idea\`) or a fresh slug.
`;

const REFACTOR_SAFETY = `---
name: refactor-safety
trigger: when the slug is identified as a pure refactor
---

# Skill: refactor-safety

Refactors must be **behaviour-preserving**. The harness enforces this with three structural rules.

## Pin behaviour first

Before any rewrite, identify the pin:

- existing tests that should pass with the same expected output;
- a snapshot or fixture set that should not change;
- a manual repro the user accepts as the contract.

If no pin exists, "add a pin" is AC-1 of the refactor.

## One refactor at a time

A refactor slug must contain refactor changes only. A bug fix that would have been "while we're here" is a separate slug. The pin from the refactor slug is then valid input for the fix slug.

## Public API discipline

If the refactor renames or restructures public exports:

- add a deprecation alias so external consumers still compile;
- mark the old name with a \`@deprecated\` JSDoc / equivalent;
- record the deprecation deadline in \`ships/<slug>.md\`.

If the project policy forbids deprecation aliases (some libraries), the refactor is breaking; \`security_flag\` does not apply but breaking-change handling does (see breaking-changes skill).

## Verification

Refactor AC verification is "no behavioural diff": tests pass, snapshots unchanged, fixtures unchanged. If anything changes, the refactor leaked behaviour and must be split.
`;

const TDD_CYCLE = `---
name: tdd-cycle
trigger: when stage=build (granularity depends on ac_mode — see below)
---

# Skill: tdd-cycle (RED → GREEN → REFACTOR)

build is a TDD stage. **What changes between modes is the granularity, not whether to write tests.**

| ac_mode | granularity | enforced by |
| --- | --- | --- |
| \`inline\` (trivial) | optional; one quick check is enough | nothing |
| \`soft\` (small/medium) | one TDD cycle per feature: write 1–3 tests that exercise the listed conditions, then implement | reviewer at \`/cc-review\` |
| \`strict\` (large-risky / security-flagged) | full RED → GREEN → REFACTOR per AC ID | \`commit-helper.mjs\` |

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

The Iron Law holds in every mode; only the *bookkeeping* differs. Skipping tests entirely is never the answer; loosening the per-AC ceremony is.

## The three phases

### RED — write a failing test

- Touch test files **only**. No production edits in the RED commit.
- The test must encode the AC verification line authored by planner.
- The test must fail for the **right reason** — the assertion that encodes the AC, not a syntax / import / fixture error.
- Capture the runner output that proves the failure (command + 1-3 line excerpt). This is the **watched-RED proof**.
- **Test files are named by the unit under test, NOT by the AC id.** Mirror the production module path: \`src/lib/permissions.ts\` → \`tests/unit/permissions.test.ts\` (or whatever the project's convention is — \`*.spec.ts\`, \`__tests__/*.ts\`, \`*_test.go\`, \`test_*.py\`). \`AC-1.test.ts\`, \`tests/AC-2.test.ts\`, \`spec/ac3.spec.ts\` are anti-patterns. The AC id lives **inside** the test name (\`it('AC-1: tooltip shows email …', …)\`), in the commit message (\`red(AC-1): …\`), and in the build log — never in the filename.
- Commit: \`commit-helper.mjs --ac=AC-N --phase=red --message="red(AC-N): …"\`.

### GREEN — minimal production change

- Smallest possible production diff that turns RED into PASS.
- Run the **affected-test suite first** (test impact analysis), not the full suite — fast feedback. The affected tests are: tests in the test directory mirroring the modified production module path PLUS tests that import the modified module directly. Tools: \`vitest related <file>\`, \`jest --findRelatedTests <file>\`, \`pytest --testmon\` if available, or a manual \`grep\` for imports + the mirrored test file.
- After affected tests pass, run the **full relevant suite** as the safety net before commit. A passing single test with the suite broken elsewhere is a regression, not GREEN.
- Capture both: the affected-tests command + PASS summary, AND the full-suite command + PASS summary. The two together are the **GREEN evidence** in \`build.md\`.
- Touch only files declared in the plan. If a file outside the plan is required, **stop** and surface the conflict.
- Commit: \`commit-helper.mjs --ac=AC-N --phase=green --message="green(AC-N): …"\`.

Why two-stage: affected tests close the loop in seconds → fast iteration; full suite catches regressions impact analysis missed (test discovery is heuristic, not guaranteed). In tiny repos (<100 tests, <2s suite) the two stages collapse to one command — that is fine. In larger repos the difference is real wall-clock; affected-first matters.

### REFACTOR — mandatory pass

REFACTOR is **not optional**. Even when the GREEN diff feels minimal, you must consider rename / extract / inline / type-narrow / dedup / dead-code-removal.

After the refactor edits:

1. Run the **full relevant suite** (always, not just affected). REFACTOR is the safety net for "did my rename break a place I didn't expect"; affected-test analysis is by definition incomplete here because a renamed symbol may have changed which tests are affected.
2. The suite must pass with **identical expected output** (no behaviour change). Snapshot diffs are a refactor leak; if a snapshot moved, your "refactor" is a behaviour change in disguise.

If a refactor is warranted, apply it and commit:

\`commit-helper.mjs --ac=AC-N --phase=refactor --message="refactor(AC-N): …"\`.

If no refactor is warranted, say so **explicitly**:

\`commit-helper.mjs --ac=AC-N --phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"\`.

Silence fails the gate.

## Mandatory gates per AC

\`commit-helper\` enforces (a) ↔ (e) mechanically. The reviewer checks (b), (d), (f), (g) on iteration 1.

(a) **discovery_complete** — relevant tests / fixtures / helpers / commands cited.\n(b) **impact_check_complete** — affected callbacks / state / interfaces / contracts named.\n(c) **red_test_recorded** — failing test exists, watched-RED proof attached.\n(d) **red_fails_for_right_reason** — RED captured a real assertion failure.\n(e) **green_two_stage_suite** — affected-tests pass AND full relevant suite passes after GREEN. Both commands captured in build.md.\n(f) **refactor_run_or_skipped_with_reason** — REFACTOR ran (with FULL suite green afterward), or explicitly skipped with reason.\n(g) **traceable_to_plan** — commits reference plan AC ids and the plan's file set.\n(h) **commit_chain_intact** — RED + GREEN + REFACTOR SHAs (or skipped sentinel) recorded in flow-state.

## Vertical slicing — tracer bullets, never horizontal waves

**One test → one impl → repeat.** Even in strict mode, you do not write all RED tests for the slice and then all GREEN code. That horizontal pattern produces tests of *imagined* behaviour: the data shape you guessed, the function signature you guessed, the error message you guessed. The tests pass when behaviour breaks and fail when behaviour is fine.

The correct pattern is a tracer bullet per AC:

\`\`\`
WRONG (horizontal):
  RED:   AC-1 test, AC-2 test, AC-3 test
  GREEN: AC-1 impl, AC-2 impl, AC-3 impl

RIGHT (vertical / tracer bullet):
  AC-1: RED → GREEN → REFACTOR  (commit chain closes here)
  AC-2: RED → GREEN → REFACTOR  (next chain starts here, informed by what you learned in AC-1)
  AC-3: RED → GREEN → REFACTOR
\`\`\`

Each cycle informs the next. The AC-2 test is shaped by what the AC-1 implementation revealed about the real interface. \`commit-helper.mjs --phase=red\` for AC-2 will refuse if AC-1's chain isn't closed yet — that's the rail.

In soft mode the same principle applies at feature granularity: write 1–3 tests for the highest-priority condition, implement, then if more tests are needed for adjacent conditions, write them after you've seen the real shape of the GREEN code.

## Stop-the-line rule

When **anything** unexpected happens during build — a test fails for the wrong reason, the build breaks, a prior-green test starts failing, a hook rejects a commit — **stop adding code**. Do not push past the failure to "come back later". Errors compound: a wrong assumption in AC-1 makes AC-2 and AC-3 wrong.

Procedure:

1. Preserve evidence. Capture the failing command + 1–3 lines of output verbatim.
2. Reproduce in isolation. Run only the failing test to confirm it fails reliably.
3. Diagnose root cause. Trace the failing assertion back to a concrete cause (the actual cause, not the first plausible one). Cite the file:line in the build log.
4. Fix. The fix is a refactor of the GREEN code, a correction of the RED test (if it tested the wrong thing), or a new RED that captures the missed behaviour — never silent.
5. Re-run the **full relevant suite**. A passing single test is not GREEN if the suite is red elsewhere.
6. Resume the cycle from where you stopped, with the chain intact.

If the root cause cannot be identified in three attempts, surface a blocker to the orchestrator. Do not "make it work" by removing the test, weakening the assertion, or commenting out the failure.

## Prove-It pattern (bug fixes)

When the input is a bug fix, the order is non-negotiable:

1. **Write a failing test that reproduces the bug.** This is the watched-RED proof. If you cannot reproduce the bug with a test, you cannot fix it with confidence — go gather more context.
2. Confirm the test fails for the right reason — your test captured the bug, not a syntax / fixture / import error.
3. Fix the bug. Smallest possible production diff that turns the new test green.
4. Run the full relevant suite — the fix must not break adjacent behaviour.
5. Refactor.

Bug-fix RED commits use \`--phase=red\` like any other RED. The AC id is the user's bug-fix slug (e.g. \`AC-1: completing a task sets completedAt\`). In soft mode, the same five steps apply, just with one cycle for the whole fix and a plain \`git commit\`.

## Writing good tests (state, not interactions; DAMP, not DRY)

These rules apply equally to soft and strict modes. They make the difference between tests that survive a refactor and tests that have to be rewritten every time.

- **Test state, not interactions.** Assert on the *outcome* of the operation — return value, persisted record, observable side effect — not on which methods were called internally. \`expect(result).toEqual(...)\` is good; \`expect(db.query).toHaveBeenCalledWith(...)\` couples the test to the implementation.
- **DAMP over DRY in tests.** A test should read like a specification. Each test independently understandable beats a clever shared setup that reads well only after tracing helpers. Duplication in test code is acceptable when it makes each case independently readable.
- **Prefer real implementations over mocks.** The more your tests use real code, the more confidence they provide. Mock only what is genuinely outside your control (third-party APIs, time, randomness). Real > Fake (in-memory) > Stub (canned data) > Mock (interaction). Reach for the simplest level that gets the job done.
- **Test pyramid: small / medium / large.** Most tests should be small (single process, no I/O, milliseconds). A handful are medium (boundary tests, in-process integration, seconds). E2E / multi-machine tests stay reserved for critical paths only.

## Anti-patterns

- "The implementation is obvious, skipping RED." A-13 — gate fails immediately.
- "Single test green, didn't run the suite." A-14 — that's not GREEN; it's a regression.
- "Nothing to refactor, skipping silently." A-15 — emit the explicit \`--skipped\` commit with reason.
- "Stage everything with \`git add -A\`." A-16 — staged unrelated edits leak into the AC commit.
- "Production code in the RED commit." A-17 — RED is test files only.
- **"Test file named after the AC id" — \`AC-1.test.ts\`, \`tests/AC-2.spec.ts\`, etc.** The reviewer flags this as \`block\`. Mirror the unit under test in the filename; carry the AC id inside the test name and commit message only.
- **Horizontal slicing.** A-18 — writing all RED tests first, then all GREEN code, produces tests of imagined behaviour. One test → one impl → repeat. See the Vertical Slicing section above.
- **Pushing past a failing test.** A-19 — the next cycle is built on the previous cycle's invariants; if those invariants are broken you are debugging a stack of broken assumptions. Stop the line, root-cause, then resume.
- **Mocking what you should not mock.** A-20 — mocking the database for a query test reads green and breaks in production. Use a fake or a real test DB; mock only what is genuinely outside your control.

## Fix-only flow

When reviewer returns \`block\`, the same TDD cycle applies to the fix:

- F-N changes observable behaviour → new RED test that encodes the corrected behaviour, then GREEN, then REFACTOR.
- F-N is purely a refactor → commit under \`--phase=refactor\`.
- F-N is a docs / log / config nit → commit under \`--phase=refactor\` or \`--phase=refactor --skipped\`.

The AC id stays the same; commit messages cite \`F-N\`.

## When TDD does not apply

The single exception is **bootstrap of the test framework itself** — a slug whose AC-1 is "test framework installed and one passing example test exists". In that case the orchestrator must mark the slug as \`build_profile: bootstrap\` in plan frontmatter, and \`commit-helper\` accepts the GREEN commit without a prior RED for AC-1 only. Every subsequent AC and every other slug uses the full cycle.
`;

const BREAKING_CHANGES = `---
name: breaking-changes
trigger: when the diff modifies public API surface or persisted contracts
---

# Skill: breaking-changes

A change is breaking when:

- a public export is renamed, removed, or changes signature;
- a CLI flag is renamed or removed;
- a wire format (HTTP, RPC, queue payload) changes shape or required fields;
- a persisted contract (DB schema, file format, env var) changes in a way that requires migration.

## Rules

1. **Plan must declare it.** Set \`breaking_change: true\` (or note it explicitly in the plan body).
2. **Migration must exist.** \`ships/<slug>.md\` carries a migration section: who is affected, what they need to do, when the old path stops working.
3. **Deprecation window.** Public libraries — at least one minor version. Internal services — at least one deploy cycle and one alert.
4. **Release notes.** The CHANGELOG line must start with \`BREAKING:\` and link to the migration section.

## Coexistence

When possible, ship the new path alongside the old. Examples:

- new endpoint path next to the old one;
- new column added before the old one is dropped;
- new env var name accepted along with the old (with a deprecation log line);
- new function exported with the new name; old name aliased to it.

Coexistence is not always possible (e.g. wire-format changes for older clients you cannot upgrade). When it is not possible, surface this back to architect; the decision must be recorded in \`decisions/<slug>.md\`.

## Common pitfalls

- "Internal API, not breaking." If the change crosses a service boundary, treat it as breaking.
- Renaming a CLI flag without an alias. Aliases for CLI flags are nearly always free; add them.
- Skipping the CHANGELOG line because "everyone knows". They do not.
- Forgetting the alert window for internal services. The deploy cycle is not enough; users need a heads-up.
`;

const CONVERSATION_LANGUAGE = `---
name: conversation-language
trigger: always-on
---

# Skill: conversation-language

cclaw is a harness tool. The harness has one user; the user has one language. Your conversational output must be in that language. Detect it from the user's most recent message and stay in it for the remainder of the turn.

## What MUST stay in the user's language

Everything that the user reads as prose:

- Status updates ("starting plan", "RED for AC-2 looks good").
- Questions you ask the user.
- Clarifications, recommendations, summaries, recaps.
- Error explanations and recovery suggestions.
- Diff explanations during review iterations.

If the user wrote to you in Russian, your status updates are in Russian. If the user wrote in Ukrainian, your status updates are in Ukrainian. If the user mixed languages, follow their dominant language; if there is no dominant language, mirror the language of their final paragraph.

Do NOT translate during the same conversation. The user has already chosen their language; restating the same point in English is noise.

## What MUST NOT be translated

Mechanical tokens stay in their original form regardless of conversation language:

- File paths (\`.cclaw/flows/<slug>/plan.md\`).
- AC ids (\`AC-1\`, \`AC-2\`).
- Decision ids (\`D-1\`, \`D-2\`).
- Slugs (\`add-approval-page\`, never "добавить-страницу-одобрения").
- Commands and CLI flags (\`/cc\`, \`--phase=red\`, \`commit-helper.mjs\`).
- Hook output and machine-readable JSON.
- Specialist names (\`brainstormer\`, \`architect\`, \`planner\`, \`reviewer\`, \`security-reviewer\`, \`slice-builder\`).
- Mode names (\`code\`, \`text-review\`, \`integration\`, \`release\`, \`adversarial\`, \`fix-only\`).
- Frontmatter keys (\`slug\`, \`stage\`, \`status\`, \`ac\`, \`phases\`).
- Stage names (\`plan\`, \`build\`, \`review\`, \`ship\`).
- TDD phase names (\`red\`, \`green\`, \`refactor\`).

These tokens are the wire protocol of cclaw. Translating them breaks tool calls, AC matching, frontmatter parsing, and the commit-helper hook. They are identifiers, not vocabulary.

## What MAY be in either language

Artifact bodies (the prose inside \`plans/<slug>.md\`, \`builds/<slug>.md\`, \`reviews/<slug>.md\`, \`ships/<slug>.md\`, \`decisions/<slug>.md\`, \`learnings/<slug>.md\`).

Default rule: write the artifact body in the same language as the user's conversation, because the artifact is for them and for the next agent who reads their notes. The frontmatter stays English (it is the wire protocol).

If the user explicitly asks for English-only artifacts ("write the plan in English so the rest of the team can read it"), honour the request. Otherwise stay in their language.

Commit messages: the AC line stays English (\`AC-N: …\`); the rest of the message body may follow the artifact-body language.

## Worked example — Russian conversation

User: "сделай мне CLI клиент для нашего REST API"

You (status): "Стартую план \`api-cli\`. Подтягиваю pattern \`api-endpoint.md\`. Пять AC: list, get, create, update, delete. Подтверждаешь?"

You (artifact \`flows/api-cli/plan.md\`):

\`\`\`markdown
---
slug: api-cli
stage: plan
status: active
ac:
  - id: AC-1
    text: list команда вызывает GET /resources и печатает таблицу.
    status: pending
---

# api-cli

…
\`\`\`

Note: slug stays \`api-cli\` (English, kebab-case); AC ids stay \`AC-1\` (English); frontmatter keys stay English; the AC body is in Russian.

You (commit message): \`AC-1: добавлен list-команд via fetch\`. The \`AC-1:\` prefix is English (commit-helper requires it); the message body is Russian.

## Common pitfalls

- Translating slugs ("добавить-cli" instead of "add-cli"). Slugs are filenames; keep them ASCII kebab-case.
- Translating frontmatter keys (\`статус: активен\`). Frontmatter is parsed by code; keys must be English.
- Restating the same status update twice ("Старт. — Starting."). Pick one. Match the user.
- Switching to English when the answer is "complicated". The user's complexity tolerance is not your language tolerance.
- Translating commit-helper output (\`[ошибка]\`). Hook output is read by the harness; leave it in English. Your own commentary on top of the hook output may be in the user's language.

## How to detect language

1. Read the user's last message. If it has at least one full sentence in language X, X is the language.
2. If the user mixed languages within one message, count tokens; pick the language with the most non-stopword tokens.
3. If still tied, default to the language of their previous-but-one message.
4. If there is no usable history (first turn, terse prompt), default to English. Do not guess from one ambiguous word.
`;

const ANTI_SLOP = `---
name: anti-slop
trigger: always-on for any code-modifying step (slice-builder, fix-only, recovery)
---

# Skill: anti-slop

cclaw takes its lean ethos seriously: **no busywork, no fake fixes, no fake progress.** This skill applies whenever you are writing code, modifying tests, debugging a build/lint/test failure, or running verification commands.

## Two iron rules

### 1. No redundant verification

Do not re-run the same build, test, or lint command twice in a row without a code or input change in between. The result will not change. If a check failed, change something — or stop and report the failure as a finding.

**What counts as a "change":**

- modified production source
- modified test file
- modified config / fixture / lockfile
- different argument set passed to the same tool (\`npm test\` → \`npm test -- --reporter=verbose --testNamePattern="AC-1"\` is OK; the same \`npm test\` twice is not)

**Red flags (do NOT do these):**

- "let me try the test again" without any edit
- "let me re-build" without any edit
- "let me re-lint" without any edit
- "let me check if the issue is still there" without any edit

If a tool succeeded once, do not run it a second time to "make sure". If it failed once, the second identical run will fail too.

### 2. No environment shims, no fake fixes

When a build / test / lint fails, **fix the root cause** or **surface the failure as a finding**. The following are anti-patterns; reviewer flags them as \`block\`:

- wrapping a real failure in \`try / catch\` and ignoring the error
- skipping a test (\`.skip\`, \`xit\`, \`@pytest.mark.skip\`, \`#[ignore]\`) "until later" without a follow-up issue or AC
- adding \`process.env.NODE_ENV === "test"\` (or equivalent) branches just to make tests pass
- adding \`// @ts-ignore\`, \`// eslint-disable\`, \`# noqa\`, \`# type: ignore\` to silence the failure rather than fix it
- short-circuiting a function with a hardcoded fixture value when "in test"
- mocking a function inline inside production code "just to get past this"
- writing a fallback that hides a real error path (\`return data ?? STUB_DATA\` where STUB_DATA exists only to dodge an upstream failure)
- copy-pasting a stack-trace into a try/catch as the "fix"

If the real fix is out of scope for the current AC, **stop**. Surface the failure and let the orchestrator hand the slug back to planner. Do not "make it work" with a shim and commit. Reviewer will catch the shim, the slug will fail review, and you will redo the work properly. Save the round-trip.

## When you are tempted to add a fallback

Ask yourself: *"what real failure is this fallback hiding?"* If the answer is "I don't know" or "the test was flaky", the fallback is slop. Find the real failure first.

## Worked example — slop vs root-cause

❌ slop:

\`\`\`ts
function getUser(id: string) {
  try {
    return db.users.find(id);
  } catch (e) {
    if (process.env.NODE_ENV === "test") return { id, name: "test-user" }; // makes the test pass
    throw e;
  }
}
\`\`\`

✅ root-cause:

\`\`\`ts
// (test fixture seeds a user before calling getUser; production code untouched)
beforeEach(async () => { await db.users.insert({ id: "u-1", name: "Anna" }); });
\`\`\`

## What to surface as a finding (and stop)

- **Root cause is in someone else's slug.** Surface as \`block\`: "AC-N depends on \`<file>\` which is owned by \`<other slug>\`. Cannot complete without the other slug shipping first."
- **Test framework is broken.** Surface as \`block\`: "test runner exits with \`<exact-error>\` independent of the test under change."
- **Plan is wrong.** Surface as \`info\`: "AC-N as written cannot be implemented without touching \`<file>\`, but the plan rules out that file."
- **Dependency upgrade required.** Surface as \`info\`: "AC-N requires \`<lib>@>=X\`, current is \`<Y>\`. Recommend separate dep-bump slug."

In all four cases: stop, return the summary JSON, do **not** push code that "works around it".

## What this skill does NOT prevent

- Re-running a build / test after you actually changed code. That is normal TDD GREEN-cycle behaviour.
- Adding a real test fixture or mock library at the test boundary (\`vi.mock("./db")\` in the *test file*, not in production). The boundary matters.
- Documented \`// eslint-disable\` lines with a one-line justification AND a follow-up issue id. The justification is what makes it not slop.
- Running \`tsc --noEmit\` after \`npm test\` — that is a different tool, not a re-run of the same one.
`;

const SOURCE_DRIVEN = `---
name: source-driven
trigger: when architect or planner is dispatched in strict mode AND the task is framework-specific
---

# Skill: source-driven

Framework-specific code (React hooks, Django views, Next.js routing, Prisma migrations, Tailwind utilities, etc.) must be **grounded in official documentation, not memory**. Training data goes stale: APIs deprecate, signatures change, recommended patterns evolve. Source-driven means: detect the stack, fetch the relevant doc page, implement against it, cite the URL.

## When this skill applies

| Triage | Stack signal | Apply? |
| --- | --- | --- |
| \`strict\` (large-risky / security-flagged) | framework-specific code in scope | **always** — required for architect / planner |
| \`soft\` (small-medium) | framework-specific code in scope | **opt-in** — enable when the user asks for "source-driven" or "verified" implementation |
| \`inline\` (trivial) | any | **never** — single-line edits don't need citations |
| any | pure logic (loops, data structures, internal helpers) | skip — correctness is version-independent |

The orchestrator passes \`source_driven: true\` in the dispatch envelope when it applies. Specialists honour the flag.

## The four-step process

\`\`\`
DETECT ──→ FETCH ──→ IMPLEMENT ──→ CITE
   │          │           │           │
   ▼          ▼           ▼           ▼
What       Get the     Follow the   Show the
stack +    relevant    documented   URL inline
versions?  page, not   patterns     in code +
           homepage                 in artifact
\`\`\`

### Step 1 — Detect stack and versions

Read the project's dependency file. Cite the file you read.

| Manifest | Versions to extract |
| --- | --- |
| \`package.json\` + lockfile | Node engines, framework dep version (React, Vue, Next.js, Express, etc.), test runner, linter |
| \`composer.json\` | PHP version, framework version (Symfony, Laravel) |
| \`pyproject.toml\` / \`requirements.txt\` | Python version, framework version (Django, Flask, FastAPI) |
| \`go.mod\` | Go version, framework version (gin, echo, chi) |
| \`Cargo.toml\` | Rust edition, crate version |
| \`Gemfile\` | Ruby version, framework version (Rails, Sinatra) |

Surface the result explicitly in the artifact:

\`\`\`text
STACK DETECTED:
- React 19.1.0 (from package.json)
- Vite 6.2.0 (from package.json)
- Tailwind CSS 4.0.3 (from package.json)
→ Fetching official docs for the patterns this slug needs.
\`\`\`

If a version is missing or ambiguous (e.g. \`"react": "^19.0.0"\`, lockfile pinned to a release-candidate), **ask the user once** before proceeding. Don't guess.

### Step 2 — Fetch official documentation

Fetch the **deep link** for the specific feature in scope. Not the homepage. Not the search result. Not "the React docs".

#### Cache lookup before fetch (mandatory)

cclaw keeps a local fetch cache at \`.cclaw/cache/sdd/<host>/<url-path>.{html,etag,last-modified}\`. The cache is gitignored and per-project. Behaviour:

\`\`\`
url = https://react.dev/reference/react/useActionState

cache key  = .cclaw/cache/sdd/react.dev/reference/react/useActionState

files:
  .cclaw/cache/sdd/react.dev/reference/react/useActionState.html
  .cclaw/cache/sdd/react.dev/reference/react/useActionState.etag           (optional)
  .cclaw/cache/sdd/react.dev/reference/react/useActionState.last-modified  (optional)
\`\`\`

For every URL you would fetch:

1. **Compute the cache key** from the URL host and path. Drop the query string only when it is purely tracking (utm_*, gclid, fbclid). Keep documentation-meaningful query like \`?v=18\` or \`#useActionState-with-form\` (anchors are part of the URL but never affect cache key — they are page-internal).
2. **Cache hit, no validators on disk:** if the \`.html\` file exists and is < 24h old, **use it directly**. No network. Do not refetch.
3. **Cache hit, validators present (any age):** issue a conditional GET with \`If-None-Match: <etag>\` and/or \`If-Modified-Since: <last-modified>\`. On \`304 Not Modified\`, use the cached body. On \`200\`, replace the cached body and validators atomically.
4. **Cache miss:** fetch normally. Save the response body to \`<key>.html\` and the validator headers to \`<key>.etag\` / \`<key>.last-modified\` if the response provided them. Set the file mtime to now (treated as the cache's "fetched_at").
5. **Network unavailable / 4xx / 5xx:** if a cached body exists, use it and add a \`stale-cache\` line to the artifact's \`sources:\` block. If no cached body, mark the citation \`UNVERIFIED\` and continue (see "UNVERIFIED marker" below).

The cache is a **per-project** courtesy, not a global mirror. Every project that uses cclaw has its own cache; the cache is also gitignored (a duplicate fetch from a teammate is a few hundred kB, not a real cost).

The harness's web-fetch tool (or \`user-context7\` MCP) is the network layer; cclaw layers the cache on top. When the harness has \`user-context7\`, the resolved doc URL is the cache key (Context7 returns canonical URLs).

Cite the cached file alongside the URL in the \`sources:\` block:

\`\`\`yaml
sources:
  - url: https://react.dev/reference/react/useActionState#usage
    used_for: AC-1 (form submission state pattern)
    fetched_at: 2026-05-08T22:45Z
    cache_path: .cclaw/cache/sdd/react.dev/reference/react/useActionState.html
    cache_status: hit-fresh   # one of: hit-fresh | hit-revalidated | miss-fetched | stale-cache
    version: react@19.1.0
\`\`\`

The reviewer treats \`cache_status: stale-cache\` as a finding (axis=correctness, severity=consider) — the user should confirm the doc is still current.

#### Source hierarchy

| Bad | Good |
| --- | --- |
| \`react.dev\` | \`react.dev/reference/react/useActionState#usage\` |
| "search Django auth" | \`docs.djangoproject.com/en/6.0/topics/auth/\` |
| StackOverflow answer | \`react.dev/blog/2024/12/05/react-19#actions\` |

#### Source hierarchy (in order of authority)

1. Official documentation for the detected version (\`react.dev\`, \`docs.djangoproject.com\`, \`symfony.com/doc\`).
2. Official blog / changelog (\`react.dev/blog\`, \`nextjs.org/blog\`).
3. Web standards (\`MDN\`, \`web.dev\`, \`html.spec.whatwg.org\`).
4. Browser/runtime compatibility (\`caniuse.com\`, \`node.green\`).

**Not authoritative** — do not cite as primary:

- Stack Overflow answers (community Q&A, not a spec).
- Blog posts or tutorials, even popular ones.
- AI-generated documentation summaries.
- Your own training data — that is the whole point.

If the detected version's docs disagree with an older blog post, the docs win. If two official sources conflict (e.g. migration guide vs. API reference), surface the conflict to the user; do not silently pick one.

### Step 3 — Implement following documented patterns

Match the API signatures and patterns in the doc page. If the docs deprecate a pattern, do not use the deprecated version.

When existing project code conflicts with current docs:

\`\`\`text
CONFLICT DETECTED:
The existing codebase uses \`useState\` for form loading state,
but React 19 docs recommend \`useActionState\` for this pattern.
(Source: https://react.dev/reference/react/useActionState)

Options:
A) Adopt the modern pattern (useActionState) — matches current docs.
B) Match existing code (useState) — keeps codebase consistent.
→ Which approach do you prefer?
\`\`\`

Do not silently adopt one. The user picks; the decision goes in \`decisions.md\` (architect mode) or in the plan body (planner mode).

### Step 4 — Cite sources inline

Every framework-specific decision gets a citation. The user must be able to verify every choice without trusting the agent's memory.

In **plan.md** / **decisions.md**, include a \`sources:\` block under the relevant AC or decision. Each entry includes the cache fields from Step 2 — they make the source-driven trail reproducible offline:

\`\`\`yaml
sources:
  - url: https://react.dev/reference/react/useActionState#usage
    used_for: AC-1 (form submission state pattern)
    fetched_at: 2026-05-08T22:45Z
    cache_path: .cclaw/cache/sdd/react.dev/reference/react/useActionState.html
    cache_status: miss-fetched
    version: react@19.1.0
  - url: https://react.dev/blog/2024/12/05/react-19#actions
    used_for: D-1 (rationale for picking useActionState over manual useState)
    fetched_at: 2026-05-08T22:46Z
    cache_path: .cclaw/cache/sdd/react.dev/blog/2024/12/05/react-19.html
    cache_status: hit-fresh
    version: react@19.x
\`\`\`

In **code comments**, cite the doc URL near the pattern:

\`\`\`typescript
// React 19 form handling with useActionState.
// Source: https://react.dev/reference/react/useActionState#usage
const [state, formAction, isPending] = useActionState(submitOrder, initialState);
\`\`\`

Citation rules:

- Full URLs, not shortened.
- Prefer deep links with anchors (\`/useActionState#usage\` over \`/useActionState\`).
- Quote the specific passage when it supports a non-obvious decision (e.g. "useTransition now supports async functions [...] to handle pending states automatically").
- Include browser/runtime support data when recommending platform features.

## UNVERIFIED marker (when docs are missing)

If you cannot find official documentation for a pattern (cclaw's \`user-context7\` MCP returns nothing, the framework has no public docs for the feature, etc.):

- Mark the AC / decision with \`unverified: true\` in frontmatter.
- Add an inline marker in the artifact body:

\`\`\`text
UNVERIFIED: I could not find official documentation for this pattern.
This is based on training data and may be outdated.
Verify before using in production.
\`\`\`

- The reviewer treats \`unverified: true\` as a finding (axis: correctness, severity: required) on iteration 1. Ship blocks until the user either confirms the pattern is intentional or surfaces a doc URL the agent can cite.

Honesty about what you couldn't verify is more valuable than confident guessing.

## Specialist contracts

- **planner** in \`source_driven\` envelope: every framework-specific AC carries a \`sources\` block (URL + which AC it supports + fetched timestamp + version). AC without a citation in framework code → reviewer F-N axis=correctness, severity=required.
- **architect** in \`source_driven\` envelope: every \`D-N\` whose decision rests on framework behaviour (rendering model, state management strategy, persistence pattern, security posture) carries a \`sources\` block. Architects without a citation surface "I could not find current documentation; this decision is based on training data" — explicit, not silent.
- **slice-builder** in \`source_driven\` envelope: pulls the URL from \`plan.md\` / \`decisions.md\` into the code comment when implementing the pattern. Does not independently re-fetch (architect/planner already did the work).
- **reviewer** runs the citation check as part of the \`correctness\` axis pass. Open finding when:
  - a framework-specific AC has no \`sources\` block;
  - a citation URL is to a non-authoritative source (Stack Overflow, blog, training data);
  - a citation is to a doc page for a different framework version than the one in the project.

## MCP integration (when the harness has \`user-context7\`)

cclaw recognises \`user-context7\` as the source-of-truth fetcher. When \`source_driven: true\` is in the envelope, the planner / architect SHOULD prefer:

1. \`mcp_user-context7_resolve-library-id\` to map a package name to a Context7 library id.
2. \`mcp_user-context7_get-library-docs\` to fetch the relevant docs at the detected version.

If the harness does not have \`user-context7\` (or the user disabled it), the specialist falls back to the harness's web-fetch tool (browser tool, fetch, curl) against the official docs URL — same source-hierarchy rules apply.

## Common pitfalls

- "I'm confident about this API" — confidence is not evidence. Verify.
- "Fetching docs wastes tokens" — hallucinating wastes more. One fetch prevents an hour of debugging the deprecated signature.
- "The docs won't have what I need" — if they don't, that is itself information; the pattern may not be officially recommended.
- "I'll just disclaim 'might be outdated'" — disclaimers don't help. Either verify and cite, or mark UNVERIFIED.
- "This task is simple, no need to check" — simple tasks become templates. The user copies your useState pattern into ten components before realising useActionState exists.
- Fetching the homepage instead of the deep link. Token waste with no signal.
- Citing the docs once but using the pattern from memory. The point of source-driven is you wrote what the doc said, not what you remembered the doc said.

## Verification checklist (reviewer uses this)

After implementing under \`source_driven\`:

- [ ] Stack and versions identified from a real manifest file (cited \`file:line\`).
- [ ] Official docs fetched for each framework-specific pattern (deep link, not homepage).
- [ ] No Stack Overflow / blog / training-data citations as primary sources.
- [ ] Code follows current-version patterns (no deprecated APIs).
- [ ] Non-trivial decisions include a \`sources\` block with full URL.
- [ ] Conflicts between docs and existing project code surfaced to the user.
- [ ] Anything unverifiable marked \`UNVERIFIED:\` explicitly.
`;

const SUMMARY_FORMAT = `---
name: summary-format
trigger: every authored cclaw artifact (plan.md, decisions.md, build.md, review.md, ship.md, learnings.md). Always-on for any specialist that writes one of those files.
---

# Skill: summary-format

Every cclaw artifact ends with a **standardised three-section Summary block**. The slim summary the specialist returns to the orchestrator stays terse (≤6 lines); the Summary block in the artifact is the **durable record** of what changed and what didn't.

The three-section shape is taken directly from the addyosmani-skills git-workflow standard: it surfaces scope creep and uncertainty *to the next reader*, instead of relying on memory or clean-up passes that never happen.

## Format

Append exactly this block to the bottom of the artifact you authored. Do not rename the headings, do not add other sections inside it, do not reorder them.

\`\`\`markdown
## Summary

### Changes made
- <one bullet per concrete change you committed to this artifact, in plain past tense>
- <e.g. "Added AC-3 covering the empty-permission fallback path">
- <e.g. "Recorded D-2 selecting in-process BM25; rejected vector store as out of scope">

### Things I noticed but didn't touch
- <one bullet per scope-adjacent issue you spotted but deliberately did NOT change>
- <e.g. "src/lib/permissions.ts:42 has a stale TODO that predates this slug">
- <e.g. "tests/unit/RequestCard.test.tsx mixes fixture data; outside touch surface">
- if there is nothing, write \`None.\` — explicit empty is correct, blank is wrong.

### Potential concerns
- <one bullet per uncertainty, missing input, or risk the next stage / next reader should weigh>
- <e.g. "AC-2 verification depends on a clock helper not yet imported in the test file">
- <e.g. "Migration step in D-1 may interact with the seed script — flagged for security-reviewer">
- if there is nothing, write \`None.\`.
\`\`\`

The block goes at the very bottom of the artifact, after the body, after any worked examples, after any prior-iteration material. One block per artifact write. Multi-author files (plan.md on large-risky) get **one Summary per author**, with a heading suffix:

\`\`\`markdown
## Summary — brainstormer
### Changes made
...
## Summary — architect
### Changes made
...
## Summary — planner
### Changes made
...
\`\`\`

This way the next reader sees who wrote what and can attribute the "Things I noticed" / "Potential concerns" to the right specialist.

## What goes in each section

### \`Changes made\`

Plain past-tense bullets. **Concrete**, not "implemented the plan". Each bullet is a thing a reviewer can verify in the diff or in the artifact. AC ids, D-N ids, F-N ids, file paths, commit shas — citations welcome.

### \`Things I noticed but didn't touch\`

This is the **anti-scope-creep section**. Force yourself to list the things you *chose not to fix while you were nearby*. Stale TODOs, unrelated bugs, sibling-file issues, tests that pass but feel wrong, dead code, mismatched naming.

The point is to **resist the urge to fix everything** — surface it here so the next slug owner can decide. A specialist that silently fixed sibling issues is a specialist that broke scope discipline; the reviewer flags that.

If the touch surface really was clean, write \`None.\` (one word + period). Do not invent items to fill the section.

### \`Potential concerns\`

Forward-looking. What might bite the **next stage** or **the user**? Uncertainties, partial coverage, untested edges, decisions you made under low confidence, dependencies on external systems, migration footguns.

Drop \`Confidence: low\` items here verbatim with a one-line cause. The reviewer can use this section to seed the Concern Ledger.

If there are no real concerns, write \`None.\` and own it.

## Hard rules

- **All three subheadings present.** Even when one is empty, the H3 heading + \`None.\` line stays. Skipping a subheading is a finding (reviewer axis=readability, severity=consider).
- **No prose paragraphs in the block.** Bullets only. The block is read fast; paragraphs are read slow.
- **No new findings here.** If you have a finding, surface it in the slim summary and (if reviewer) in the Concern Ledger. The Summary block is reflective, not active.
- **No fabrication.** \`Things I noticed but didn't touch\` is not the place to invent improvements you didn't actually consider; it is the place to record the ones you did.
- **No copy-paste between artifacts.** Each artifact's Summary block is unique to that artifact's authorship.

## Specialist contracts

| Specialist | Block goes in |
| --- | --- |
| \`brainstormer\` | \`flows/<slug>/plan.md\` (heading: \`## Summary — brainstormer\`) |
| \`architect\` | \`flows/<slug>/decisions.md\` (heading: \`## Summary\`); also \`flows/<slug>/plan.md\` Architecture subsection if you wrote one (heading: \`## Summary — architect\`) |
| \`planner\` | \`flows/<slug>/plan.md\` (heading: \`## Summary — planner\` on large-risky; \`## Summary\` on small/medium) |
| \`slice-builder\` | \`flows/<slug>/build.md\` (heading: \`## Summary\` per cycle in soft mode; per fix-iteration in fix-only mode; per slice in parallel-build) |
| \`reviewer\` | \`flows/<slug>/review.md\` per iteration (heading: \`## Summary — iteration N\`) — sits right above the next iteration block |
| \`security-reviewer\` | \`flows/<slug>/review.md\` security section (heading: \`## Summary — security\`) |
| ship synthesis | \`flows/<slug>/ship.md\` (heading: \`## Summary\`) |

## Common pitfalls

- Filling \`Changes made\` with implementation details copied from the body. The body is the body; the Summary is the executive view.
- Skipping \`Things I noticed but didn't touch\` because "I did everything that needed doing". This is the section that catches scope drift before it ships.
- Using \`Potential concerns\` as a TODO list. It is a risk register, not a backlog. Concrete, future-tense risks only.
- Multi-author plan.md getting one combined Summary at the end. Each author writes their own.

## Worked example — planner Summary on small/medium

\`\`\`markdown
## Summary

### Changes made
- Authored 3 AC covering the dashboard tooltip behaviour: AC-1 (renders email when permitted), AC-2 (250ms hover), AC-3 (display-name fallback).
- Pinned touch surface to 3 files: \`src/lib/permissions.ts\`, \`src/components/dashboard/RequestCard.tsx\`, \`tests/unit/RequestCard.test.tsx\`.
- Recorded prior lesson from \`shipped/dashboard-status-pill\` (verbatim quote in \`## Prior lessons applied\`).

### Things I noticed but didn't touch
- \`src/components/dashboard/RequestCard.tsx:140\` has a \`useMemo\` whose deps include \`Date.now()\` — re-renders every minute. Outside this slug's AC; flagging in case slice-builder or reviewer wants to surface as a follow-up.
- \`tests/unit/RequestCard.test.tsx\` uses ad-hoc fixtures instead of \`makeUserFixture()\`; same pattern as a prior shipped slug. Not in scope here.

### Potential concerns
- AC-1 verification depends on the \`hasViewEmail\` helper not yet existing; slice-builder will create it. RED test must fail because the export is missing, not because of an import error.
- The 250ms token in AC-2 lives in \`src/styles/tokens.css\`, not in JS. If slice-builder reads the value from JS state instead of the CSS token, AC-2 is a flake risk.
\`\`\`
`;

const DOCUMENTATION_AND_ADRS = `---
name: documentation-and-adrs
trigger: when architect picks tier=product-grade or tier=ideal AND a D-N introduces a public interface, persistence shape, security boundary, or new dependency; on ship, when an ADR with status=PROPOSED exists for the slug
---

# Skill: documentation-and-adrs

A repo-wide **Architecture Decision Record (ADR) catalogue** lives at \`docs/decisions/\`. ADRs outlive flows: \`decisions.md\` is per-slug and gets archived to \`shipped/<slug>/decisions.md\` after Hop 6, but ADRs are durable, repo-scoped, and indexed by sequential numbers. The catalogue is what new contributors and future agents read to understand **why** the codebase looks the way it does.

ADRs are NOT a replacement for per-slug \`decisions.md\` — they are the **promoted subset** that has cross-flow durability. Architect writes both: full \`D-N\` records in the slug's \`decisions.md\` (rationale, options, pre-mortem, refs); a thinner ADR pointing back to the slug for the long-term catalogue.

## When to write an ADR (not every D-N becomes one)

Write an ADR when **any** of these hold:

| Trigger | Why this needs durable record |
| --- | --- |
| New public interface (exported function, REST endpoint, schema, queue contract) | Future maintainers need to know why the shape was chosen |
| Persistence shape change (column type, index strategy, NoSQL doc layout) | Migrations and forks depend on this being explicit |
| Security boundary (authn/authz model, data classification, secret rotation) | Audits will ask "why" and the per-slug doc is gone in 6 months |
| New runtime dependency (npm/pip/go module added beyond test/build tooling) | Cost/maintenance trade-off was made; record it |
| Architectural pattern adopted or rejected (CQRS, event sourcing, monolith vs split) | Repeats every two years if not pinned |
| User-explicit \`/cc <task> --adr\` flag | The user wants a durable record |

Do **not** write an ADR for:

- Internal refactors with no public surface change.
- Bug fixes that preserve the public contract.
- Per-feature implementation choices that any other team could trivially redo (e.g. "which CSS class names to use for this badge").
- One-off scripts and benchmarks.

If in doubt: per-slug \`decisions.md\` is enough.

## File layout

\`\`\`
docs/
  decisions/
    README.md                        ← optional index; auto-generated or hand-curated
    ADR-0001-bm25-search-ranking.md
    ADR-0002-feature-flag-rollout-strategy.md
    ADR-0003-postgres-jsonb-vs-separate-table.md
    ...
\`\`\`

Numbering is **sequential**, zero-padded to 4 digits, and starts at 1. Numbers are never reused (even if an ADR is superseded). The slug in the filename mirrors the cclaw flow slug when there is one — that is how ADR ↔ slug ↔ \`decisions.md\` cross-reference each other.

## Lifecycle

\`\`\`
PROPOSED  ──→  ACCEPTED  ──→  (sometimes)  SUPERSEDED
   │                                          ▲
   │                                          │
   └─→ REJECTED (closed without action) ──────┘ (rarely)
\`\`\`

| Status | Who sets it | When |
| --- | --- | --- |
| \`PROPOSED\` | architect | At decision time, when the D-N triggers an ADR. The ADR ships with \`status: PROPOSED\` so reviewers can see the proposed-not-yet-accepted state. |
| \`ACCEPTED\` | orchestrator (Hop 6 finalize) | After the slug ships successfully (\`flows/<slug>/ship.md\` had \`status: shipped\`). The ADR is updated in place: \`status: ACCEPTED\`, plus an \`accepted_at: <iso>\` and the shipping \`commit:\` SHA. |
| \`SUPERSEDED\` | a future architect | When a later slug introduces a new ADR that replaces this one. The new ADR's \`Supersedes\` field cites the old ADR id; the old ADR is updated in place to \`SUPERSEDED\` with a \`superseded_by: ADR-NNNN\` line. |
| \`REJECTED\` | architect or user | When the slug is cancelled with \`/cc-cancel\` after the ADR was already proposed, or when the user explicitly says "we're not doing this". The ADR is kept (numbers don't get reused) with \`status: REJECTED\` and a one-line \`rejected_because\`. |

ADRs are never **deleted**. The whole point of the catalogue is that even abandoned decisions remain searchable.

## ADR template (architect writes this)

\`\`\`markdown
---
adr: ADR-NNNN
title: <short title in present tense, e.g. "Use BM25 for in-process search ranking">
status: PROPOSED
proposed_at: <iso-timestamp>
proposed_by_slug: <cclaw-slug-or-empty>
supersedes: <ADR-XXXX or empty>
superseded_by: <empty until superseded>
tags: [search, ranking, performance]
---

# ADR-NNNN — <title>

## Status

PROPOSED — proposed by cclaw slug \`<slug>\` on <date>. Will be promoted to ACCEPTED on successful ship; otherwise REJECTED.

## Context

<2-4 sentences. What forced this decision? Cite the slug's plan.md / decisions.md for the long form. Do not duplicate the rationale here.>

## Decision

<One paragraph. The chosen option, in present tense ("We use BM25..."). No rationale; the rationale lives in the slug's decisions.md.>

## Consequences

- **What becomes easier**: <one bullet>
- **What becomes harder**: <one bullet>
- **What we will revisit**: <one bullet, with a trigger condition>

## References

- cclaw slug: \`flows/<slug>/decisions.md#D-N\` (full rationale)
- Code: \`src/server/search/scoring.ts\` (primary touch site)
- External: <official docs URL if the decision rests on framework behaviour>
\`\`\`

The ADR is **deliberately thinner** than \`decisions.md\`. It is the executive summary — Status, Context, Decision, Consequences, References. Anyone who needs more reads the linked \`decisions.md\` (which lives in \`flows/shipped/<slug>/\` after Hop 6).

## Architect's contract

When architect picks tier=\`product-grade\` or \`ideal\` AND any \`D-N\` matches a "When to write an ADR" trigger:

1. Pick the next sequential ADR number. Read \`docs/decisions/\` to find the highest existing number.
2. Write \`docs/decisions/ADR-NNNN-<slug>.md\` from the template, status \`PROPOSED\`.
3. Add a line to the \`D-N\` Refs in the slug's \`decisions.md\`: \`ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)\`.
4. Mention the ADR id in the slim summary's \`What changed\` line.

Architect does **not** mark the ADR \`ACCEPTED\` themselves — that is the orchestrator's job after a successful ship.

## Orchestrator's contract — promotion at Hop 6

After Hop 5 (compound) and before / during Hop 6 (finalize):

1. Scan \`flows/<slug>/decisions.md\` for any \`ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)\` line.
2. For each found ADR file, edit in place:
   - \`status: PROPOSED\` → \`status: ACCEPTED\`
   - Add \`accepted_at: <iso-timestamp>\` after \`proposed_at\`
   - Add \`accepted_in_slug: <slug>\` (same as proposed_by_slug; explicit for grep)
   - Add \`accepted_at_commit: <ship-commit-sha>\` (the merge SHA the orchestrator just produced)
3. Commit the ADR promotion with message \`docs(adr-NNNN): promote to ACCEPTED via <slug>\`. This commit is **part of Hop 6**, alongside the \`git mv\` of flow artifacts to \`shipped/\`.

If the slug is cancelled (\`/cc-cancel\`) instead of shipped:

1. For each PROPOSED ADR tied to the slug, edit \`status: PROPOSED\` → \`status: REJECTED\`, add \`rejected_at: <iso>\`, add \`rejected_because: cancelled (no ship)\`.
2. Commit the ADR rejection with \`docs(adr-NNNN): mark REJECTED — slug <slug> cancelled\`.

## Supersession

When a later architect's decision **replaces** an earlier ADR's choice:

1. The new ADR is written normally, with \`supersedes: ADR-XXXX\` in its frontmatter.
2. After the new ADR's slug ships, Hop 6 also edits the **old** ADR in place: \`status: ACCEPTED\` → \`status: SUPERSEDED\`, add \`superseded_by: ADR-NNNN\`, add \`superseded_at: <iso>\`. The old ADR's body is **not** rewritten; the catalogue keeps history.

The reviewer (in \`text-review\` mode) flags any new ADR that proposes a decision contradicting an active ACCEPTED ADR but does not declare \`supersedes:\` — that is a logic gap, not an oversight.

## Reviewer's contract

In \`text-review\` mode (when ship.md is being reviewed pre-finalize), the reviewer:

- Verifies that every D-N in the slug's \`decisions.md\` that matches an "ADR trigger" has a corresponding \`docs/decisions/ADR-NNNN-<slug>.md\` file with status \`PROPOSED\`.
- Verifies that no ADR status was set to \`ACCEPTED\` by the architect (only orchestrator may do that).
- Flags missing ADRs as axis=architecture, severity=\`required\` in strict mode (\`consider\` in soft).

## Worked example

Slug \`bm25-ranking\` (large-risky, strict, tier=product-grade) ships with one D-N about BM25.

Architect writes \`flows/bm25-ranking/decisions.md\`:

\`\`\`markdown
## D-1 — Pick BM25 over plain TF for search ranking
- ...
- **Refs:** src/server/search/scoring.ts:1, AC-2, ADR: docs/decisions/ADR-0017-bm25-search-ranking.md (PROPOSED)
\`\`\`

Architect writes \`docs/decisions/ADR-0017-bm25-search-ranking.md\` with \`status: PROPOSED\`.

Slug ships successfully. Hop 6 runs:

1. \`git mv flows/bm25-ranking/* flows/shipped/bm25-ranking/\` (existing v8.5 behaviour).
2. Edit \`docs/decisions/ADR-0017-bm25-search-ranking.md\`: \`status: ACCEPTED\`, add \`accepted_at\`, \`accepted_at_commit\`.
3. \`git commit -m "docs(adr-0017): promote to ACCEPTED via bm25-ranking"\`.

Six months later, slug \`vector-search\` introduces ADR-0042 with \`supersedes: ADR-0017\`. After \`vector-search\` ships, Hop 6 also edits ADR-0017: \`status: ACCEPTED\` → \`status: SUPERSEDED\`, \`superseded_by: ADR-0042\`.

## Common pitfalls

- Writing an ADR for every \`D-N\`. The catalogue swamps the \`decisions/\` folder with internal trade-offs nobody else will care about. Use the trigger table.
- Putting full rationale in the ADR. The rationale lives in \`decisions.md\` (which is archived). The ADR is the executive summary.
- Architect setting \`status: ACCEPTED\` directly. Only the orchestrator does that, and only after a successful ship. Architect always proposes.
- Renumbering ADRs. Numbers are forever; even REJECTED ADRs keep their number (the gap is a feature: it tells you a decision was considered and dropped).
- Writing one ADR per file in the change. One ADR captures **the decision**, not the changes the decision implies.
- Forgetting to cite the slug. The ADR's \`References\` block must point to the slug's archived \`decisions.md\`. Without that link, the ADR is decontextualised in three months.

## Catalogue index (optional, useful)

If \`docs/decisions/README.md\` exists, the orchestrator appends one row per promoted/superseded ADR after Hop 6:

\`\`\`markdown
| ADR | Title | Status | Slug | Last update |
| --- | --- | --- | --- | --- |
| 0017 | Use BM25 for in-process search ranking | SUPERSEDED | bm25-ranking | 2026-11-12 |
| 0042 | Switch to vector search via pgvector | ACCEPTED | vector-search | 2026-11-12 |
\`\`\`

If the index does not exist, do not create it. The catalogue works fine as a flat folder; an index is a courtesy, not a requirement.
`;

export const AUTO_TRIGGER_SKILLS: AutoTriggerSkill[] = [
  {
    id: "triage-gate",
    fileName: "triage-gate.md",
    description: "Mandatory first step of every new /cc flow: classify complexity, propose acMode/path, ask user to confirm, persist the decision.",
    triggers: ["start:/cc"],
    body: TRIAGE_GATE
  },
  {
    id: "flow-resume",
    fileName: "flow-resume.md",
    description: "When /cc is invoked with no task or with an active flow, render a resume summary and let the user continue / show / cancel / start fresh.",
    triggers: ["start:/cc", "active-flow-detected"],
    body: FLOW_RESUME
  },
  {
    id: "pre-flight-assumptions",
    fileName: "pre-flight-assumptions.md",
    description: "Surface 3-7 default assumptions (stack, conventions, architecture defaults, out-of-scope) for the user to confirm before any specialist runs. Skipped on the inline path.",
    triggers: ["after:triage-gate", "before:first-dispatch"],
    body: PRE_FLIGHT_ASSUMPTIONS
  },
  {
    id: "plan-authoring",
    fileName: "plan-authoring.md",
    description: "Auto-applies whenever the agent edits .cclaw/flows/<slug>/plan.md.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "create:.cclaw/flows/*/plan.md"],
    body: PLAN_AUTHORING
  },
  {
    id: "ac-traceability",
    fileName: "ac-traceability.md",
    description: "Enforces commit-helper invocation and AC↔commit chain. Active only when ac_mode=strict; advisory in soft / inline modes.",
    triggers: ["before:git-commit", "before:git-push", "ac_mode:strict"],
    body: AC_TRACEABILITY
  },
  {
    id: "refinement",
    fileName: "refinement.md",
    description: "Activates when /cc detects an existing plan match.",
    triggers: ["existing-plan-detected"],
    body: REFINEMENT
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    description: "Rules and execution playbook for the parallel-build topology.",
    triggers: ["topology:parallel-build"],
    body: PARALLEL_BUILD
  },
  {
    id: "security-review",
    fileName: "security-review.md",
    description: "Activates when the diff touches sensitive surfaces.",
    triggers: ["security-flag:true", "diff:auth|secrets|supply-chain|pii"],
    body: SECURITY_REVIEW
  },
  {
    id: "review-loop",
    fileName: "review-loop.md",
    description: "Wraps every reviewer / security-reviewer invocation.",
    triggers: ["specialist:reviewer", "specialist:security-reviewer"],
    body: REVIEW_LOOP
  },
  {
    id: "tdd-cycle",
    fileName: "tdd-cycle.md",
    description: "Always-on whenever stage=build. Granularity scales with ac_mode: inline = optional, soft = one cycle per feature, strict = full RED → GREEN → REFACTOR per AC.",
    triggers: ["stage:build", "specialist:slice-builder"],
    body: TDD_CYCLE
  },
  {
    id: "commit-message-quality",
    fileName: "commit-message-quality.md",
    description: "Enforces commit-message conventions for commit-helper.mjs.",
    triggers: ["before:commit-helper"],
    body: COMMIT_MESSAGE_QUALITY
  },
  {
    id: "ac-quality",
    fileName: "ac-quality.md",
    description: "Three-check rubric for every AC entry; smell tests + numbering rules.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "specialist:planner", "specialist:reviewer:text-review"],
    body: AC_QUALITY
  },
  {
    id: "refactor-safety",
    fileName: "refactor-safety.md",
    description: "Behaviour-preservation rules for pure-refactor slugs.",
    triggers: ["task:refactor", "pattern:refactor"],
    body: REFACTOR_SAFETY
  },
  {
    id: "breaking-changes",
    fileName: "breaking-changes.md",
    description: "Detect and document breaking changes; coexistence rules and CHANGELOG template.",
    triggers: ["diff:public-api", "frontmatter:breaking_change=true"],
    body: BREAKING_CHANGES
  },
  {
    id: "conversation-language",
    fileName: "conversation-language.md",
    description: "Always-on policy: reply in the user's language; never translate paths, AC ids, slugs, hook output, or frontmatter keys.",
    triggers: ["always-on"],
    body: CONVERSATION_LANGUAGE
  },
  {
    id: "anti-slop",
    fileName: "anti-slop.md",
    description: "Always-on guard against redundant verification, env-specific shims, and silent skip-and-pass fixes.",
    triggers: ["always-on", "task:build", "task:fix-only", "task:recovery"],
    body: ANTI_SLOP
  },
  {
    id: "source-driven",
    fileName: "source-driven.md",
    description: "Detect stack + versions from manifest, fetch official documentation deep-links, implement against documented patterns, cite URLs in plan/decisions/code. Default in strict mode for framework-specific work.",
    triggers: ["ac_mode:strict", "specialist:planner", "specialist:architect", "framework-specific-code-detected"],
    body: SOURCE_DRIVEN
  },
  {
    id: "summary-format",
    fileName: "summary-format.md",
    description: "Standard three-section ## Summary block (Changes made / Things I noticed but didn't touch / Potential concerns) appended to every authored artifact. Forces specialists to surface scope-creep candidates and forward-looking risks instead of silently fixing-while-nearby.",
    triggers: [
      "always-on",
      "edit:.cclaw/flows/*/plan.md",
      "edit:.cclaw/flows/*/decisions.md",
      "edit:.cclaw/flows/*/build.md",
      "edit:.cclaw/flows/*/review.md",
      "edit:.cclaw/flows/*/ship.md",
      "edit:.cclaw/flows/*/learnings.md"
    ],
    body: SUMMARY_FORMAT
  },
  {
    id: "documentation-and-adrs",
    fileName: "documentation-and-adrs.md",
    description: "Repo-wide ADR catalogue at docs/decisions/ADR-NNNN-<slug>.md. Architect proposes (PROPOSED); orchestrator promotes to ACCEPTED at Hop 6 after ship; supersession is in-place. Triggers on tier=product-grade or ideal when a D-N introduces a public interface, persistence shape, security boundary, or new dependency.",
    triggers: [
      "specialist:architect",
      "tier:product-grade",
      "tier:ideal",
      "stage:ship",
      "decision:public-interface",
      "decision:persistence-shape",
      "decision:security-boundary",
      "decision:new-dependency"
    ],
    body: DOCUMENTATION_AND_ADRS
  }
];
