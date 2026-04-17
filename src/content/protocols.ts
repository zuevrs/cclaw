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
4. Use harness question tools when available:
   - Claude: \`AskUserQuestion\`
   - Cursor: \`AskQuestion\`
   - OpenCode/Codex: plain text options
5. Wait for user choice before proceeding.

## Ask format

- One question per call.
- Option labels are short and unambiguous.
- If tool schema fails once, fall back to plain text immediately.

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
5. Capture reusable learnings from this stage artifact:
   - append 1-3 strict-schema JSONL entries when the stage produced non-obvious
     decisions, patterns, or lessons,
   - use \`type=rule|pattern|lesson\` (\`compound\` stays retro-focused).
6. Notify user with stage completion and next action (\`/cc-next\`).
7. Stop; do not auto-run the next stage unless user asks.

## Automatic learning capture policy

- \`standard\` / \`medium\` tracks: required for \`design\`, \`tdd\`, and \`review\`;
  recommended for other stages.
- \`quick\` track: recommended only (avoid overhead for tiny fixes).
- "No learning captured" is acceptable only when explicitly justified (e.g. pure
  mechanical change, no new trade-offs).

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

When a reusable lesson appears, add one strict-schema JSONL entry via
\`/cc-learn add\`. Repeated lessons should be lifted into stable rules/skills so
the same class of mistake gets harder to repeat.

## Turn Announce Discipline

Keep orchestration visible without maintaining a dedicated preamble runtime log.

- Start substantial turns with a 1-2 sentence announce: current stage, intent, next action.
- Skip announce for trivial single-command actions.
- Never repeat boilerplate announces when the intent did not change.
- If plan or risk changes materially, post a fresh announce before executing.
`;
}
