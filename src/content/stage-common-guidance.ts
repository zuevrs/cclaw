import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
export function stageCommonGuidanceMarkdown(): string {
  return `# Common Stage Guidance

Shared guidance loaded by every stage skill. Keep this file concise and stable so
per-stage skills can stay focused on stage-specific work.

${conversationLanguagePolicyMarkdown()}
## Shared completion protocol

- Stage-specific skills expose **Completion Parameters** plus the gates that
  matter for that stage.
- Generic execution stays inline: verify required gates, update the artifact,
  harvest learnings, then use \`/cc-next\` for progression.
- Do not create separate protocol files.

## Context readiness

- Before drafting, know the upstream artifact freshness, required template shape, relevant code/reference patterns, and unresolved blockers.
- If any item is missing, load it or stop with a blocker instead of inventing content.

## Shared decision protocol

- Ask only decision-changing questions.
- Prefer one focused question over broad questionnaires.
- When choices are equivalent, recommend one path and state the trade-off.
- If a blocker remains after a short retry, stop and ask the user.

## Shared handoff menu

Use this same closeout menu for every stage:

- **A) Advance** — run \`/cc-next\` and continue the critical path; after \`ship\`, the same command drives \`retro -> compound -> archive\`.
- **B) Revise this stage** — stay on current stage and apply feedback.
- **C) Pause / park** — run \`/cc-view status\`, then stop and resume later.
- **D) Rewind** — run \`npx cclaw-cli internal rewind <target-stage> "<reason>"\` as the managed support/runtime repair action; after redoing the target stage, run \`npx cclaw-cli internal rewind --ack <target-stage>\` to clear the stale marker.
- **E) Abandon** — only when the user explicitly wants to end a non-ship active run early, archive with \`npx cclaw-cli archive --skip-retro --retro-reason="<reason>"\`. Once in post-ship closeout, continue \`/cc-next\` through retro/compound/archive instead.

Recommendation defaults:

- Completion status \`DONE\` -> recommend **A**.
- Completion status \`DONE_WITH_CONCERNS\` -> recommend **B**.
- Completion status \`BLOCKED\` -> recommend **B** or **C**.

## Iterate / Victory Detector

- Iterate while a required gate, artifact section, or fresh evidence item is missing.
- Stop only when the stage-specific Victory Detector passes or a named blocker is recorded.
- Do not use vague closeout wording such as \`looks good\`, \`done enough\`, or \`all set\` without the detector evidence.

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
- \`- None this stage.\` only when nothing reusable emerged.
- Or 1-3 JSON bullets with required keys \`type\`, \`trigger\`, \`action\`,
  \`confidence\` (optional fields may mirror knowledge.jsonl schema keys).
- For meaningful \`design\`, \`tdd\`, or \`review\` work, prefer a small JSON
  learning over \`None\` when you made a reusable decision, found a testing
  pattern, or caught a review/security issue.
During \`node .cclaw/hooks/stage-complete.mjs <stage>\`, cclaw validates those
bullets, appends unique entries to \`.cclaw/knowledge.jsonl\`, and stamps a
harvest marker in the artifact.

Prefer \`type=rule|pattern|lesson\` (\`compound\` stays retro-focused).

Track policy:
- \`standard\` / \`medium\`: required for \`design\`, \`tdd\`, and \`review\`;
  recommended for other stages.
- \`quick\`: recommended only.

\`- None this stage.\` is acceptable only when the stage produced no reusable
insight (for example, purely mechanical edits with no new decisions). If unsure,
record a concise \`lesson\` with \`confidence":"medium"\` instead of dropping
operator knowledge.

## Progressive disclosure baseline

- Start with the current stage skill.
- Load deeper skills or docs only when required by a blocker or gate.
- Keep examples as short shape cues inside the current skill instead of
  materializing separate reference files.
`;
}
