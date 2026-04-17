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
5. Notify user with stage completion and next action (\`/cc-next\`).
6. Stop; do not auto-run the next stage unless user asks.

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

## Search before building

Before adding new code/templates/rules:

1. Search existing artifacts/docs.
2. Search existing knowledge entries.
3. Search codebase for reusable implementations.
4. Prefer built-in/library primitives over custom helpers.

## Do less, prove more

- Prefer minimal, verifiable changes.
- Evidence beats volume.
- Keep stage output concrete and testable.

## Preamble rule

Use a turn preamble only for non-trivial execution turns:
- a file-editing implementation step,
- stage transition,
- or multi-step operation where drift risk is real.

Skip preamble for pure Q&A or tiny edits.

## Operational learning

When a reusable lesson appears, add one strict-schema JSONL entry via
\`/cc-learn add\`. Keep the knowledge store append-only.
`;
}
