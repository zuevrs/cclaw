export function finishCommandContract(): string {
  return `# /cc-finish command contract

Use this command when the user says the active run is complete and wants to close it out.

## Protocol

1. Read \`.cclaw/state/flow-state.json\` and \`.cclaw/commands/next.md\`.
2. Confirm ship closeout is \`ready_to_archive\`. If not, route to \`/cc-next\` until retro and compound closeout are complete or explicitly skipped there.
3. Run \`cclaw archive --disposition=completed\` from the project root.
4. Report the archive path, reset run id, and any knowledge curation hint printed by the CLI.

Completed archives keep strict closeout gates: do not bypass retro or compound review from this command.
`;
}

export function finishCommandSkillMarkdown(): string {
  return `---
name: flow-finish
description: Finish a completed cclaw run by archiving with completed disposition. Use when the user types /cc-finish or asks to finish, close, complete, or archive a successful run.
---

# Finish cclaw Run

Load and follow \`.cclaw/commands/finish.md\`. This is the successful closeout path and must preserve the normal ship closeout gates before archive.
`;
}
