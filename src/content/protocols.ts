import { RUNTIME_ROOT } from "../constants.js";

export const PROTOCOLS_REL_DIR = `${RUNTIME_ROOT}/references/protocols`;
export const DECISION_PROTOCOL_REL_PATH = `${PROTOCOLS_REL_DIR}/decision.md`;
export const COMPLETION_PROTOCOL_REL_PATH = `${PROTOCOLS_REL_DIR}/completion.md`;
export const ETHOS_PROTOCOL_REL_PATH = `${PROTOCOLS_REL_DIR}/ethos.md`;

export function decisionProtocolMarkdown(): string {
  return `# Decision Protocol

Shared format for decisions that require user confirmation.

## Core sequence

1. State the decision in one sentence.
2. Provide 2-4 labeled options (A, B, C...).
3. Mark one option as **recommended** with a short rationale.
4. Use the harness's structured-ask tool when available:
   - Claude: \`AskUserQuestion\` (up to ~4 options × multi-question).
   - Cursor: \`AskQuestion\` (≥2 options, multi-question, optional \`allow_multiple\`).
   - OpenCode: \`question\` tool (options + "type custom" fallback).
     Requires \`permission.question: "allow"\` in \`opencode.json\`; ACP
     clients additionally need \`OPENCODE_ENABLE_QUESTION_TOOL=1\`.
   - Codex: \`request_user_input\` (1-3 short questions; experimental,
     surfaced in Plan / Collaboration mode).
   - Fallback (any harness where the native tool is hidden, denied, or
     returns a schema error): a numbered / lettered plain-text list
     keeping the same Re-ground / Simplify / RECOMMENDATION / Options
     skeleton described below.
5. Wait for user choice before proceeding.

## Decision skeleton

Every Decision Protocol call — regardless of harness — follows this
four-part skeleton. Do not skip a part; if a part is trivially empty,
say so explicitly (e.g. "Re-ground: same branch, same task as prior
turn").

1. **Re-ground (1-2 sentences).** State the project, the active
   feature slug, the active stage (from \`flow-state.json\`), and the
   decision's plain-English context. Pull these values from the source
   of truth, not from conversation memory.
2. **Simplify (2-4 sentences).** Explain the choice in plain English a
   smart 16-year-old could follow. No internal jargon, no raw function
   names, no implementation trivia. Say what each option DOES and
   what changes for the user.
3. **Recommend.** One line of the form
   \`RECOMMENDATION: Choose [Letter] because [one-line reason]\`.
   Always prefer the more complete option unless an explicit constraint
   says otherwise (see Completeness calibration below). Never present
   options as equivalent when they are not.
4. **Options.** Lettered options \`A) ... B) ... C) ...\`. Each option
   includes one-line \`Completeness: X/10\` plus, when effort differs
   noticeably, a \`(human: ~Xh / agent: ~Ym)\` estimate.

## Completeness calibration

Use the same 1-10 scale for every option so comparisons stay honest:

- **10** = complete implementation: all stated edges handled,
  traceable to spec, no known deferred work.
- **7** = covers the happy path; one or two non-critical edges
  deferred with an explicit follow-up.
- **5** = partial; either drops edge cases silently or hands off
  required work to a future run.
- **3** = shortcut; skips spec criteria, violates an Iron Law, or
  defers significant work without tracking.
- **1** = acknowledged placeholder (\`TBD\`, \`TODO\`, "static for now").

Calibration rules:

- Mark any option at \`Completeness: ≤5\` and require the user to
  acknowledge the gap before picking it.
- If two options are both \`≥8\`, recommend the higher one.
- "Static for now" / "we will add later" phrasing always scores \`≤3\`
  and must be surfaced in Simplify, not buried in an option label.

## Ask format

- One question per call.
- Option labels are short and unambiguous; the full reasoning lives in
  Simplify + per-option Completeness.
- If tool schema fails once, fall back to plain text immediately but
  keep the skeleton (Re-ground / Simplify / RECOMMENDATION / lettered
  Options with Completeness scores).
- Log the chosen letter into the stage artifact's decision log with
  the Completeness score; do not rely on chat history.

## Retry and escalation

- Same tool fails twice -> stop using that tool in this interaction.
- Three tool failures in one stage -> pause and surface blocker to user.
- Same technical approach fails three times -> escalate with evidence and ask for direction.
`;
}

export function completionProtocolMarkdown(): string {
  return `# Stage Completion Protocol

Shared closeout sequence applied by every stage skill.

## Required order

1. Verify mandatory delegations are completed or explicitly waived.
2. Update \`.cclaw/state/flow-state.json\`:
   - mark passed gates,
   - clear blocked gates that are resolved,
   - update \`guardEvidence\`.
3. Persist stage artifact under \`.cclaw/artifacts/\`.
4. Run \`npx cclaw doctor\` and resolve failures.
5. **Capture through-flow learnings** — see the policy below. Knowledge
   accrues continuously across stages, not just at retro.
6. Notify user with stage completion and next action (\`/cc-next\`).
7. Stop; do not auto-run the next stage unless user asks.

## Through-flow knowledge capture

Knowledge is recorded **throughout the run**, not saved up for retro.
Each stage contributes a different kind of insight:

| Stage       | Typical \`type\`  | What to capture                                       |
|-------------|-----------------|-------------------------------------------------------|
| brainstorm  | \`lesson\`        | rejected framings and why (only when non-obvious)     |
| scope       | \`rule\`          | explicit out-of-scope boundaries worth remembering    |
| design      | \`pattern\`       | architectural trade-offs and their rationale          |
| spec        | \`rule\`          | non-negotiable acceptance criteria shape              |
| plan        | \`pattern\`       | effective decomposition / risk-ordering heuristics    |
| tdd         | \`pattern\`       | red→green→refactor cycle lessons, test-design notes   |
| review      | \`lesson\`        | recurring defects / blockers caught in this codebase  |
| ship        | \`lesson\`        | rollback triggers, preflight gotchas                  |
| retro       | \`compound\`      | process accelerators for the **next** run             |

Rules:

- Append 1–3 strict-schema JSONL lines to \`.cclaw/knowledge.jsonl\` per
  stage when that stage produced non-obvious decisions, patterns, or
  lessons. Obvious restatements of the checklist do not count.
- Use \`type=rule|pattern|lesson\` during stages; reserve \`type=compound\`
  for the retro step so the retro vs. through-flow signal stays
  distinguishable.
- Set \`origin_stage\` to the stage that emitted the entry and
  \`origin_feature\` to the active feature slug.

## Automatic learning capture policy

- \`standard\` / \`medium\` tracks: required for \`design\`, \`tdd\`, and \`review\`;
  recommended for other stages.
- \`quick\` track: recommended only (avoid overhead for tiny fixes).
- "No learning captured" is acceptable only when explicitly justified (e.g. pure
  mechanical change, no new trade-offs). Record the justification in the
  stage artifact, not in knowledge.jsonl.

## Resume protocol

On resume, if artifact exists but not all gates are passed:

1. Reconcile already-proven gates from artifact evidence.
2. Confirm unresolved gates with the user one at a time.
3. Update \`guardEvidence\` for each confirmed gate.
`;
}

export function ethosProtocolMarkdown(): string {
  return `# Engineering Ethos

Shared operating principles across all stages.

## 1) Boil the Lake

When the "complete version" costs only slightly more than a shortcut, prefer the
complete version. Do not leave obvious quality gaps for hypothetical follow-ups.

## 2) Search Before Building

Before adding new code/templates/rules:

1. Search existing artifacts/docs.
2. Search existing knowledge entries.
3. Search codebase for reusable implementations.
4. Prefer built-in/library primitives over custom helpers.

## 3) User Sovereignty

AI recommends. User decides. If your recommendation changes the user's stated
direction, ask first and wait for explicit approval.

## 4) Iron-Law Discipline

Every stage has a non-negotiable Iron Law. If a proposed action violates it,
stop and escalate via Decision Protocol instead of rationalizing exceptions.

## 5) Complete Before Ship

No release shortcuts:
- review verdict must be explicit,
- preflight evidence must be fresh,
- rollback must be written before finalization.

## 6) Compound, Don't Repeat

Knowledge is recorded **throughout** the run, not saved for the retro.
When a reusable lesson appears in design, plan, tdd, or review, append one
strict-schema JSONL entry to \`.cclaw/knowledge.jsonl\` using
\`type=rule|pattern|lesson\`. Reserve \`type=compound\` for post-ship retro.
Repeated lessons (frequency ≥ 3) are lifted into stable
rules/protocols/skills during the automatic compound pass so the same
class of mistake gets harder to repeat.

## Turn Announce Discipline

Keep orchestration visible without maintaining a dedicated preamble runtime log.

- Start substantial turns with a 1-2 sentence announce: current stage, intent, next action.
- Skip announce for trivial single-command actions.
- Never repeat boilerplate announces when the intent did not change.
- If plan or risk changes materially, post a fresh announce before executing.
`;
}
