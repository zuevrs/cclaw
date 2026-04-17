import { RUNTIME_ROOT } from "../constants.js";

const IDEATE_SKILL_FOLDER = "flow-ideate";
const IDEATE_SKILL_NAME = "flow-ideate";

export function ideateCommandContract(): string {
  return `# /cc-ideate

## Purpose

Repository-improvement discovery mode. Generate a ranked backlog of high-value
improvements before committing to a specific feature request.

## HARD-GATE

- This is discovery mode only. Do not start implementation automatically.
- Every recommendation must include evidence from the current repository.
- End with a decision prompt: pick one candidate or cancel.

## Algorithm

1. Scan repo signals:
   - open TODO/backlog notes
   - flaky or failing tests
   - oversized modules / complexity hotspots
   - docs drift vs changed code
   - repeated learnings from \`.cclaw/knowledge.jsonl\`
2. Produce 5-10 candidates with:
   - impact (High/Medium/Low)
   - effort (S/M/L)
   - confidence (High/Medium/Low)
   - evidence path(s)
3. Rank candidates by impact/effort ratio.
4. Present one recommendation as default.
5. Ask user to choose:
   - (A) start with recommended item
   - (B) choose another candidate
   - (C) cancel

## Primary skill

**${RUNTIME_ROOT}/skills/${IDEATE_SKILL_FOLDER}/SKILL.md**
`;
}

export function ideateCommandSkillMarkdown(): string {
  return `---
name: ${IDEATE_SKILL_NAME}
description: "Repository ideation mode: detect and rank high-leverage improvements before implementation."
---

# /cc-ideate

## Announce at start

"Using flow-ideate to identify highest-leverage improvements in this repository."

## HARD-GATE

Do not start coding in ideate mode. End with an explicit user choice.

## Protocol

1. Collect evidence from the current repo state.
2. Build candidate improvements with impact/effort/confidence.
3. Rank and recommend one candidate.
4. Ask for explicit selection.
5. If user selects a candidate, hand off to \`/cc <selected idea>\`.

## Candidate format

| ID | Improvement | Impact | Effort | Confidence | Evidence |
|---|---|---|---|---|---|
| I-1 |  | High/Medium/Low | S/M/L | High/Medium/Low | path or command evidence |
`;
}
