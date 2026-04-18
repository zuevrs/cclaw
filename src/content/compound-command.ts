import { RUNTIME_ROOT } from "../constants.js";

const COMPOUND_SKILL_FOLDER = "flow-compound";
const COMPOUND_SKILL_NAME = "flow-compound";

export function compoundCommandContract(): string {
  return `# /cc-ops compound

## Purpose

Lift repeated lessons from \`${RUNTIME_ROOT}/knowledge.jsonl\` into durable
project assets (rules, protocols, skills) so the next run is easier and safer.

Auto-triggered by \`/cc-next\` when \`closeout.shipSubstate === "compound_review"\`.
Direct invocation is supported but rarely needed.

## HARD-GATE

- Do not mutate rules/skills/protocols without explicit user approval.
- Every proposal must cite concrete knowledge evidence (line refs or IDs).
- Keep scope focused: one compound change set per run.
- Do not block the archive step if no clusters qualify — record an empty
  compound pass and advance.

## Inputs

\`/cc-ops compound\` (no flags). The structured ask presents candidates;
the user can approve individual lifts, accept-all, or skip.

## Algorithm

1. Read \`${RUNTIME_ROOT}/knowledge.jsonl\` (strict JSONL, one entry per line).
2. Cluster entries by \`trigger\` + \`action\` similarity.
3. Filter candidates whose recurrence count >= 3.
4. If **no candidates** exist:
   - set \`closeout.compoundCompletedAt = <ISO>\`,
   - set \`closeout.compoundPromoted = 0\`,
   - set \`closeout.shipSubstate = "ready_to_archive"\`,
   - emit \`compound: no candidates | next: /cc-next\` and stop.
5. **Drift check** each surviving candidate before presenting it (see
   "Drift check" section in the skill): confirm the lift target file is
   current, spot-check the repo for contradictions, demote stale clusters
   into a new superseding entry instead of a lift.
6. Otherwise, present **one** structured ask (AskUserQuestion / AskQuestion /
   plain text) summarising all candidates at once:
   - \`apply-all\` (default) — apply every listed lift,
   - \`apply-selected\` — prompt per-candidate,
   - \`skip\` — record a skip reason and advance without changes.
7. Apply approved lifts to the target file(s). Each lift also appends a
   \`type: "compound"\` entry back to \`${RUNTIME_ROOT}/knowledge.jsonl\`
   summarising what was lifted.
8. Update flow-state:
   - \`closeout.compoundCompletedAt = <ISO>\`,
   - \`closeout.compoundPromoted = <count>\`,
   - \`closeout.compoundSkipped = true\` if user picked skip,
   - \`closeout.shipSubstate = "ready_to_archive"\`.
9. Emit one-line summary: \`compound: promoted=<N> skipped=<bool> | next: /cc-next\`.

## Primary skill

**${RUNTIME_ROOT}/skills/${COMPOUND_SKILL_FOLDER}/SKILL.md**
`;
}

export function compoundCommandSkillMarkdown(): string {
  return `---
name: ${COMPOUND_SKILL_NAME}
description: "Lift repeated learnings into durable rules/protocols/skills. Auto-triggered after retro accept."
---

# /cc-ops compound

## Announce at start

"Using flow-compound to lift repeated learnings into durable workflow assets."

## HARD-GATE

No silent codification. Every lift requires explicit user approval. An
empty pass is allowed and must advance \`closeout.shipSubstate\` to
\`"ready_to_archive"\`.

## Protocol

1. Parse \`.cclaw/knowledge.jsonl\` and group repeated lessons by
   trigger+action similarity.
2. Keep only candidates with recurrence >= 3 and an actionable lift path.
3. If none qualify, record an empty pass:
   - \`closeout.compoundCompletedAt = <ISO>\`,
   - \`closeout.compoundPromoted = 0\`,
   - \`closeout.shipSubstate = "ready_to_archive"\`,
   - announce \`compound: no candidates\` and stop.
4. **Drift check — run before presenting any candidate.** Knowledge lines
   are append-only, so textual repetition alone does not prove the rule is
   still true. For every cluster that survives the recurrence filter:

   - **Read the lift target.** Open the rule/protocol/skill file you would
     edit. If the current contents already encode a stronger version of
     the cluster's \`action\`, drop the candidate (nothing to lift).
   - **Grep for contradictions.** Run a quick repo search on the cluster's
     \`trigger\` keywords. If recent code or docs contradict the cluster,
     treat the cluster as stale.
   - **Check age.** Inspect \`last_seen_ts\` across the cluster's lines. If
     every contributing line is older than ~90 days with no fresh
     observation, treat the cluster as stale.
   - **Handle stale clusters correctly.** Do **not** silently skip them.
     Append a new superseding \`type: "lesson"\` line to
     \`.cclaw/knowledge.jsonl\` whose \`trigger\` explicitly references the
     old pattern (e.g. \`"when previous rule about X no longer holds: ..."\`)
     and whose \`action\` documents the replacement or archive reason.
     Then drop the candidate from the lift list.
   - **Cite line IDs.** Every surviving candidate must list the concrete
     knowledge line indices (1-based) that back it, not just a
     summary string. This is what makes the lift auditable.
   - Optionally invoke the \`knowledge-curation\` utility skill's
     stale/duplicate/supersede heuristics if you want a second pass.

5. Otherwise, render each candidate as:

\`\`\`
Candidate: <short title>
Evidence: <knowledge line-ids>
Freshness: <newest last_seen_ts among evidence lines>
Lift target: <rule/protocol/skill file>
Change type: <add/update/remove>
Expected benefit: <what regressions this prevents>
\`\`\`

6. Present **one** structured question with three options:
   - \`apply-all\` (default) — apply every candidate,
   - \`apply-selected\` — prompt per-candidate approval next,
   - \`skip\` — record a skip reason and advance.

7. For approved candidates:
   - edit the target file(s) with the lift,
   - append a \`type: "compound"\` entry to \`.cclaw/knowledge.jsonl\`
     describing what was promoted, including the source line IDs.

8. Update flow-state \`closeout\`:
   - \`compoundCompletedAt\`,
   - \`compoundPromoted\` (count),
   - \`compoundSkipped\` (boolean) + \`compoundSkipReason\` when applicable,
   - \`shipSubstate = "ready_to_archive"\`.

## Resume semantics

A new session with \`shipSubstate === "compound_review"\` re-runs the scan
and re-asks the structured question. If the user already applied lifts in
a previous session but the state file was not updated, they should pick
\`skip\` with reason \`already-applied\` — compound is idempotent from the
closeout chain's perspective.

## Validation

- \`closeout.compoundCompletedAt\` is set.
- \`closeout.shipSubstate === "ready_to_archive"\`.
- If lifts were applied, the target files show the edit and at least one
  new \`compound\` line exists in \`.cclaw/knowledge.jsonl\`, and the new
  line references the source knowledge line IDs.
- If drift check demoted any cluster, a new superseding \`lesson\` line
  exists on the same run documenting the replacement.
`;
}
