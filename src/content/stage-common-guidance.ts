export function stageCommonGuidanceMarkdown(): string {
  return `# Common Stage Guidance

Shared guidance loaded by every stage skill. Keep this file concise and stable so
per-stage skills can stay focused on stage-specific work.

## Shared completion protocol

- Stage-specific skills expose **Completion Parameters** plus the gates that
  matter for that stage.
- Generic execution stays inline: verify required gates, update the artifact,
  harvest learnings, then use \`/cc-next\` for progression.
- Do not create separate protocol files.

## Shared decision protocol

- Ask only decision-changing questions.
- Prefer one focused question over broad questionnaires.
- When choices are equivalent, recommend one path and state the trade-off.
- If a blocker remains after a short retry, stop and ask the user.

## Shared handoff menu

Use this same closeout menu for every stage:

- **A) Advance** — run \`/cc-next\` and continue.
- **B) Revise this stage** — stay on current stage and apply feedback.
- **C) Pause / park** — run \`/cc-view status\`, then stop and resume later.
- **D) Rewind** — run \`cclaw internal rewind <target-stage> "<reason>"\`.
- **E) Abandon** — archive with \`cclaw archive --skip-retro --retro-reason="<reason>"\` when user explicitly wants to end the run.

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

Before closeout, fill the artifact \`## Learnings\` section (do not write
\`.cclaw/knowledge.jsonl\` by hand):
- \`- None this stage.\` when nothing reusable emerged.
- Or 1-3 JSON bullets with required keys \`type\`, \`trigger\`, \`action\`,
  \`confidence\` (optional fields may mirror knowledge.jsonl schema keys).
During \`node .cclaw/hooks/stage-complete.mjs <stage>\`, cclaw validates those
bullets, appends unique entries to \`.cclaw/knowledge.jsonl\`, and stamps a
harvest marker in the artifact.

Prefer \`type=rule|pattern|lesson\` (\`compound\` stays retro-focused).

Track policy:
- \`standard\` / \`medium\`: required for \`design\`, \`tdd\`, and \`review\`;
  recommended for other stages.
- \`quick\`: recommended only.

\`- None this stage.\` is acceptable only when the stage produced no reusable
insight (for example, purely mechanical edits with no new decisions).

## Progressive disclosure baseline

- Start with the current stage skill.
- Load deeper skills or docs only when required by a blocker or gate.
- Keep examples as short shape cues inside the current skill instead of
  materializing separate reference files.
`;
}
