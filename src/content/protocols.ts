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

## Preamble budget

This section is the single source of truth for preamble behavior.
Do not duplicate preamble rules in AGENTS.md, harness adapters, or stage-local docs.

### Emit when

| Trigger | Machine-verifiable condition |
|---|---|
| Stage transition | \`flow-state.currentStage\` changes in this turn |
| Non-trivial implementation turn | agent is about to run source-editing tools outside \`.cclaw/\` |
| Multi-step risky operation | planned sequence contains 2+ commands with rollback/risk potential |

### Skip when

| Skip reason | Condition |
|---|---|
| Pure Q&A | no filesystem or runtime mutation planned |
| Trivial change | single low-risk edit with no stage or plan drift |
| Subagent dispatch payload | prompt is for spawned agent/tool call only |
| Cooldown hit | same stage + same trigger emitted within cooldown window |

### Form contract (max 4 lines)

1. \`Stage:\` current stage id  
2. \`Goal:\` concrete objective for this turn  
3. \`Plan:\` next 1-3 actions  
4. \`Guardrails:\` key constraints / non-goals

### Cooldown

- Record each emitted preamble in \`.cclaw/state/preamble-log.jsonl\` as JSON line:
  \`{"ts","stage","runId","trigger","hash"}\`.
- Default cooldown: 15 minutes for identical \`stage + trigger + hash\`.
- TDD wave mode uses stricter dedupe: one preamble per wave unless scope changes.
- If the plan changes materially, a new preamble is allowed inside cooldown.

## Operational learning

When a reusable lesson appears, add one strict-schema JSONL entry via
\`/cc-learn add\`. Keep the knowledge store append-only.
`;
}
