export interface RecoveryPlaybook {
  id: string;
  fileName: string;
  title: string;
  triggers: string[];
  body: string;
}

export const RECOVERY_PLAYBOOKS: RecoveryPlaybook[] = [];

export const RECOVERY_INDEX = `# .cclaw/lib/recovery/

Recovery playbooks for inconsistent flow-state — corrupted frontmatter, schema mismatches, parallel-build conflicts, AC-traceability breaks, review caps reached.

> **v8.12 cleanup.** Earlier versions shipped 5 dedicated recovery playbooks (\`ac-traceability-break.md\`, \`review-cap-reached.md\`, \`parallel-build-conflict.md\`, \`frontmatter-corruption.md\`, \`schema-mismatch.md\`). Audit found **zero explicit citations** in any specialist or orchestrator-prompt for these files by exact name — the meta-skill said "read recovery when checks fail", but no spec line ever named a specific recovery file. The playbooks are deleted in v8.12.

When a recovery scenario actually fires (you see corrupt JSON in \`flow-state.json\`, a manifest claims \`ship_commit: <unknown>\`, or AC-N is committed but \`flow-state.ac[].status\` still says \`pending\`), the orchestrator's response is now inline:

1. **Pause the flow.** Do not advance \`currentStage\` or dispatch a specialist while state is suspect.
2. **Surface the inconsistency to the user** with three concrete options: \`fix-by-hand\` (user edits the file, re-runs \`/cc\`), \`reset-flow-state\` (destructive: \`createInitialFlowState\` overwrites; flow restarts from triage), or \`/cc-cancel\` (move active artefacts to \`flows/cancelled/<slug>/\`, ADRs marked REJECTED).
3. **Do NOT auto-repair.** Silent state mutation is the bug; recovery is a user-driven decision.

Users who want the deleted playbooks back can opt into \`legacy-artifacts: true\` in \`.cclaw/config.yaml\`.
`;
