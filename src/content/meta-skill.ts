import { RUNTIME_ROOT } from "../constants.js";
import { FLOW_MAP_REL_PATH } from "./flow-map.js";
import {
  COMPLETION_PROTOCOL_REL_PATH,
  DECISION_PROTOCOL_REL_PATH,
  ETHOS_PROTOCOL_REL_PATH
} from "./protocols.js";

export const META_SKILL_NAME = "using-cclaw";

export function usingCclawSkillMarkdown(): string {
  return `---
name: using-cclaw
description: "Routing brain for cclaw. Decide whether to start/resume a stage, answer directly, or use utility commands like /cc-learn, /cc-ideate, /cc-view, and /cc-ops."
---

# Using Cclaw

## Instruction priority

1. User message in current turn.
2. Active stage skill and command contract.
3. This routing file.
4. Contextual utility skills.
5. Default model behavior.

If the user explicitly overrides a stage rule, record it in the artifact.

## Skill-before-response gate

If \`.cclaw/state/flow-state.json\` exists and \`currentStage\` is set,
load the matching stage SKILL before producing **substantive** work
(artifact edits, code, structured clarifying questions). Do not improvise
from memory. Also load a contextual utility skill when the task clearly
triggers it (security, performance, debugging, docs, finishing-a-branch,
verification-before-completion).

Substantive vs. non-substantive:

- **Substantive** (must load skill first): proposing design, editing an
  artifact, running gates, dispatching subagents, asking a
  \`Decision Protocol\` question, declaring a stage done.
- **Non-substantive** (skill load optional): one-line acknowledgement,
  clarifying a typo, confirming a prior answer, pure conversation.

If the current stage is ambiguous because \`flow-state.json\` is missing
or corrupt, stop and route through \`/cc\` before any substantive
response.

## Red Flags (stop and re-route)

If you think any of these, stop and follow the routing flow:

- "This looks simple, I can skip the stage." -> No. Route through \`/cc\`.
- "I can answer from memory without loading the active stage skill." -> No. Load the skill first.
- "Hook guard warned, but I can ignore it." -> No. Resolve the warning before continuing.
- "I'll edit \`.cclaw/state\` directly to move faster." -> No. Use managed commands only.

## Routing flow

\`\`\`
Task arrives
  ├─ Running as spawned subagent? -> obey parent prompt only; do not run cclaw routing
  ├─ Pure question / non-software ask? -> answer directly (no stage)
  ├─ New software work? -> /cc <idea>
  ├─ Repo-improvement discovery? -> /cc-ideate
  ├─ Resume existing flow? -> /cc or /cc-next
  ├─ Knowledge operation? -> /cc-learn
  ├─ Read-only workspace view? -> /cc-view [status|tree|diff]
  └─ Workspace operation? -> /cc-ops [feature|tdd-log|retro|compound|archive|rewind]
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

## Platform reliability notes

- Managed hook dispatch uses \`.cclaw/hooks/run-hook.cmd\` (cross-platform wrapper).
- If hooks fail due missing runtime deps (for example \`node\` not on \`PATH\`), run \`cclaw doctor\` before continuing.
- Prefer cross-platform commands in artifacts/examples (\`npm test\`, \`pnpm test\`, \`python -m pytest\`, etc.) over shell-specific aliases.

## Stage quick map

brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship

Tracks may skip stages via \`flow-state.track\` + \`skippedStages\`.
For the full surface (stages, routers, Ralph Loop, state files) load
\`${FLOW_MAP_REL_PATH}\` — it is the single-page overview of cclaw.

## Contextual skill activation

Load utility skills only when triggered by the current task:

- security, performance, debugging, docs, ci-cd
- verification-before-completion before completion claims
- finishing-a-development-branch during ship/finalization
- document-review, receiving-code-review, and execution context skills
- iron-laws as policy arbitration when instructions conflict
- language rule packs from \`.cclaw/config.yaml\` when enabled

Custom project skills under \`.cclaw/custom-skills/\` are opt-in supplements,
never mandatory delegations.

## Protocol references

Do not inline these protocols in stage skills; cite by path:

- Decision protocol: \`${DECISION_PROTOCOL_REL_PATH}\`
- Completion/resume protocol: \`${COMPLETION_PROTOCOL_REL_PATH}\`
- Engineering ethos + announce discipline: \`${ETHOS_PROTOCOL_REL_PATH}\`

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
