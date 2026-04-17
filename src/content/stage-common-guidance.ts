import { RUNTIME_ROOT } from "../constants.js";

export const STAGE_COMMON_GUIDANCE_REL_PATH = `${RUNTIME_ROOT}/references/stages/common-guidance.md`;

export function stageCommonGuidanceMarkdown(): string {
  return `# Common Stage Guidance

Shared guidance loaded by every stage skill. Keep this file concise and stable so
per-stage skills can stay focused on stage-specific work.

## Shared completion protocol

- Stage-specific skills expose **Completion Parameters** only.
- Generic execution steps live in \`.cclaw/references/protocols/completion.md\`.
- Do not restate the protocol in each stage file.

## Shared decision protocol

- Decision wording, ask-tool format, retry budget, and escalation rules live in
  \`.cclaw/references/protocols/decision.md\`.
- Stage files should reference that path, not duplicate the full text.

## Shared handoff menu

Use this same closeout menu for every stage:

- **A) Advance** — run \`/cc-next\` and continue.
- **B) Revise this stage** — stay on current stage and apply feedback.
- **C) Pause / park** — stop now and resume later.
- **D) Rewind** — move to a prior stage explicitly chosen by the user.
- **E) Abandon** — cancel this flow; artifacts remain on disk.

Recommendation defaults:

- Completion status \`DONE\` -> recommend **A**.
- Completion status \`DONE_WITH_CONCERNS\` -> recommend **B**.
- Completion status \`BLOCKED\` -> recommend **B** or **C**.

## Completion status vocabulary

- \`DONE\` — all required gates and checks satisfied.
- \`DONE_WITH_CONCERNS\` — required gates pass, but recommended items remain.
- \`BLOCKED\` — one or more required/triggered conditions fail.

## Decision record template

Use when a stage makes a non-trivial architecture/scope/testing decision.

\`\`\`
Decision: <one-line title>
Context: <what forced this decision>
Options considered:
- A: ...
- B: ...
Chosen option: <A/B/...>
Why: <short rationale>
Risk: <main downside>
Rollback / fallback: <if decision proves wrong>
\`\`\`

## Self-improvement reminder

If a reusable lesson appears during the stage, append one strict-schema JSONL
entry via \`/cc-learn add\`. Do not keep operational lessons only in chat.

## Progressive disclosure baseline

- Start with the current stage skill.
- Load deeper references only when required by a blocker or gate.
- Prefer \`.cclaw/references/stages/<stage>-examples.md\` and protocol files over
  copying large instruction blocks into stage skills.
`;
}
