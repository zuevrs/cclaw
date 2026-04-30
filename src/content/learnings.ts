// ---------------------------------------------------------------------------
// Knowledge store content for the learnings skill and stage self-improvement prompts.
//
// The knowledge store is a single canonical JSONL file. Each line is one
// self-contained JSON object matching the strict schema in this module.
// There is no markdown mirror — cclaw is JSONL-native.
// ---------------------------------------------------------------------------

const KNOWLEDGE_PATH = ".cclaw/knowledge.jsonl";
const KNOWLEDGE_ARCHIVE_PATH = ".cclaw/knowledge.archive.jsonl";
const LEARN_SKILL_NAME = "learnings";
const LEARN_SKILL_DESCRIPTION =
  "Project-scoped knowledge store: append and query rule/pattern/lesson/compound entries in the canonical JSONL file at .cclaw/knowledge.jsonl. Strict schema, append-only, machine-queryable.";

/**
 * Canonical required JSONL field order (matches strict validator keys).
 * Optional keys (`source`, `severity`) may be appended after these required fields.
 */
export const KNOWLEDGE_JSONL_FIELDS = [
  "type",
  "trigger",
  "action",
  "confidence",
  "stage",
  "origin_stage",
  "frequency",
  "created",
  "first_seen_ts",
  "last_seen_ts",
  "project"
] as const;

export function learnSkillMarkdown(): string {
  return `---
name: ${LEARN_SKILL_NAME}
description: "${LEARN_SKILL_DESCRIPTION}"
---

# ${LEARN_SKILL_NAME}

## Overview

The project knowledge store is **one canonical JSONL file**: \`${KNOWLEDGE_PATH}\`.
Each line is one self-contained JSON object. Append-only. Machine-queryable.

Use the store to keep durable knowledge that should survive sessions:
- **rule**: hard constraint to follow every time.
- **pattern**: repeatable way that works well in this project.
- **lesson**: non-obvious outcome from a failure or trade-off.
- **compound**: post-ship insight about how to make the *next* run faster (process accelerator, not domain rule).

## Continuous capture (stage closeout path)

Knowledge capture is now stage-native:
- Each stage artifact has a \`## Learnings\` section.
- Allowed payloads:
  - \`- None this stage.\` (explicit no-op)
  - JSON bullets with required keys \`type\`, \`trigger\`, \`action\`, \`confidence\` (optional keys may mirror the full JSONL schema fields).
- During \`node .cclaw/hooks/stage-complete.mjs <stage>\`, cclaw:
  1. validates \`## Learnings\`,
  2. appends deduped entries to \`${KNOWLEDGE_PATH}\`,
  3. writes a harvest marker into the artifact.

Manual/query operations (search, backfill, curation) use this skill when the
user asks for knowledge work. If a stage artifact contains JSON learnings but
\`${KNOWLEDGE_PATH}\` did not change, the missing step is almost always running
\`node .cclaw/hooks/stage-complete.mjs <stage>\` successfully.

## HARD-GATE

During manual knowledge operations, only modify \`${KNOWLEDGE_PATH}\`, \`${KNOWLEDGE_ARCHIVE_PATH}\`,
or an explicitly user-approved summary file. Do not modify application code here.
Do not invent alternate stores (no markdown mirror, no SQLite, no per-stage files).

## Entry format - strict JSONL schema

Exactly one JSON object per line. Required fields must appear in the order:
\`type, trigger, action, confidence, stage, origin_stage, frequency, created, first_seen_ts, last_seen_ts, project\`.
Optional fields \`source\` and \`severity\` may be appended after \`project\`.

\`\`\`json
{"type":"pattern","trigger":"when reviewing external payloads","action":"parse through zod before touching service layer","confidence":"high","stage":"review","origin_stage":"review","frequency":1,"created":"2026-04-14T12:00:00Z","first_seen_ts":"2026-04-14T12:00:00Z","last_seen_ts":"2026-04-14T12:00:00Z","project":"cclaw"}
\`\`\`

| field | type | required | notes |
|---|---|---|---|
| \`type\` | \`"rule" \\| "pattern" \\| "lesson" \\| "compound"\` | yes | Lowercase. |
| \`trigger\` | string | yes | The concrete situation that must be recognized. Start with a verb or \`when …\`. |
| \`action\` | string | yes | The concrete move to take when the trigger fires. One sentence. |
| \`confidence\` | \`"high" \\| "medium" \\| "low"\` | yes | Write \`medium\` when unsure; do not omit. |
| \`stage\` | \`FlowStage\` \\| null | yes | One of brainstorm / scope / design / spec / plan / tdd / review / ship, or \`null\` when cross-stage. |
| \`origin_stage\` | \`FlowStage\` \\| null | yes | Stage where this learning was first observed. |
| \`frequency\` | integer >= 1 | yes | Number of times this same trigger/action pair has been observed. |
| \`created\` | ISO 8601 UTC string | yes | \`date -u +%Y-%m-%dT%H:%M:%SZ\`. |
| \`first_seen_ts\` | ISO 8601 UTC string | yes | First observed timestamp (usually equals \`created\`). |
| \`last_seen_ts\` | ISO 8601 UTC string | yes | Last re-confirmed timestamp. |
| \`project\` | string \\| null | yes | Repo or scope name. Use \`null\` when the entry crosses projects. |
| \`source\` | \`"stage" \\| "retro" \\| "compound" \\| "idea" \\| "manual" \\| null\` | no | Origin channel for the entry when known. |
| \`severity\` | \`"critical" \\| "important" \\| "suggestion"\` | no | Priority signal for compound lifts; \`critical\` enables single-hit override in compound readiness analysis. |

Rules:
- No other fields beyond the table above. Extra keys are forbidden and MUST be rejected by any writer.
- Append-only: never rewrite or delete a historical line.
- Keep each entry one line. No pretty-printing. No trailing commas.

## Curation policy (target: ≤ 50 active entries)

- The file is append-only — entries are never physically deleted.
- When the canonical file exceeds 50 lines, a curation pass proposes
  soft-archiving: the approved lines are **moved** to \`${KNOWLEDGE_ARCHIVE_PATH}\`
  verbatim (same JSONL shape). The working file stays lean.
- Use the **Curate** action below for the full read-only audit and
  user-approved soft-archive plan.

## Manual Actions

### Show recent entries
- Read \`${KNOWLEDGE_PATH}\`. Stream the last 30 lines; pretty-print each
  line's \`type\` / \`trigger\` / \`action\` for human review.
- If file is missing or empty, report that clearly and suggest adding a
  manual entry through this skill.

### Search \`<query>\`
- Stream \`${KNOWLEDGE_PATH}\`, JSON.parse each line, filter where any of
  \`trigger\`, \`action\`, \`project\` contains \`<query>\` (case-insensitive).
- Return the matched lines pretty-printed (do not mutate the file).

### Add
- Ask for required user-facing fields in order: \`type\`, \`trigger\`, \`action\`, \`confidence\`, \`stage\`, \`project\`.
- \`confidence\` must be one of \`high\`, \`medium\`, \`low\`. Default to \`medium\` if the user declines to set it.
- \`stage\` and \`project\` may be explicitly \`null\`.
- Prefer stage-native \`## Learnings\` capture for new flow work; use \`add\` mainly for backfilling historical lessons or ad-hoc entries outside a stage closeout.
- \`origin_stage\` defaults to \`stage\`.
- \`frequency\` starts at \`1\`.
- \`created\`, \`first_seen_ts\`, and \`last_seen_ts\` are set automatically to current UTC ISO timestamp.
- Append exactly one JSON line to \`${KNOWLEDGE_PATH}\` with the field order from the schema table above.
- Re-read the file tail to confirm the new line is valid JSON and parses back to the same object.

### Curate
- Produce a read-only audit + soft-archive plan.
- Never deletes. Soft-archive means **moving** full JSON lines from
  \`${KNOWLEDGE_PATH}\` to \`${KNOWLEDGE_ARCHIVE_PATH}\` as part of a
  user-approved curation pass.
`;
}
