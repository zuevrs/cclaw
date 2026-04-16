// ---------------------------------------------------------------------------
// Knowledge store content for /cc-learn and stage self-improvement prompts.
// ---------------------------------------------------------------------------

const KNOWLEDGE_PATH = ".cclaw/knowledge.md";
const KNOWLEDGE_JSONL_PATH = ".cclaw/knowledge.jsonl";
const LEARN_SKILL_NAME = "learnings";
const LEARN_SKILL_DESCRIPTION =
  "Project-scoped knowledge store: review and append rule/pattern/lesson/compound entries. Maintains a human-readable markdown mirror at .cclaw/knowledge.md and a canonical JSONL store at .cclaw/knowledge.jsonl.";

export function learnSkillMarkdown(): string {
  return `---
name: ${LEARN_SKILL_NAME}
description: "${LEARN_SKILL_DESCRIPTION}"
---

# ${LEARN_SKILL_NAME}

## Overview

This skill manages the project knowledge store. The store has **two mirrored formats**:

- \`${KNOWLEDGE_PATH}\` — human-readable, append-only markdown (the reading view).
- \`${KNOWLEDGE_JSONL_PATH}\` — canonical, machine-queryable JSONL (one JSON object per line). Used by the curator, /cc-status, and future analytics.

Every \`/cc-learn add\` appends to **both** files. \`/cc-learn search\` prefers the JSONL store if it exists; otherwise it falls back to the markdown file.

Use the store to keep durable knowledge that should survive sessions:
- **rule**: hard constraint to follow every time
- **pattern**: repeatable way that works well in this project
- **lesson**: non-obvious outcome from a failure or trade-off
- **compound**: post-ship insight about how to make the *next* feature faster (process accelerator, not domain rule)

## HARD-GATE

Under \`/cc-learn\`, only modify the knowledge store files (\`${KNOWLEDGE_PATH}\` and \`${KNOWLEDGE_JSONL_PATH}\`) or an explicitly user-approved summary file. Do not modify application code here.

## Entry format — markdown mirror (append-only)

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

## Entry format — canonical JSONL (one entry per line)

\`\`\`json
{"type":"pattern","title":"short-title","stage":"design","context":"one short line","insight":"one short line","reuse":"one short line","created":"2026-04-14T12:00:00Z","confidence":"high","domain":"api","project":"cclaw","supersedes":null,"superseded":false,"archived":false}
\`\`\`

Schema:

| field | type | required | notes |
|---|---|---|---|
| \`type\` | \`"rule" \\| "pattern" \\| "lesson" \\| "compound"\` | yes | Lowercase. |
| \`title\` | string | yes | Short title, used as a human-readable identifier. |
| \`stage\` | \`FlowStage\` | yes | One of brainstorm / scope / design / spec / plan / tdd / review / ship. |
| \`context\` | string | yes | What situation triggered this. |
| \`insight\` | string | yes | What must be remembered. |
| \`reuse\` | string | yes | How to apply this next time — concrete trigger/action. |
| \`created\` | ISO 8601 UTC string | yes | When the entry was written. |
| \`confidence\` | \`"high" \\| "medium" \\| "low"\` | optional | Default \`medium\` if omitted. |
| \`domain\` | string | optional | Free-form taxonomy (\`api\`, \`infra\`, \`ui\`, …). |
| \`project\` | string | optional | Repo or scope name when the entry crosses features. |
| \`supersedes\` | string \\| null | optional | Title of the entry this one replaces. |
| \`superseded\` | boolean | optional | \`true\` when a newer entry replaces this one. |
| \`archived\` | boolean | optional | \`true\` once the curator soft-archives the entry. |

Rules:
- Type must be exactly one of \`rule\`, \`pattern\`, \`lesson\`, \`compound\` (lowercase).
- Never rewrite history silently; append a newer correction entry instead. To replace, set \`supersedes\` to the old title in the new JSONL entry and in the new markdown entry prefix with \`Supersedes: <old-title>\`. Flip \`superseded: true\` on the old JSONL entry via a new JSONL line (the file is append-only; use a \`replace\` line by convention — see Curation policy).
- Keep entries concise and actionable.
- Optional fields (\`Confidence\`, \`Domain\`, \`Project\`) are forward-compatible and used by the **knowledge-curation** skill — fill them when known.

## Backward-compat migration (markdown → JSONL)

Run \`/cc-learn migrate\` once per repo when \`${KNOWLEDGE_JSONL_PATH}\` is missing:

1. Parse \`${KNOWLEDGE_PATH}\`. Each entry starts with \`### <ISO8601> [<type>] <title>\` and is followed by \`- <Field>: <value>\` lines until the next \`###\` or EOF.
2. Map fields to JSONL schema:
   - Heading timestamp → \`created\`; heading \`[type]\` → \`type\`; heading title → \`title\`.
   - Bullet \`Stage:\`, \`Context:\`, \`Insight:\`, \`Reuse:\`, \`Confidence:\`, \`Domain:\`, \`Project:\` → matching fields.
   - A \`Supersedes:\` prefix line becomes \`"supersedes": "<old-title>"\`.
3. Emit one JSON object per line to \`${KNOWLEDGE_JSONL_PATH}\` preserving the original order. Set defaults: \`confidence = "medium"\`, \`superseded = false\`, \`archived = false\`, missing optional fields = \`null\`.
4. Do **not** rewrite \`${KNOWLEDGE_PATH}\`. The markdown stays as the human-readable mirror; new additions continue to write both files.
5. After migration, \`/cc-learn search\` reads the JSONL store first; if absent, it continues to parse the markdown file (so users who never migrate still work).

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
- If \`${KNOWLEDGE_JSONL_PATH}\` exists: stream it, JSON.parse each line, filter where any of \`title\`, \`context\`, \`insight\`, \`reuse\`, \`domain\` contains \`<query>\` (case-insensitive). Skip \`archived: true\` unless \`--include-archived\` is passed.
- Otherwise: case-insensitive text search in \`${KNOWLEDGE_PATH}\`.
- Return matched headings and nearby lines.

### \`/cc-learn add\`
- Ask for: \`type\`, \`short title\`, \`context\`, \`insight\`, \`reuse\`.
- Optionally ask for: \`confidence\`, \`domain\`, \`project\`, \`supersedes\`.
- Append one markdown entry to \`${KNOWLEDGE_PATH}\` (human mirror).
- Append one JSON line to \`${KNOWLEDGE_JSONL_PATH}\` (canonical store) using the same UTC timestamp as the markdown entry's heading.
- Re-read both tails to confirm both writes.

### \`/cc-learn migrate\`
- Parse \`${KNOWLEDGE_PATH}\` and emit \`${KNOWLEDGE_JSONL_PATH}\` per the Backward-compat migration protocol above.
- Safe to re-run: if JSONL already exists, report the current entry count and exit (no destructive rewrite).

### \`/cc-learn curate\`
- Hand off to the **knowledge-curation** skill (read-only audit + soft-archive plan).
- Never deletes from \`${KNOWLEDGE_PATH}\` or \`${KNOWLEDGE_JSONL_PATH}\` without an explicit user-approved archive plan. Soft-archive in JSONL means appending a new line with the same \`title\` and \`archived: true\` (entries are never physically removed).
`;
}

export function learnCommandContract(): string {
  return `# /cc-learn

## Purpose

Manage the project knowledge store. Two mirrored formats:
- \`${KNOWLEDGE_PATH}\` — human-readable markdown (append-only, tail view).
- \`${KNOWLEDGE_JSONL_PATH}\` — canonical JSONL (one entry per line) used by the curator and machine consumers.

## HARD-GATE

Do not edit source code from this command. Only operate on \`${KNOWLEDGE_PATH}\`, \`${KNOWLEDGE_JSONL_PATH}\`, or user-approved summary output.

## Subcommands

| subcommand | args | description |
|---|---|---|
| (default) | — | Show recent knowledge entries (tail view from markdown mirror). |
| \`search\` | \`<query>\` | Search knowledge for relevant prior rules/patterns/lessons. Prefers JSONL when present. |
| \`add\` | — | Append a new entry (\`rule\` / \`pattern\` / \`lesson\` / \`compound\`) to **both** markdown and JSONL. |
| \`migrate\` | — | Emit the canonical JSONL mirror from the markdown file (idempotent). |
| \`curate\` | — | Hand off to the **knowledge-curation** skill: read-only audit + soft-archive plan when the active file exceeds the curation threshold. |
`;
}

export function selfImprovementBlock(stageName: string): string {
  return `## Operational Self-Improvement

After this stage, ask:
- Did I discover a non-obvious reusable **rule** or **pattern**?
- Did a failure reveal a reusable **lesson**?

If yes, append one concise entry to **both** the markdown mirror (\`${KNOWLEDGE_PATH}\`) and the canonical JSONL store (\`${KNOWLEDGE_JSONL_PATH}\`) with the same timestamp:

\`\`\`bash
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >> ${KNOWLEDGE_PATH} <<EOF
### $TS [pattern] short-title
- Stage: ${stageName}
- Context: what situation triggered this
- Insight: what should be remembered
- Reuse: how to apply this next time
EOF
printf '%s\\n' '{"type":"pattern","title":"short-title","stage":"${stageName}","context":"what situation triggered this","insight":"what should be remembered","reuse":"how to apply this next time","created":"'"$TS"'","confidence":"medium","domain":null,"project":null,"supersedes":null,"superseded":false,"archived":false}' >> ${KNOWLEDGE_JSONL_PATH}
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
