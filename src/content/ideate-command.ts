import { RUNTIME_ROOT } from "../constants.js";

const IDEATE_SKILL_FOLDER = "flow-ideate";
const IDEATE_SKILL_NAME = "flow-ideate";

/**
 * Directory + filename convention for ideate artifacts. These are separate
 * from stage artifacts (00-..08-*.md) because `/cc-ideate` runs outside the
 * critical-path flow state machine and must not collide with stage numbering.
 */
const IDEATE_ARTIFACT_GLOB = ".cclaw/artifacts/ideate-*.md";
const IDEATE_ARTIFACT_PATTERN = ".cclaw/artifacts/ideate-<YYYY-MM-DD-slug>.md";
const IDEATE_RESUME_WINDOW_DAYS = 30;

/**
 * Structured-ask tool list reused across cclaw skills. Kept inline here (small
 * enough) to avoid cross-module coupling; larger stage skills cite the shared
 * protocol file instead.
 */
const STRUCTURED_ASK_TOOLS =
  "`AskUserQuestion` on Claude, `AskQuestion` on Cursor, " +
  "`question` on OpenCode when `permission.question: \"allow\"` is set, " +
  "`request_user_input` on Codex in Plan / Collaboration mode; " +
  "fall back to a plain-text lettered list when the tool is hidden or errors";

export function ideateCommandContract(): string {
  return `# /cc-ideate

## Purpose

Repository-improvement ideate mode. Generate a ranked backlog of
high-value improvements, persist it as an artifact on disk, and end with
an explicit handoff — either launch \`/cc\` on a chosen candidate in the
same session, or save/discard the backlog.

## HARD-GATE

- Ideate mode only. Never mutate \`.cclaw/state/flow-state.json\`.
- Every recommendation cites evidence from the current repository
  (file path, command output, or knowledge-store entry id).
- Always write a persisted artifact to
  \`${IDEATE_ARTIFACT_PATTERN}\`. Chat-only output is not acceptable —
  the next session must be able to resume.
- Always end with a structured handoff prompt, not an open question.

## Algorithm

1. **Resume check.** Glob \`${IDEATE_ARTIFACT_GLOB}\`. If any artifact
   has been modified within the last ${IDEATE_RESUME_WINDOW_DAYS} days,
   offer the user: continue that backlog, start fresh, or cancel.
2. **Scan repo signals:**
   - open TODO/FIXME/XXX/HACK notes,
   - flaky or failing tests,
   - oversized modules / complexity hotspots,
   - docs drift vs changed code,
   - repeated entries in \`${RUNTIME_ROOT}/knowledge.jsonl\`.
3. **Produce 5-10 candidates** with impact (High/Medium/Low),
   effort (S/M/L), confidence (High/Medium/Low), and one evidence path
   per candidate.
4. **Rank by impact/effort**, recommend the top item.
5. **Write the artifact** at
   \`${IDEATE_ARTIFACT_PATTERN}\` using the schema in the skill.
6. **Present the handoff prompt** with four concrete options — not A/B/C
   letters. Default = "Start /cc on the top recommendation".

## Headless mode

For skill-to-skill invocation, emit exactly one JSON envelope:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"brainstorm","payload":{"command":"/cc-ideate","artifact":".cclaw/artifacts/ideate-<date>-<slug>.md","recommendation":"I-1"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`cclaw internal envelope-validate --stdin\`

## Primary skill

**${RUNTIME_ROOT}/skills/${IDEATE_SKILL_FOLDER}/SKILL.md**
`;
}

export function ideateCommandSkillMarkdown(): string {
  return `---
name: ${IDEATE_SKILL_NAME}
description: "Repository ideate mode: detect and rank high-leverage improvements, persist a backlog artifact, and hand off to /cc or save/discard."
---

# /cc-ideate

## Announce at start

"Using flow-ideate to identify highest-leverage improvements in this
repository. Will persist a ranked backlog to
\`${IDEATE_ARTIFACT_PATTERN}\` and end with an explicit handoff."

## HARD-GATE

- Do not start coding in ideate mode.
- Do not mutate \`.cclaw/state/flow-state.json\` — ideate mode sits outside
  the critical-path flow.
- Always produce the artifact file on disk before presenting the handoff.
- Always end with a structured handoff that names the concrete follow-up
  command for each option. No A/B/C letters without command context.

## Protocol

### Phase 0 — Resume check

1. Use the harness's file-glob tool (\`Glob\` pattern
   \`${IDEATE_ARTIFACT_GLOB}\` or equivalent \`ls\`/\`find\`).
2. Filter to files modified within the last ${IDEATE_RESUME_WINDOW_DAYS} days.
3. If one or more match, present **one** structured ask using the
   harness's native tool (${STRUCTURED_ASK_TOOLS}) with options:
   - **Continue the existing backlog** — read the most-recent
     ideate-*.md and work from its candidate list; skip re-scanning.
   - **Start a fresh scan** — proceed to Phase 1; the old artifact stays
     on disk for history.
   - **Cancel** — stop; do not scan or write anything.
4. If no recent artifact exists, proceed to Phase 1 silently.

### Phase 1 — Collect evidence

Scan the current repo. Examples of signals (not exhaustive):

- \`rg -n 'TODO|FIXME|XXX|HACK|TBD'\` grouped by file.
- Test-runner output (\`npm test\`, \`pytest\`, \`go test ./...\`) — note
  failures, timeouts, deprecation warnings.
- Module size outliers (\`wc -l\` or \`du\`) with weak direct test coverage.
- Docs drift: check that \`README.md\` / \`docs/\` reference files that
  still exist and flags/APIs that still match \`src/\`.
- \`${RUNTIME_ROOT}/knowledge.jsonl\` entries with \`type: "heuristic"\`
  or repeated \`subject:\` values.

Record each finding with the exact file path or command that produced it.

### Phase 2 — Build candidates

For each high-signal finding, construct a candidate:

- **ID** — \`I-1\`, \`I-2\`, …
- **Title** — one short imperative phrase
- **Impact** — High / Medium / Low
- **Effort** — S / M / L
- **Confidence** — High / Medium / Low
- **Evidence** — path(s) or command output, inline if short
- **Proposed handoff** — the exact \`/cc <phrase>\` the user would run
  to act on this candidate

Aim for 5–10 candidates. Do not invent candidates without evidence.

### Phase 3 — Rank and write the artifact

1. Sort by impact/effort ratio; break ties with confidence.
2. Compute the artifact filename:
   - \`slug\` = first 3–5 words of the top recommendation, lowercase,
     non-alphanumeric collapsed to \`-\`, trimmed. When ideate mode is
     focus-hinted (user passed an argument), use the focus hint instead.
   - \`date\` = today in \`YYYY-MM-DD\` (local time).
   - Path = \`.cclaw/artifacts/ideate-<date>-<slug>.md\`.
3. Use the harness's write-file tool (\`Write\`, \`apply_patch\`, or shell
   \`cat <<EOF > path\`) to create the artifact with this schema:

   \`\`\`markdown
   # Ideation — <date>

   **Focus:** <user-supplied focus or "open-ended scan">
   **Generated:** <ISO-8601 timestamp>
   **Recommendation:** I-1

   ## Ranked backlog

   | ID | Improvement | Impact | Effort | Confidence | Evidence |
   |---|---|---|---|---|---|
   | I-1 | Fix feature-worktree test timeouts | High | S | High | tests/unit/feature-system.test.ts:31 |
   | …   | …                                  | …    | … | …    | …                                     |

   ## Candidate detail

   ### I-1 — Fix feature-worktree test timeouts
   - **Evidence:** \`npm test\` hangs 40s on tests/unit/feature-system.test.ts:31.
   - **Handoff:** \`/cc Fix feature-worktree test timeouts on macOS\`

   ### I-2 — …
   \`\`\`

4. Confirm in chat: "Wrote <path>."

### Phase 4 — Handoff prompt

Present **one** structured ask using the harness's native tool
(${STRUCTURED_ASK_TOOLS}). Each option must name the concrete follow-up —
no bare A/B/C.

Required options, in this order:

1. **Start /cc on the top recommendation** — the agent immediately loads
   \`${RUNTIME_ROOT}/skills/using-cclaw/SKILL.md\` and invokes
   \`/cc <I-1 handoff phrase>\` in the same turn. Default choice.
2. **Pick a different candidate** — the agent asks which ID (I-2, I-3, …)
   and then invokes \`/cc <that candidate's handoff phrase>\`.
3. **Save and close** — leave the artifact on disk, do nothing else.
   Next session: \`/cc-ideate\` will offer to resume it.
4. **Discard** — delete the just-written artifact. Use only when the
   scan produced nothing actionable.

When the structured-ask tool is unavailable, fall back to a plain-text
lettered list with the same four labels. Do not invent extra options.

### Phase 5 — Execute the choice

- **Start /cc on I-1** or **different candidate:** announce
  "Handing off to /cc <phrase>" and load the \`using-cclaw\` router
  skill. From there, the normal \`/cc\` classification and stage flow
  takes over. Do not produce a second artifact; the ideate file is
  preserved as the origin document for this run.
- **Save and close:** reply with the artifact path and stop.
- **Discard:** delete the artifact file, confirm deletion, stop.

## Do not

- Do not write into \`.cclaw/artifacts/0X-*.md\` (stage artifacts).
- Do not mutate \`.cclaw/state/flow-state.json\` at any phase.
- Do not end the turn with an ungrounded "pick one" question — every
  option in the handoff prompt must reference a concrete command.
`;
}

