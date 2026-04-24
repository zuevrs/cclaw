// ---------------------------------------------------------------------------
// Knowledge store content for /cc-learn and stage self-improvement prompts.
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
 * Optional keys (for now: `source`, `severity`) may be appended after these
 * required fields.
 * Exported for tests and any programmatic writer that wants a stable base shape.
 */
export const KNOWLEDGE_JSONL_FIELDS = [
  "type",
  "trigger",
  "action",
  "confidence",
  "domain",
  "stage",
  "origin_stage",
  "origin_feature",
  "frequency",
  "universality",
  "maturity",
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
- **compound**: post-ship insight about how to make the *next* feature faster (process accelerator, not domain rule).

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

\`/cc-learn\` remains the manual/query surface (search, backfill, curation).

## HARD-GATE

Under \`/cc-learn\`, only modify \`${KNOWLEDGE_PATH}\`, \`${KNOWLEDGE_ARCHIVE_PATH}\`,
or an explicitly user-approved summary file. Do not modify application code here.
Do not invent alternate stores (no markdown mirror, no SQLite, no per-stage files).

## Entry format — strict JSONL schema

Exactly one JSON object per line. Required fields must appear in the order:
\`type, trigger, action, confidence, domain, stage, origin_stage, origin_feature, frequency, universality, maturity, created, first_seen_ts, last_seen_ts, project\`.
Optional fields \`source\` and \`severity\` may be appended after \`project\`.

\`\`\`json
{"type":"pattern","trigger":"when reviewing external payloads","action":"parse through zod before touching service layer","confidence":"high","domain":"api","stage":"review","origin_stage":"review","origin_feature":"payload-hardening","frequency":1,"universality":"project","maturity":"raw","created":"2026-04-14T12:00:00Z","first_seen_ts":"2026-04-14T12:00:00Z","last_seen_ts":"2026-04-14T12:00:00Z","project":"cclaw"}
\`\`\`

| field | type | required | notes |
|---|---|---|---|
| \`type\` | \`"rule" \\| "pattern" \\| "lesson" \\| "compound"\` | yes | Lowercase. |
| \`trigger\` | string | yes | The concrete situation that must be recognized. Start with a verb or \`when …\`. |
| \`action\` | string | yes | The concrete move to take when the trigger fires. One sentence. |
| \`confidence\` | \`"high" \\| "medium" \\| "low"\` | yes | Write \`medium\` when unsure; do not omit. |
| \`domain\` | string \\| null | yes | Free-form taxonomy (\`api\`, \`infra\`, \`ui\`, \`security\`, \`testing\`, …). Use \`null\` when cross-cutting. |
| \`stage\` | \`FlowStage\` \\| null | yes | One of brainstorm / scope / design / spec / plan / tdd / review / ship, or \`null\` when cross-stage. |
| \`origin_stage\` | \`FlowStage\` \\| null | yes | Stage where this learning was first observed. |
| \`origin_feature\` | string \\| null | yes | Feature/worktree label where it was observed first. |
| \`frequency\` | integer >= 1 | yes | Number of times this same trigger/action pair has been observed. |
| \`universality\` | \`"project" \\| "personal" \\| "universal"\` | yes | Scope of applicability. |
| \`maturity\` | \`"raw" \\| "lifted-to-rule" \\| "lifted-to-enforcement"\` | yes | Lifecycle state of the learning. |
| \`created\` | ISO 8601 UTC string | yes | \`date -u +%Y-%m-%dT%H:%M:%SZ\`. |
| \`first_seen_ts\` | ISO 8601 UTC string | yes | First observed timestamp (usually equals \`created\`). |
| \`last_seen_ts\` | ISO 8601 UTC string | yes | Last re-confirmed timestamp. |
| \`project\` | string \\| null | yes | Repo or scope name. Use \`null\` when the entry crosses projects. |
| \`source\` | \`"stage" \\| "retro" \\| "compound" \\| "ideate" \\| "manual" \\| null\` | no | Origin channel for the entry when known. |
| \`severity\` | \`"critical" \\| "important" \\| "suggestion"\` | no | Priority signal for compound lifts; \`critical\` enables single-hit override in compound readiness analysis. |

Rules:
- No other fields beyond the table above. Extra keys are forbidden and MUST be rejected by any writer.
- Every required-null field must be emitted explicitly as \`null\` (not omitted). This keeps the file grep-friendly.
- Append-only: never rewrite or delete a historical line. Corrections are new
  entries whose \`trigger\` clearly supersedes the earlier one.
- Keep each entry one line. No pretty-printing. No trailing commas.

## Curation policy (target: ≤ 50 active entries)

- The file is append-only — entries are never physically deleted.
- When the canonical file exceeds 50 lines, \`/cc-learn curate\` proposes
  soft-archiving: the approved lines are **moved** to \`${KNOWLEDGE_ARCHIVE_PATH}\`
  verbatim (same JSONL shape). The working file stays lean.
- See the **knowledge-curation** utility skill for the full curation protocol.

## Subcommands

### \`/cc-learn\` (default)
- Read \`${KNOWLEDGE_PATH}\`. Stream the last 30 lines; pretty-print each
  line's \`type\` / \`trigger\` / \`action\` for human review.
- If file is missing or empty, report that clearly and suggest \`/cc-learn add\`.

### \`/cc-learn search <query>\`
- Stream \`${KNOWLEDGE_PATH}\`, JSON.parse each line, filter where any of
  \`trigger\`, \`action\`, \`domain\`, \`project\` contains \`<query>\` (case-insensitive).
- Return the matched lines pretty-printed (do not mutate the file).

### \`/cc-learn add\`
- Ask for required user-facing fields in order: \`type\`, \`trigger\`, \`action\`, \`confidence\`, \`domain\`, \`stage\`, \`universality\`, \`project\`.
- \`confidence\` must be one of \`high\`, \`medium\`, \`low\`. Default to \`medium\` if the user declines to set it.
- \`domain\`, \`stage\`, and \`project\` may be explicitly \`null\`.
- Prefer stage-native \`## Learnings\` capture for new flow work; use \`add\` mainly for backfilling historical lessons or ad-hoc entries outside a stage closeout.
- \`origin_stage\` defaults to \`stage\`; \`origin_feature\` defaults to active feature (or \`null\` if unknown).
- \`frequency\` starts at \`1\`.
- \`maturity\` starts at \`raw\`.
- \`created\`, \`first_seen_ts\`, and \`last_seen_ts\` are set automatically to current UTC ISO timestamp.
- Append exactly one JSON line to \`${KNOWLEDGE_PATH}\` with the field order from the schema table above.
- Re-read the file tail to confirm the new line is valid JSON and parses back to the same object.

### \`/cc-learn curate\`
- Hand off to the **knowledge-curation** skill (read-only audit + soft-archive plan).
- Never deletes. Soft-archive means **moving** full JSON lines from
  \`${KNOWLEDGE_PATH}\` to \`${KNOWLEDGE_ARCHIVE_PATH}\` as part of a
  user-approved curation pass.
`;
}

export function learnCommandContract(): string {
  return `# /cc-learn

## Purpose

Manage the project knowledge store. One canonical file, strict JSONL:
- \`${KNOWLEDGE_PATH}\` — append-only JSONL, one entry per line.
- \`${KNOWLEDGE_ARCHIVE_PATH}\` — soft-archive target written only by curate.

Stage-native pipeline:
- During \`stage-complete.mjs\`, cclaw harvests \`## Learnings\` from the current
  stage artifact into \`${KNOWLEDGE_PATH}\` automatically.
- Use \`/cc-learn\` for query, backfill, and curation workflows.

## HARD-GATE

Do not edit source code from this command. Only operate on \`${KNOWLEDGE_PATH}\`,
\`${KNOWLEDGE_ARCHIVE_PATH}\`, or user-approved summary output.

## Subcommands

| subcommand | args | description |
|---|---|---|
| (default) | — | Show recent knowledge entries (tail of JSONL, pretty-printed). |
| \`search\` | \`<query>\` | Stream-filter the JSONL for matching \`trigger\`, \`action\`, \`domain\`, \`project\`. |
| \`add\` | — | Append one JSON line (\`rule\` / \`pattern\` / \`lesson\` / \`compound\`) with the strict JSONL schema (15 required fields + optional \`source\` / \`severity\`). |
| \`curate\` | — | Hand off to the **knowledge-curation** skill: read-only audit + soft-archive plan when the file exceeds the curation threshold. |
`;
}
