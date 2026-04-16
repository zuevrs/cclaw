// ---------------------------------------------------------------------------
// Knowledge store content for /cc-learn and stage self-improvement prompts.
// ---------------------------------------------------------------------------

const KNOWLEDGE_PATH = ".cclaw/knowledge.md";
const LEARN_SKILL_NAME = "learnings";
const LEARN_SKILL_DESCRIPTION =
  "Project-scoped knowledge store: review and append rule/pattern/lesson entries in .cclaw/knowledge.md.";

export function learnSkillMarkdown(): string {
  return `---
name: ${LEARN_SKILL_NAME}
description: "${LEARN_SKILL_DESCRIPTION}"
---

# ${LEARN_SKILL_NAME}

## Overview

This skill manages the append-only project knowledge file at \`${KNOWLEDGE_PATH}\`.

Use it to keep durable knowledge that should survive sessions:
- **rule**: hard constraint to follow every time
- **pattern**: repeatable way that works well in this project
- **lesson**: non-obvious outcome from a failure or trade-off
- **compound**: post-ship insight about how to make the *next* feature faster (process accelerator, not domain rule)

## HARD-GATE

Under \`/cc-learn\`, only modify the knowledge store (\`${KNOWLEDGE_PATH}\`) or an explicitly user-approved summary file. Do not modify application code here.

## Entry format (append-only)

\`\`\`markdown
### 2026-04-14T12:00:00Z [pattern] short-title
- Stage: design
- Context: one short line
- Insight: one short line
- Reuse: one short line
- Confidence: high | medium | low      (optional)
- Domain: api | infra | ui | testing | …  (optional)
- Project: <repo or scope name>        (optional)
\`\`\`

Rules:
- Type must be exactly one of \`rule\`, \`pattern\`, \`lesson\`, \`compound\` (lowercase).
- Never rewrite history silently; append a newer correction entry instead. To replace, prefix the new entry with \`Supersedes: <old-title>\`.
- Keep entries concise and actionable.
- Optional fields (\`Confidence\`, \`Domain\`, \`Project\`) are forward-compatible and used by the **knowledge-curation** skill — fill them when known.

## Curation policy (target: ≤ 50 active entries)

The knowledge file is append-only, but entries can be **superseded** rather than deleted:

- When you discover a more correct rule, append a new entry with \`Supersedes: <old-title>\`.
- During \`/cc-learn curate\`, the assistant surfaces candidates for soft-archive (move to \`.cclaw/knowledge.archive.md\`) when the active file exceeds 50 entries or contains stale/duplicate entries.

See the **knowledge-curation** utility skill for the full curation protocol.

## Subcommands

### \`/cc-learn\` (default)
- Show the last 30 lines from \`${KNOWLEDGE_PATH}\`.
- If file is missing or empty, report that clearly.

### \`/cc-learn search <query>\`
- Perform case-insensitive text search in \`${KNOWLEDGE_PATH}\`.
- Return matched headings and nearby lines.

### \`/cc-learn add\`
- Ask for: \`type\`, \`short title\`, \`context\`, \`insight\`, \`reuse\`.
- Optionally ask for: \`confidence\`, \`domain\`, \`project\`.
- Append one entry using current UTC timestamp.
- Re-read the file tail and confirm the entry was written.

### \`/cc-learn curate\`
- Hand off to the **knowledge-curation** skill (read-only audit + soft-archive plan).
- Never deletes from \`${KNOWLEDGE_PATH}\` without an explicit user-approved archive plan.
`;
}

export function learnCommandContract(): string {
  return `# /cc-learn

## Purpose

Manage the project knowledge store at \`${KNOWLEDGE_PATH}\` (append-only markdown).

## HARD-GATE

Do not edit source code from this command. Only operate on \`${KNOWLEDGE_PATH}\` (or user-approved summary output).

## Subcommands

| subcommand | args | description |
|---|---|---|
| (default) | — | Show recent knowledge entries (tail view). |
| \`search\` | \`<query>\` | Search knowledge text for relevant prior rules/patterns/lessons. |
| \`add\` | — | Append a new entry with type \`rule\` / \`pattern\` / \`lesson\` / \`compound\`. |
| \`curate\` | — | Hand off to the **knowledge-curation** skill: read-only audit + soft-archive plan when the active file exceeds the curation threshold. |
`;
}

export function selfImprovementBlock(stageName: string): string {
  return `## Operational Self-Improvement

After this stage, ask:
- Did I discover a non-obvious reusable **rule** or **pattern**?
- Did a failure reveal a reusable **lesson**?

If yes, append one concise entry to \`${KNOWLEDGE_PATH}\`:

\`\`\`bash
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >> ${KNOWLEDGE_PATH} <<EOF
### $TS [pattern] short-title
- Stage: ${stageName}
- Context: what situation triggered this
- Insight: what should be remembered
- Reuse: how to apply this next time
EOF
\`\`\`

Type must be exactly one of: \`rule\`, \`pattern\`, \`lesson\`, \`compound\`.
`;
}

export function learningsSearchPreamble(stage: string): string {
  return `## Prior Knowledge (load at stage start)

Before stage work, search \`${KNOWLEDGE_PATH}\` for relevant entries (for example: \`${stage}\`, affected systems, key constraints) and apply them explicitly.

If the file is empty, continue normally.
`;
}

export function learningsAgentsMdBlock(): string {
  return `### Knowledge Store

\`${KNOWLEDGE_PATH}\` — append-only markdown memory with entry types \`rule\`, \`pattern\`, \`lesson\`, \`compound\`.
At session start and stage transitions, load recent entries and apply relevant ones.
If a non-obvious reusable rule/pattern/lesson is discovered, append a new entry.
`;
}
