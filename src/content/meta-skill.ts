import { RUNTIME_ROOT } from "../constants.js";
import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
import {
  CLOSEOUT_CHAIN,
  closeoutChainInline,
  closeoutFlowMapSentence,
  closeoutProtocolBehaviorSentence
} from "./closeout-guidance.js";

export const META_SKILL_NAME = "using-cclaw";

export const META_SKILL_GENERATED_HELPER_SKILLS = [
  "subagent-dev",
  "parallel-dispatch",
  "session",
  "iron-laws"
] as const;

function generatedHelperSkillList(): string {
  return META_SKILL_GENERATED_HELPER_SKILLS.map((name) => `\`${name}\``).join(", ");
}

export function usingCclawSkillMarkdown(): string {
  return `---
name: using-cclaw
description: "Routing brain for cclaw. Decide whether to start/resume a stage, answer directly, or use visible commands like /cc, /cc-idea, and /cc-cancel."
---

# Using Cclaw

## Instruction priority

1. User message in current turn.
2. Active stage skill and command contract.
3. This routing file.
4. Generated cclaw helper skills, research playbooks, and enabled rule packs.
5. Default model behavior.

If the user explicitly overrides a stage rule, record it in the artifact.

${conversationLanguagePolicyMarkdown()}
## Skill-before-response gate

If \`.cclaw/state/flow-state.json\` exists and \`currentStage\` is set,
load the matching stage SKILL before producing **substantive** work
(artifact edits, code, structured clarifying questions). Do not improvise
from memory. Load only generated helper surfaces that actually exist in this install: ${generatedHelperSkillList()}, research playbooks, review prompts, or enabled language rule packs under \`.cclaw/rules/lang/\`. Do not invent helper-skill names beyond those generated surfaces.

Substantive vs. non-substantive:

- **Substantive** (must load skill first): proposing design, editing an
  artifact, running gates, dispatching subagents, asking a
  \`Decision Protocol\` question, declaring a stage done.
- **Non-substantive** (skill load optional): one-line acknowledgement,
  clarifying a typo, confirming a prior answer, pure conversation.

If \`.cclaw/state/flow-state.json\` is missing, treat it as a normal fresh-init
state and route through \`/cc <idea>\` to start the first tracked run.
If the file exists but is corrupt/unreadable, stop and route through \`/cc\`
before any substantive response.

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
  ├─ Repo-improvement discovery? -> /cc-idea
  ├─ Resume existing flow? -> /cc
  ├─ Knowledge operation? -> load the learnings skill
  ├─ Normal post-ship closeout? -> /cc drives ${closeoutChainInline()}
  └─ Explicit early cancellation/abandonment? -> /cc-cancel
\`\`\`

## Task classification

| Class | Route |
|---|---|
| non-trivial software work | \`/cc <idea>\` |
| trivial software fix | \`/cc <idea>\` (quick track) |
| bugfix with clear repro | \`/cc <idea>\` and enforce RED-first in tdd |
| pure question / conversation | answer directly |
| non-software work | answer directly |

## Flow-state checks

Before stage work:

1. Read \`.cclaw/state/flow-state.json\`.
2. If active stage exists, continue with \`/cc\`.
3. Do not jump directly to stage-specific commands.

## Platform reliability notes

- Managed hook dispatch uses \`.cclaw/hooks/run-hook.cmd\` (cross-platform wrapper).
- If hooks fail due missing runtime deps (for example \`node\` not on \`PATH\`), run \`npx cclaw-cli sync\` before continuing.
- Prefer cross-platform commands in artifacts/examples (\`npm test\`, \`pnpm test\`, \`python -m pytest\`, etc.) over shell-specific aliases whenever possible.

## Stage quick map

Use \`/cc <idea>\` for new work, \`/cc\` for progression and closeout, \`/cc-idea\` for backlog discovery, and \`/cc-cancel\` for cancellation/abandonment.

## Main vs Operator Surfaces

- **Main workflow:** \`/cc\`, \`/cc-idea\`, and \`/cc-cancel\` inside the installed harness runtime.
- **Installer/support surface:** \`npx cclaw-cli init\`, \`npx cclaw-cli sync\`, \`npx cclaw-cli upgrade\`, \`npx cclaw-cli sync\`, and \`npx cclaw-cli uninstall\`.
- Use operator/support surfaces only for install/runtime diagnosis or lifecycle maintenance. Do not make them part of the happy path.

## Whole flow map

standard: brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship -> ${CLOSEOUT_CHAIN}
medium: brainstorm -> spec -> plan -> tdd -> review -> ship -> ${CLOSEOUT_CHAIN}
quick: spec -> tdd -> review -> ship -> ${CLOSEOUT_CHAIN}

${closeoutFlowMapSentence()}

Tracks may skip critical-path stages via \`flow-state.track\` + \`skippedStages\`.
Use the current stage skill plus \`.cclaw/state/flow-state.json\` for orientation.

## Contextual Skill Activation

Use built-in judgment only when triggered by the current task:

- generated subagent context skills for mandatory review/delegation contracts
- research playbooks and review prompts when a stage explicitly calls for them
- inline verification and ship/finalization sections in the active stage skill
- \`iron-laws\` as policy arbitration when instructions conflict
- language rule packs from \`.cclaw/config.yaml\` when enabled

## Protocol Behavior

${closeoutProtocolBehaviorSentence()}

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
