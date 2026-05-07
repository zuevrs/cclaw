export const CANCEL_COMMAND_BODY = `# /cc-cancel — cancel the active cclaw run

This command stops the current cclaw flow without finishing it.

## Behaviour

1. Read \`.cclaw/state/flow-state.json\`.
2. If \`currentSlug\` is null: there is nothing to cancel; tell the user.
3. Otherwise:
   - Move every active artifact for \`<slug>\` into \`.cclaw/cancelled/<slug>/\` (do **not** push to shipped).
   - Reset flow-state to fresh (currentSlug=null, currentStage=null, ac=[]).
   - Do not auto-commit anything; leave the working tree as is.
4. Confirm the cancellation in one line.

Cancelling does **not** delete artifacts. They stay in \`.cclaw/cancelled/<slug>/\` so the user can recover them or revisit them later.
`;

export function renderCancelCommand(): string {
  return CANCEL_COMMAND_BODY;
}
