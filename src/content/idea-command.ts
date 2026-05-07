export const IDEA_COMMAND_BODY = `# /cc-idea — capture an idea outside of any active flow

This command does **not** participate in plan/build/review/ship. It exists so the user can drop a half-formed idea without spinning up a full flow.

## Behaviour

1. Append a one-paragraph entry to \`.cclaw/ideas.md\` (create the file if missing).
2. Each entry begins with an ISO timestamp, then a single line summary, then the body in normal prose.
3. Do **not** create a slug.
4. Do **not** modify \`.cclaw/state/flow-state.json\`.
5. Do **not** invoke specialists.

When the user is ready to act on an idea, they invoke \`/cc <task>\` describing it; ideas are not auto-converted to plans.
`;

export function renderIdeaCommand(): string {
  return IDEA_COMMAND_BODY;
}
