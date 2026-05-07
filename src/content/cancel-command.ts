export const CANCEL_COMMAND_BODY = `# /cc-cancel — cancel the active cclaw run

Stop the current flow without finishing it. Artifacts are preserved.

## Behaviour

1. Read \`.cclaw/state/flow-state.json\`.
2. If \`currentSlug\` is null → tell the user there is nothing to cancel and stop.
3. Otherwise, perform the cancel runtime:
   - For every active stage (\`plan\`, \`build\`, \`review\`, \`ship\`, \`decisions\`, \`learnings\`), move \`<slug>.md\` into \`.cclaw/cancelled/<slug>/\` as \`<stage>.md\`.
   - Write \`.cclaw/cancelled/<slug>/manifest.md\` recording the cancel time, the user's reason (if provided), and the artifacts that were moved.
   - Update each moved artifact's frontmatter so \`status: cancelled\` and \`stage: cancelled\` (best-effort — invalid frontmatter is preserved as-is).
   - Reset \`flow-state.json\` to fresh: \`currentSlug=null, currentStage=null, ac=[], reviewIterations=0, securityFlag=false\`.
   - Leave the working tree alone. Do not auto-commit, do not stash, do not revert.
4. Confirm the cancellation in one line and list the destination directory.

## Recovery

The artifacts under \`.cclaw/cancelled/<slug>/\` are read-only references for future runs. To resume the work:

1. Invoke \`/cc <task>\` describing the same goal.
2. Existing-plan detection will surface the cancelled match.
3. Choose **resume from cancelled** to copy the artifacts back into \`.cclaw/plans/\` etc., reset \`status: active\`, and continue.

## Hard rules

- \`/cc-cancel\` never deletes artifacts. The orchestrator must refuse explicit deletion requests.
- \`/cc-cancel\` never pushes to git or rewrites history.
- \`/cc-cancel\` is idempotent: invoking it without an active slug prints "no active run" and stops.
`;

export function renderCancelCommand(): string {
  return CANCEL_COMMAND_BODY;
}
