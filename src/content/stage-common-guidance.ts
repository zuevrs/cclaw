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
- **C) Pause / park** — run \`/cc-view status\`, then stop and resume later.
- **D) Rewind** — run \`/cc-ops rewind <target-stage>\`.
- **E) Abandon** — archive with \`/cc-ops archive --skip-retro --retro-reason="<reason>"\` when user explicitly wants to end the run.

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

Before closeout, capture 1-3 reusable insights in \`.cclaw/knowledge.jsonl\`
whenever the stage produced non-obvious decisions, patterns, or lessons.
Prefer \`type=rule|pattern|lesson\` (\`compound\` stays retro-focused).

Track policy:
- \`standard\` / \`medium\`: required for \`design\`, \`tdd\`, and \`review\`;
  recommended for other stages.
- \`quick\`: recommended only.

"No learning captured" is acceptable only with an explicit reason
(for example, purely mechanical edits with no new decisions).

## Progressive disclosure baseline

- Start with the current stage skill.
- Load deeper references only when required by a blocker or gate.
- Prefer \`.cclaw/references/stages/<stage>-examples.md\` and protocol files over
  copying large instruction blocks into stage skills.
`;
}
