export const IDEA_COMMAND_BODY = `# /cc-idea — capture an idea outside of any active flow

This command does **not** participate in plan/build/review/ship. Its only job is to drop a half-formed idea into the backlog without spinning up a full flow.

## Behaviour

1. Open \`.cclaw/ideas.md\`. If it does not exist, seed it from \`.cclaw/lib/templates/ideas.md\`.
2. Append a new entry with this shape:

   \`\`\`
   ## YYYY-MM-DDTHH:MM:SSZ — <one-line summary>

   <short paragraph or bullet list with the idea body>
   \`\`\`

3. Save the file. Do not slugify, do not create artifacts under \`.cclaw/flows/<slug>/\`, do not modify \`flow-state.json\`, do not invoke specialists.

## Hard rules

- One entry per invocation. If the user pastes multiple ideas, ask whether to file them as one entry or several.
- Never auto-promote an idea to a plan. Promotion happens only when the user explicitly invokes \`/cc <task>\`.
- Never delete or edit prior ideas inside \`/cc-idea\`. Trimming the backlog is a separate manual step.

## Suggested entry shape

\`\`\`
## 2026-05-07T19:30:12Z — switch knowledge.jsonl to ndjson

Right now \`.cclaw/knowledge.jsonl\` is one JSON object per line, but tooling
expects RFC 8259-compliant NDJSON. Worth verifying once the tooling adopts
the standard formally.
\`\`\`

The orchestrator surfaces ideas back to the user only when an explicit \`/cc\` invocation references them; otherwise they stay quiet.
`;

export function renderIdeaCommand(): string {
  return IDEA_COMMAND_BODY;
}
