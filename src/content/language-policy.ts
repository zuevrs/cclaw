export function conversationLanguagePolicyMarkdown(): string {
  return `## Conversation Language Policy

- Infer the user-facing language from the latest substantive user message.
- Write user-facing prose, summaries, recommendations, and structured question text/options in that language unless the user asks otherwise.
- Do not translate stable machine surfaces: commands, file paths, stage ids, gate ids, JSON keys, enum/status values, artifact headings/frontmatter, logs, code identifiers, and quoted source text.
- If the request mixes languages, use the language of the actual ask sentence for narrative output.
`;
}

export function conversationLanguagePolicyBullets(): string {
  return `- User-facing narrative follows the latest substantive user message language.
- Do not translate commands, paths, ids, JSON keys/enums, artifact headings, logs, code identifiers, or quoted source.`;
}
