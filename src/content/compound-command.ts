import { RUNTIME_ROOT } from "../constants.js";

const COMPOUND_SKILL_FOLDER = "flow-compound";
const COMPOUND_SKILL_NAME = "flow-compound";

export function compoundCommandContract(): string {
  return `# /cc-ops compound

## Purpose

Lift repeated lessons into durable project assets (rules, protocols, skills)
so the next run is easier and safer.

## HARD-GATE

- Do not mutate rules/skills without explicit user approval.
- Every proposal must cite concrete knowledge evidence (line references or IDs).
- Keep scope focused: one compound change set per run.

## Algorithm

1. Read \`${RUNTIME_ROOT}/knowledge.jsonl\`.
2. Cluster repeated trigger/action pairs.
3. For clusters with frequency >= 3, propose one lift action:
   - rule update
   - protocol update
   - utility skill update
4. For each proposal include:
   - why now
   - target file(s)
   - expected risk reduction
5. Ask user approval for each proposal before writing.
6. Apply approved lifts and record completion in retro artifact.

## Primary skill

**${RUNTIME_ROOT}/skills/${COMPOUND_SKILL_FOLDER}/SKILL.md**
`;
}

export function compoundCommandSkillMarkdown(): string {
  return `---
name: ${COMPOUND_SKILL_NAME}
description: "Compound mode: convert repeated learnings into durable rules/protocols/skills."
---

# /cc-ops compound

## Announce at start

"Using flow-compound to lift repeated learnings into durable workflow assets."

## HARD-GATE

No silent codification. Every lift requires explicit user approval.

## Protocol

1. Parse \`.cclaw/knowledge.jsonl\` and group repeated lessons.
2. Keep only candidates with clear recurrence and actionable lift path.
3. Propose each candidate using this template:

\`\`\`
Candidate: <short title>
Evidence: <knowledge refs>
Lift target: <rule/protocol/skill file>
Change type: <add/update/remove>
Expected benefit: <what regressions this prevents>
\`\`\`

4. Ask user to approve/reject per candidate.
5. Apply only approved candidates.
6. Append a \`compound\` learning entry summarizing what was lifted.
`;
}
