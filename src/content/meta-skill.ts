import { RUNTIME_ROOT } from "../constants.js";
import {
  COMPLETION_PROTOCOL_REL_PATH,
  DECISION_PROTOCOL_REL_PATH,
  ETHOS_PROTOCOL_REL_PATH
} from "./protocols.js";

export const META_SKILL_NAME = "using-cclaw";

export function usingCclawSkillMarkdown(): string {
  return `---
name: using-cclaw
description: "Routing brain for cclaw. Decide whether to start/resume a stage, answer directly, or use utility commands like /cc-learn, /cc-view, and /cc-ops."
---

# Using Cclaw

## Instruction priority

1. User message in current turn.
2. Active stage skill and command contract.
3. This routing file.
4. Contextual utility skills.
5. Default model behavior.

If the user explicitly overrides a stage rule, record it in the artifact.

## Routing flow

\`\`\`
Task arrives
  ├─ Running as spawned subagent? -> obey parent prompt only; do not run cclaw routing
  ├─ Pure question / non-software ask? -> answer directly (no stage)
  ├─ New software work? -> /cc <idea>
  ├─ Resume existing flow? -> /cc or /cc-next
  ├─ Knowledge operation? -> /cc-learn
  ├─ Read-only workspace view? -> /cc-view [status|tree|diff]
  └─ Workspace operation? -> /cc-ops [feature|tdd-log|retro|archive|rewind|rewind-ack]
\`\`\`

## Task classification

| Class | Route |
|---|---|
| non-trivial software work | \`/cc <idea>\` |
| trivial software fix | \`/cc <idea>\` (quick/medium track as recommended) |
| bugfix with clear repro | \`/cc <idea>\` and enforce RED-first in tdd |
| pure question / conversation | answer directly |
| non-software work | answer directly |

## Flow-state checks

Before stage work:

1. Read \`.cclaw/state/flow-state.json\`.
2. If active stage exists, continue with \`/cc\` or \`/cc-next\`.
3. Do not jump directly to stage-specific commands.

## Stage quick map

brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship

Tracks may skip stages via \`flow-state.track\` + \`skippedStages\`.

## Contextual skill activation

Load utility skills only when triggered by the current task:

- security, performance, debugging, docs, ci-cd
- document-review and execution context skills
- language rule packs from \`.cclaw/config.yaml\` when enabled

Custom project skills under \`.cclaw/custom-skills/\` are opt-in supplements,
never mandatory delegations.

## Protocol references

Do not inline these protocols in stage skills; cite by path:

- Decision protocol: \`${DECISION_PROTOCOL_REL_PATH}\`
- Completion/resume protocol: \`${COMPLETION_PROTOCOL_REL_PATH}\`
- Engineering ethos + preamble rules: \`${ETHOS_PROTOCOL_REL_PATH}\`

## Knowledge guidance

Use session-injected knowledge digest first. Only stream full
\`.cclaw/knowledge.jsonl\` when digest evidence is insufficient.

## Failure guardrails

- Do not skip stages silently.
- Do not claim gate completion without evidence.
- Do not auto-advance after stage completion unless user asks.
- Escalate after repeated failures (see decision protocol).
`;
}
