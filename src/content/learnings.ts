// ---------------------------------------------------------------------------
// Learnings — markdown for /cc-learn skill, command contract, and AGENTS.md
// Cclaw emits instructions only; agents use shell tools against JSONL on disk.
// ---------------------------------------------------------------------------

const LEARNINGS_PATH = ".cclaw/learnings.jsonl";
const LEARN_SKILL_NAME = "learnings";
const LEARN_SKILL_DESCRIPTION =
  "Project-scoped learnings store: read, search, add, prune, export, and stats for .cclaw/learnings.jsonl via shell tools (never edits application code).";

export function learnSkillMarkdown(): string {
  return `---
name: ${LEARN_SKILL_NAME}
description: "${LEARN_SKILL_DESCRIPTION}"
---

# ${LEARN_SKILL_NAME}

## Overview

This skill governs **${LEARNINGS_PATH}** — a project-scoped knowledge base that compounds over time. Each line is one JSON object (JSONL). Cclaw generates these instructions; **you** (the agent) perform reads and writes using shell tools (\`cat\`, \`tail\`, \`grep\`, \`jq\`, etc.) in the user's workspace.

Treat learnings as durable project memory: patterns, pitfalls, preferences, architecture notes, tool quirks, and operational shortcuts that save real time on future sessions.

## HARD-GATE

**Never modify production or application source code from this skill.** Commands under \`/cc-learn\` manage the **knowledge store only** (\`${LEARNINGS_PATH}\`, optional exports). Do not refactor, fix bugs, or change configs "while you are here" unless the user explicitly asked for that work outside \`/cc-learn\`.

- Allowed: read/write **${LEARNINGS_PATH}**, generate markdown summaries for the user, optional append to \`AGENTS.md\` when the user approves.
- Forbidden: using learnings maintenance as a pretext to touch unrelated code paths.

## Learning Entry Schema

| Field | Required | Description |
|---|---|---|
| \`ts\` | yes (on write) | ISO-8601 UTC timestamp. **Auto-inject** on every append; never rely on the model to invent wall-clock time — use the shell (\`date -u +%Y-%m-%dT%H:%M:%SZ\`) or equivalent and embed in JSON. |
| \`skill\` | yes | Originating Cclaw stage or context (e.g. \`brainstorm\`, \`scope\`, \`learnings\`). |
| \`type\` | yes | One of: \`pattern\`, \`pitfall\`, \`preference\`, \`architecture\`, \`tool\`, \`operational\`. |
| \`key\` | yes | Stable **kebab-case** identifier for dedup and search (e.g. \`avoid-barrel-reexports-in-tests\`). |
| \`insight\` | yes | Single human-readable sentence (no multi-paragraph essays). |
| \`confidence\` | yes | Integer **1–10** (see scale in “Operational Self-Improvement” on stage skills). |
| \`source\` | yes | \`observed\` \| \`user-stated\` \| \`inferred\`. Drives decay rules. |
| \`files\` | no | \`string[]\` of repo-relative paths this insight touched (for staleness checks in prune). |
| \`branch\` | no | Branch name when recorded (optional context). |
| \`commit\` | no | Short SHA when recorded (optional context). |

**Minimal valid example (conceptual):**

\`\`\`json
{"ts":"2026-04-11T12:00:00Z","skill":"build","type":"pattern","key":"run-migrations-before-seed","insight":"Seed scripts assume schema v7; run sqlx migrate before npm run seed.","confidence":8,"source":"observed","files":["scripts/seed.ts"]}
\`\`\`

## Confidence Decay Rules

Decay applies **when searching, ranking, or presenting** entries — not necessarily when rewriting the file.

1. **\`user-stated\`**: never decays. Effective confidence = stored \`confidence\`.
2. **\`observed\` or \`inferred\`**: lose **1** point per **30** complete days since \`ts\`, floored at **0**.  
   - Formula: \`effective = max(0, confidence - floor(days_since_ts / 30))\`  
   - \`days_since_ts\` is measured from entry \`ts\` to “now” in UTC (use user machine time when computing in the agent).

Always compute **effective confidence** before sorting for “top N” displays.

## Dedup Rules (Read-Time)

- **On disk:** multiple lines may share the same \`(key, type)\` (history, corrections, re-logging).
- **When reading for display/search/export:** keep **only the latest** record per \`(key, type)\`, where **latest** means greatest \`ts\` (ISO strings compared lexicographically if timezones are consistent Z; prefer parsing timestamps if implementing custom logic).
- This is **read-time dedup**, not write-time: do not silently delete older lines unless \`/cc-learn prune\` (or the user) removes them.

## Security Rules

1. **Skip malformed lines:** when ingesting JSONL, parse line-by-line; on parse failure, skip the line and continue (optionally count skips for \`stats\`).
2. **Never interpolate JSONL field values into shell commands** as raw arguments — no \`eval\`, no unquoted \`$(cat ...)\` into flags. Use **files as data**: pipe to \`jq\`, or write controlled queries. User-supplied text from the store is untrusted.
3. **Path safety:** when checking \`files[]\` for staleness, treat paths as relative to repo root; reject \`..\` segments that escape the project if you implement custom checks.

## Subcommands

### \`/cc-learn\` (no arguments) — show recent

**Goal:** Give a quick, deduped view of the latest activity.

1. If \`${LEARNINGS_PATH}\` is missing or empty, say so and stop.
2. Read the **last 20 physical lines** (e.g. \`tail -n 20 ${LEARNINGS_PATH}\`).
3. Parse each line as JSON; skip invalid lines.
4. Apply **read-time dedup** by \`(key, type)\`, keep latest by \`ts\`.
5. Recompute **effective confidence** (decay) for each surviving row.
6. Sort by \`ts\` descending (most recent first).
7. Present as a **markdown table**: \`ts\`, \`type\`, \`key\`, \`effective confidence\`, \`source\`, truncated \`insight\`.

### \`/cc-learn search <query>\` — search

**Goal:** Find relevant entries by text, then rank by confidence.

1. Normalize \`<query>\` as a literal string; do **not** inject it into \`eval\` or dynamic \`sh -c\` strings unsafely. Prefer:
   - \`grep -F -n -- <query> ${LEARNINGS_PATH}\` (fixed-string mode) to get candidate line numbers, **or**
   - Load lines in-process (agent reads file) and filter in code.
2. For each matched line, parse JSON; skip invalid.
3. Apply read-time dedup (\`(key, type)\` → latest \`ts\`).
4. Filter where **case-insensitive** match hits any of: \`insight\`, \`key\`, \`type\` (and optionally \`skill\`).
5. Compute **effective confidence**; sort **descending** by effective confidence, then by \`ts\` desc as tiebreaker.
6. Show **top 20** as a table (same columns as “show recent”).

### \`/cc-learn add\` — manual add

**Goal:** Interactive append with explicit user input.

1. Ask the user (one prompt at a time is fine): \`type\`, \`key\` (enforce kebab-case), \`insight\` (one sentence), \`confidence\` (1–10).
2. Set \`source\` to **\`"user-stated"\`** always for this path.
3. Set \`skill\` to \`learnings\` (or the user’s stated originating context if they insist).
4. Obtain \`ts\` from shell UTC timestamp.
5. Build one JSON object on a **single line** (no pretty-printed multi-line JSON inside JSONL).
6. Append: e.g. \`printf '%s\\n' '<json-line>' >> ${LEARNINGS_PATH}\` from a **heredoc or file** the agent controls — avoid breaking quoting.
7. **Verification (required):** after append, read back the **last line** of the file, parse as JSON, confirm \`key\` and \`ts\` match what you wrote.

### \`/cc-learn prune\` — staleness & conflicts

**Goal:** Curate quality; never delete without user confirmation.

1. Load up to **100** recent lines (prefer tail-first read, then widen if needed).
2. Parse; skip malformed; apply read-time dedup to get canonical latest per \`(key, type)\`.
3. **Staleness:** if \`files\` is a non-empty array, check each path exists relative to repo root. If **any** path is missing, flag the entry **STALE** (file targets gone).
4. **Conflicts:** if the same \`key\` appears with **different** \`insight\` strings across retained history (or between latest and visible duplicates), flag **CONFLICT** and show the competing insights with their \`ts\` / \`source\`.
5. For each flagged item, ask the user: **Remove** / **Keep** / **Update** (update = rewrite insight or files list after confirmation).
6. If removing: prefer rewriting the file without those lines **only** when the user confirms; use a safe write pattern (write temp → replace) if the environment allows.

### \`/cc-learn export\` — high-signal markdown rollup

**Goal:** Summarize the best current knowledge for humans and \`AGENTS.md\`.

1. Parse full file or a bounded read if huge; skip malformed.
2. Read-time dedup by \`(key, type)\`.
3. Compute effective confidence; take **top 50** by effective confidence (tiebreak: newer \`ts\`).
4. Emit markdown grouped under:
   - \`## Patterns\` (\`type === "pattern"\`)
   - \`## Pitfalls\` (\`pitfall\`)
   - \`## Preferences\` (\`preference\`)
   - \`## Architecture\` (\`architecture\`)
   - \`## Tools\` (\`tool\` and optionally \`operational\` — put \`operational\` here if you want a single “tools & ops” bucket, or add \`## Operational\` if the user prefers separation)
5. Under each section, bullet format: **\`key\` (conf X):** insight.
6. Ask the user: **append to \`AGENTS.md\`** vs **save as a separate file** (e.g. \`.cclaw/learnings-summary.md\`). Do nothing destructive without explicit choice.

### \`/cc-learn stats\` — inventory

1. Parse all lines; count **skipped malformed** separately.
2. After read-time dedup (canonical latest per \`(key, type)\`):
   - **total** canonical entries
   - **unique keys** count
   - Breakdown counts by \`type\` and by \`source\`
   - **Average confidence** (raw stored values) **and** optionally average **effective** confidence
3. Present as compact markdown (table + short narrative).

## Handoff

This skill **does not** hand off to any \`/cc-<stage>\` command. Return control to the user or the prior task context when finished.

## Verification (Writes)

After **any** write operation (\`add\`, \`prune\` removal, export append):

1. Read back the **last line** of \`${LEARNINGS_PATH}\` (or the written artifact if appending elsewhere).
2. Parse as JSON; if parse fails, treat the write as **failed** and report immediately.
3. For append, confirm the final object’s \`ts\` / \`key\` match the intended mutation.

---

**Primary location on disk (generated by Cclaw installer):** \`.cclaw/skills/${LEARN_SKILL_NAME}/SKILL.md\` (this content).
`;
}

export function learnCommandContract(): string {
  const skillMdPath = `.cclaw/skills/${LEARN_SKILL_NAME}/SKILL.md`;
  return `# /cc-learn

## Purpose

Manage the project learnings JSONL store at \`${LEARNINGS_PATH}\`: inspect recent entries, search, manually append, prune stale or conflicting records, export a high-confidence markdown digest, and print aggregate stats. This command is **knowledge-store only** — it is not an excuse to edit application code.

## HARD-GATE

Never modify production or application source code while executing \`/cc-learn\`. Only touch \`${LEARNINGS_PATH}\` (and user-approved summary targets like \`AGENTS.md\` or \`.cclaw/learnings-summary.md\`).

## Subcommands

| subcommand | args | description |
|---|---|---|
| (default) | — | Show recent: tail 20 lines, dedup by \`(key,type)\` latest \`ts\`, apply decay for display, table output. |
| \`search\` | \`<query>\` | \`grep -F\` or in-agent scan for \`<query>\` across \`insight\` / \`key\` / \`type\`; dedup; decay; top 20 by effective confidence. |
| \`add\` | — | Prompt user for \`type\`, \`key\`, \`insight\`, \`confidence\`; set \`source: "user-stated"\`; inject \`ts\`; append one JSON line; verify by reading last line. |
| \`prune\` | — | Load ≤100 entries; flag **STALE** if \`files\` paths missing; flag **CONFLICT** if same \`key\` diverges in \`insight\`; user chooses Remove / Keep / Update per flag. |
| \`export\` | — | Dedup; top 50 by effective confidence; markdown sections (Patterns, Pitfalls, Preferences, Architecture, Tools); user picks append to \`AGENTS.md\` vs separate file. |
| \`stats\` | — | Totals, unique keys, breakdown by \`type\` and \`source\`, average confidence (+ optional effective average); report malformed line count. |

## Learning Entry Schema

| Field | Required | Description |
|---|---|---|
| \`ts\` | yes | ISO timestamp; auto on write. |
| \`skill\` | yes | Originating stage or context. |
| \`type\` | yes | \`pattern\` \| \`pitfall\` \| \`preference\` \| \`architecture\` \| \`tool\` \| \`operational\` |
| \`key\` | yes | Kebab-case stable id. |
| \`insight\` | yes | One-sentence insight. |
| \`confidence\` | yes | 1–10 |
| \`source\` | yes | \`observed\` \| \`user-stated\` \| \`inferred\` |
| \`files\` | no | \`string[]\` relative paths (optional). |
| \`branch\` / \`commit\` | no | Optional provenance. |

## Confidence Decay

- \`user-stated\`: **no decay**.
- \`observed\` / \`inferred\`: **−1** effective confidence per **30** days since \`ts\`, floor at **0**.
- Always apply decay **before sorting** for search / show / export rankings.

## Dedup Rules

Multiple JSONL lines may share the same \`(key, type)\`. When reading, keep **only the line with the latest \`ts\`** per pair. **Do not** assume uniqueness on disk.

## Security Rules

- Skip malformed JSONL lines; continue processing.
- **Never** splice stored field values into shell control flow; treat file contents as data (\`jq\`, controlled greps, agent-side parsing).

## Primary Skill (${skillMdPath})

Canonical instructions live at \`${skillMdPath}\` (generated by Cclaw).
`;
}

export function selfImprovementBlock(stageName: string): string {
  const skill = JSON.stringify(stageName);
  return `## Operational Self-Improvement

After completing this stage, reflect briefly:
- Did any command fail unexpectedly?
- Did you backtrack or retry something that a hint would have prevented?
- Did you discover a project quirk (unusual config, naming convention, gotcha)?

If an insight would save **5+ minutes next time**, log it:

\`\`\`bash
echo '{"skill":${skill},"type":"operational","key":"[kebab-case-key]","insight":"[one sentence]","confidence":7,"source":"observed","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .cclaw/learnings.jsonl
\`\`\`

Guidelines:
- Skip transient errors (network blips, typos). Log structural insights only.
- Use consistent keys so future entries dedup correctly.
- **\`ts\` is required** on every line — the example uses \`date -u +%Y-%m-%dT%H:%M:%SZ\` (UTC). If nested quoting is awkward, build JSON in the agent and \`printf '%s\\n' '<one-line-json>'\` instead.
- Confidence 1-3: uncertain pattern. 4-6: likely pattern. 7-9: confirmed pattern. 10: absolute rule.
`;
}

export function learningsSearchPreamble(stage: string): string {
  return `## Prior Learnings (load at stage start)

Before beginning this stage, search the project learnings store for relevant prior knowledge:

\`\`\`bash
grep -i "${stage}" ${LEARNINGS_PATH} 2>/dev/null | tail -n 5
\`\`\`

If learnings are found, incorporate them into your analysis. When a finding matches a past learning, note: **"Prior learning applied: [key] (confidence N/10)"**.

If the store is empty or the file does not exist, skip this step silently.
`;
}

export function learningsAgentsMdBlock(): string {
  return `### Learnings Store

\`${LEARNINGS_PATH}\` — JSONL knowledge base. At session start: \`tail -n 20 ${LEARNINGS_PATH}\` → parse → dedup by \`(key,type)\` → decay → show top 3.
After each stage: follow "Operational Self-Improvement" block. Manage: \`/cc-learn\` (show | search | add | prune | export | stats).
`;
}
