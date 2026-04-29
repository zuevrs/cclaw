export function cancelCommandContract(): string {
  return `# /cc-cancel command contract

Use this command when the user wants to stop the active run without claiming completion.

## Protocol

1. Ask for a concise cancellation reason if the user has not already provided one.
2. Run \`cclaw archive --disposition=cancelled --reason=<reason>\` from the project root. Use \`--disposition=abandoned\` only when the user explicitly frames the run as abandoned rather than cancelled.
3. Report the archive path and reset run id. Make clear that the archived run is not a completed ship.

Cancelled and abandoned archives are allowed from any stage, but they require a required reason so future readers know why the run ended.
`;
}

export function cancelCommandSkillMarkdown(): string {
  return `---
name: flow-cancel
description: Cancel or abandon the active cclaw run with a required reason. Use when the user types /cc-cancel or asks to cancel, abandon, stop, discard, or reset an unfinished run.
---

# Cancel cclaw Run

Load and follow \`.cclaw/commands/cancel.md\`. This is a non-completion path: require a reason and archive with cancelled or abandoned disposition.
`;
}
