import { RUNTIME_ROOT } from "../constants.js";
import { resolveIdeaFrames, type IdeaFrameId } from "./idea-frames.js";
import { ideaStructuredAskToolsWithFallback } from "./decision-protocol.js";

import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
const IDEA_SKILL_FOLDER = "flow-idea";
const IDEA_SKILL_NAME = "flow-idea";

/**
 * Directory + filename convention for idea artifacts. These are separate
 * from stage artifacts (00-..08-*.md) because `/cc-idea` runs outside the
 * critical-path flow state machine and must not collide with stage numbering.
 */
const IDEA_ARTIFACT_GLOB = ".cclaw/artifacts/idea-*.md";
const IDEA_ARTIFACT_PATTERN = ".cclaw/artifacts/idea-<YYYY-MM-DD-slug>.md";
const IDEA_RESUME_WINDOW_DAYS = 30;

const STRUCTURED_ASK_TOOLS = ideaStructuredAskToolsWithFallback();

export interface IdeaCommandOptions {
  frameIds?: readonly IdeaFrameId[];
  mode?: "repo-grounded" | "elsewhere-software" | "elsewhere-non-software" | "narrow";
}

export function minimumDistinctIdeaFrames(
  frameCount: number,
  mode: IdeaCommandOptions["mode"] = "repo-grounded"
): number {
  if (frameCount <= 0) return 0;
  const cap = mode === "repo-grounded" ? 4 : 2;
  return Math.min(cap, frameCount);
}

function renderFrameBullets(frameIds?: readonly IdeaFrameId[]): string {
  return resolveIdeaFrames(frameIds)
    .map((frame) => `   - ${frame.label} (\`${frame.id}\`)`)
    .join("\n");
}

function renderFrameNames(frameIds?: readonly IdeaFrameId[]): string {
  return resolveIdeaFrames(frameIds)
    .map((frame) => frame.label)
    .join(", ");
}

export function ideaCommandContract(options: IdeaCommandOptions = {}): string {
  const frames = resolveIdeaFrames(options.frameIds);
  const frameBullets = renderFrameBullets(options.frameIds);
  const minimumDistinctFrames = minimumDistinctIdeaFrames(frames.length, options.mode);
  return `# /cc-idea

## Purpose

Repository-improvement idea mode. Generate a ranked backlog of
high-value improvements, persist it as an artifact on disk, and end with
an explicit handoff — either launch \`/cc\` on a chosen candidate in the
same session, or save/discard the backlog.

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
- Idea mode only. Never mutate \`.cclaw/state/flow-state.json\`.
- Every recommendation cites evidence from the current repository
  (file path, command output, or knowledge-store entry id).
- Whenever you produce ideation output, persist it to
  \`${IDEA_ARTIFACT_PATTERN}\`. Chat-only output is not acceptable.
  The only exception is an explicit user-cancel from the resume prompt —
  in that case, write nothing and exit silently.
- Always end with a structured handoff prompt, not an open question
  (skipped on explicit cancel).

## Algorithm

1. **Resume check.** Glob \`${IDEA_ARTIFACT_GLOB}\`. If any artifact
   has been modified within the last ${IDEA_RESUME_WINDOW_DAYS} days,
   offer the user: continue that backlog, start fresh, or cancel.
2. **Mode classification.** Explicitly classify subject:
   \`repo-grounded\` / \`elsewhere-software\` / \`elsewhere-non-software\` / \`narrow\`.
   Do not assume repo-grounded by default. Repo-grounded scans keep the
   broadest frame minimum; narrow and non-repo modes use the smaller minimum
   shown below.
3. **Mode-aware grounding (parallel).**
   - Repo-grounded: repo signal scan + \`${RUNTIME_ROOT}/knowledge.jsonl\`
     repetition scan.
   - Elsewhere-software: docs-first grounding (Context7 and official docs).
   - Elsewhere-non-software: constraints and objective grounding.
4. **Divergent ideation frames (parallel).** Generate candidates with
   configured frames (${frames.length} total):
${frameBullets}
   Keep at least ${minimumDistinctFrames} distinct frame outputs in this rendered mode.
   Deterministic minimum: repo-grounded = 4, narrow/non-repo = 2, always capped
   by configured frame count.
5. **Adversarial critique pass.** For each candidate, write the strongest
   counter-argument, kill weak ideas, and keep survivors only.
6. **Produce 5-10 survivors** with impact (High/Medium/Low),
   effort (S/M/L), confidence (High/Medium/Low), **why now**, expected user impact, risk, and one evidence path per
   survivor.
7. **Rank by impact/effort/confidence** using
   \`(impact points / effort cost) * confidence multiplier\` and recommend
   the top survivor.
8. **Write the artifact** at
   \`${IDEA_ARTIFACT_PATTERN}\` using the schema in the skill.
8.5 **Seed shelf (optional).** For critiqued-out or deferred ideas that still
   show upside, write seed notes to
   \`${RUNTIME_ROOT}/seeds/SEED-<YYYY-MM-DD>-<slug>.md\` with
   \`trigger_when\`, hypothesis, and suggested action.
9. **Present the handoff prompt** with four concrete options — not A/B/C
   letters. Default = "Start /cc on the top recommendation".

## Headless mode (CI/automation only)

Headless envelopes are a machine-mode exception for CI/automation orchestration.
In normal interactive ideation, respond with natural language plus the artifact path.
For skill-to-skill invocation, emit exactly one JSON envelope:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"non-flow","payload":{"command":"/cc-idea","artifact":".cclaw/artifacts/idea-<date>-<slug>.md","recommendation":"I-1"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`npx cclaw-cli internal envelope-validate --stdin\`

## Primary skill

   **${RUNTIME_ROOT}/skills/${IDEA_SKILL_FOLDER}/SKILL.md**
`;
}

export function ideaCommandSkillMarkdown(options: IdeaCommandOptions = {}): string {
  const frames = resolveIdeaFrames(options.frameIds);
  const frameBullets = renderFrameBullets(options.frameIds);
  const minimumDistinctFrames = minimumDistinctIdeaFrames(frames.length, options.mode);
  const frameNames = renderFrameNames(options.frameIds);
  return `---
name: ${IDEA_SKILL_NAME}
description: "Repository idea mode: detect and rank high-leverage improvements, persist a backlog artifact, and hand off to /cc or save/discard."
---

# /cc-idea

## Announce at start

"Using flow-idea to identify highest-leverage improvements in this
repository. Will persist a ranked backlog to
\`${IDEA_ARTIFACT_PATTERN}\` and end with an explicit handoff."

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
- Do not start coding in idea mode.
- Do not mutate \`.cclaw/state/flow-state.json\` — idea mode sits outside
  the critical-path flow.
- Whenever ideation output is produced, persist the artifact file on disk
  before presenting the handoff. The only exception is an explicit user-cancel
  from the resume prompt — in that case, write nothing and exit silently.
- Always end with a structured handoff that names the concrete follow-up
  command for each option (skipped on explicit cancel). No A/B/C letters
  without command context.

## Protocol

### Phase 0 — Resume and classify

1. Use the harness's file-glob tool (\`Glob\` pattern
   \`${IDEA_ARTIFACT_GLOB}\` or equivalent \`ls\`/\`find\`).
2. Filter to files modified within the last ${IDEA_RESUME_WINDOW_DAYS} days.
3. If one or more match, present **one** structured ask using the
   harness's native tool (${STRUCTURED_ASK_TOOLS}) with options:
   - **Continue the existing backlog** — read the most-recent
     idea-*.md and work from its candidate list; skip re-scanning.
   - **Start a fresh scan** — proceed to Phase 1; the old artifact stays
     on disk for history.
   - **Cancel** — stop; do not scan or write anything.
4. If no recent artifact exists, proceed to Phase 1 silently.
5. Classify the ideation mode before grounding:
   - \`repo-grounded\` — explicitly tied to this repository.
   - \`elsewhere-software\` — software problem not tied to this repository.
   - \`elsewhere-non-software\` — process/business/non-software problem.
   - \`narrow\` — a focused prompt where broad frame coverage would be performative.
6. Record the chosen mode in the artifact.

### Phase 1 — Mode-aware grounding

Run grounding in parallel where available:

- For \`repo-grounded\`:
  - \`rg -n 'TODO|FIXME|XXX|HACK|TBD'\` grouped by file.
  - Test-runner output (\`npm test\`, \`pytest\`, \`go test ./...\`) — note
    failures, timeouts, deprecation warnings.
  - Module size outliers (\`wc -l\` or \`du\`) with weak direct test coverage.
  - Docs drift: check that \`README.md\` / \`docs/\` reference files that still
    exist and flags/APIs that still match \`src/\`.
  - \`${RUNTIME_ROOT}/knowledge.jsonl\` entries with recurring \`type\` in \`rule | pattern | lesson | compound\` and repeated \`trigger/action\` pairs; prefer clusters that already show stable \`origin_run\` history.
- For \`elsewhere-software\`:
  - Gather current framework/library docs first.
  - Add one comparison scan for established solutions.
- For \`elsewhere-non-software\`:
  - Capture objective, constraints, and measured friction before proposing fixes.

Record each finding with exact evidence (path, command, or doc source).

### Phase 2 — Divergent ideation

Generate candidate ideas by frame, in parallel when possible:

${frameBullets}

Require at least ${minimumDistinctFrames} distinct frames in this rendered mode. The
runtime rule is deterministic: repo-grounded scans require 4 distinct frames;
narrow, elsewhere-software, and elsewhere-non-software runs require 2; all modes
are capped by the configured frame count. Avoid frame-collapse (same idea
rewritten many times). Keep raw outputs for auditability.

### Phase 3 — Critique all, keep survivors

For each raw candidate:

- Write strongest argument **against** this idea.
- Identify disqualifiers (duplicate, weak evidence, poor ROI, wrong timing).
- Mark as \`survivor\` or \`critiqued-out\`.

Only survivors advance to ranking.

### Phase 4 — Rank and write the artifact

1. Keep 5–10 survivors.
2. For each survivor, include:
   - **ID** — \`I-1\`, \`I-2\`, …
   - **Title** — one short imperative phrase
   - **Impact** — High / Medium / Low
   - **Effort** — S / M / L
   - **Confidence** — High / Medium / Low
   - **Evidence** — path(s) or command output, inline if short
   - **Why now** — timing signal from repo evidence, user friction, repeated knowledge, or blocked flow
   - **Expected impact** — concrete user-facing benefit if this lands
   - **Risk** — main implementation/product risk to manage
   - **Counter-argument** — strongest concern that survived
   - **Next /cc prompt** — exact \`/cc <phrase>\` that starts the work
3. Sort by score \`(impact points / effort cost) * confidence multiplier\`
   and break ties with rationale strength.
4. Compute the artifact filename:
   - \`slug\` = first 3–5 words of the top recommendation, lowercase,
     non-alphanumeric collapsed to \`-\`, trimmed. When idea mode is
     focus-hinted (user passed an argument), use the focus hint instead.
   - \`date\` = today in \`YYYY-MM-DD\` (local time).
   - Path = \`.cclaw/artifacts/idea-<date>-<slug>.md\`.
5. Use the harness's write-file tool (\`Write\`, \`apply_patch\`, or shell
   \`cat <<EOF > path\`) to create the artifact with this schema:

   \`\`\`markdown
   # Ideation — <date>

   **Focus:** <user-supplied focus or "open-ended scan">
   **Mode:** <repo-grounded | elsewhere-software | elsewhere-non-software | narrow>
   **Generated:** <ISO-8601 timestamp>
   **Frames used:** <comma-separated list>
   **Raw candidates:** <N>
   **Critiqued out:** <M>
   **Recommendation:** I-1

   ## Grounding evidence

   - <signal and evidence>
   - ...

   ## Critiqued out

   | Idea | Why it was rejected |
   |---|---|
   | ... | ... |

   ## Ranked survivors

   | ID | Improvement | Why now | Expected impact | Risk | Impact | Effort | Confidence | Evidence | Next /cc prompt |
   |---|---|---|---|---|---|---|---|---|---|
| I-1 | Simplify a confusing generated prompt surface | Repeated blocker in generated UX | Faster operator recovery | Might over-trim context | High | S | High | <path-to-generated-surface> | \`/cc Simplify the confusing generated prompt surface while preserving behavior\` |
   | …   | …                                  | …    | … | …    | …                                     |

   ## Candidate detail

### I-1 — Simplify a confusing generated prompt surface
- **Evidence:** \`<path>\` contains repeated or stale guidance that a user would see.
- **Why now:** The prompt is on the daily /cc path, so confusion compounds quickly.
- **Expected impact:** Operators get a clearer next action without changing gates.
- **Risk:** Trimming too hard can remove useful orientation for new users.
- **Next /cc prompt:** \`/cc Simplify the confusing generated prompt surface while preserving behavior\`

   ### I-2 — …
   \`\`\`

6. Optional: for promising non-selected ideas, write
   \`${RUNTIME_ROOT}/seeds/SEED-<YYYY-MM-DD>-<slug>.md\` entries with:
   \`title\`, \`trigger_when\`, \`hypothesis\`, \`action\`, and
   \`source_artifact\` = idea artifact path.
7. Confirm in chat: "Wrote <path>."

### Phase 5 — Handoff prompt

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
   Next session: \`/cc-idea\` will offer to resume it.
4. **Discard** — delete the just-written artifact. Use only when the
   scan produced nothing actionable.

When the structured-ask tool is unavailable, fall back to a plain-text
lettered list with the same four labels. Do not invent extra options.

### Phase 6 — Execute the choice

- **Start /cc on I-1** or **different candidate:** announce
  "Handing off to /cc <phrase>" and load the \`using-cclaw\` router
  skill. From there, the normal \`/cc\` classification and stage flow
  takes over. Do not produce a second artifact; the idea file is
  preserved as the origin document for this run.
- **Save and close:** reply with the artifact path and stop.
- **Discard:** delete the artifact file, confirm deletion, stop.

## Do not

- Do not write into \`.cclaw/artifacts/0X-*.md\` (stage artifacts).
- Do not mutate \`.cclaw/state/flow-state.json\` at any phase.
- Do not end the turn with an ungrounded "pick one" question — every
  option in the handoff prompt must reference a concrete command.
- Do not collapse all ideas into one frame; distribute across:
  ${frameNames}.
`;
}

