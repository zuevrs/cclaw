import { RUNTIME_ROOT } from "../constants.js";
import { questionBudgetHint } from "../track-heuristics.js";
import { FLOW_TRACKS } from "../types.js";

const ELICITATION_STAGES = ["brainstorm", "scope", "design"] as const;

function renderQuestionBudgetHintTable(): string {
  const rows: string[] = [];
  for (const track of FLOW_TRACKS) {
    for (const stage of ELICITATION_STAGES) {
      const hint = questionBudgetHint(track, stage);
      rows.push(
        `| \`${track}\` | \`${stage}\` | ${hint.min} | ${hint.recommended} | ${hint.hardCapWarning} |`
      );
    }
  }
  return `| Track | Stage | Min | Recommended | Hard cap warning |
|---|---|---|---|---|
${rows.join("\n")}`;
}

export function adaptiveElicitationSkillMarkdown(): string {
  const budgetTable = renderQuestionBudgetHintTable();
  return `---
name: adaptive-elicitation
description: "Harness-native one-question-at-a-time dialogue for brainstorm/scope/design with stop signals, smart-skip, and append-only Q&A logging."
---

# Adaptive Elicitation

Pinned anchor: "Don't tell it what to do, give it success criteria and watch it go."

## HARD-GATE
- User does not run cclaw manually. Do not tell the user to run CLI commands for answers.
- Ask exactly one question per turn and wait for the answer before asking the next one.
- Use harness-native question tools first; prose fallback is allowed only when the tool is unavailable.
- Keep a running Q&A trace in the active artifact under \`## Q&A Log\` in \`${RUNTIME_ROOT}/artifacts/\` as append-only rows.

## Harness Question Surface

Preferred native tool names:
- Claude Code: \`AskUserQuestion\`
- Codex: \`request_user_input\`
- Gemini: \`ask_user\`
- Cursor: \`AskQuestion\`

If unavailable, ask one concise prose question and explicitly wait for chat answer.

## Core Protocol

1. Ask one decision-changing question.
2. Wait for the answer.
3. Append one row to \`## Q&A Log\`: \`Turn | Question | User answer (1-line) | Decision impact\`.
4. Self-evaluate:
   - What did I learn?
   - Is context enough to draft now? (yes/no + reason)
   - If no, what is the next most decision-changing question?
5. Repeat until context is clear OR user asks to proceed.

## Question Shape Rules

- Prefer single-select multiple choice when one direction/priority/next step must be chosen.
- Use multi-select only for compatible sets (goals, constraints, non-goals).
- Smart-skip questions already answered earlier (directly or implicitly) and log "skipped (already covered)" when relevant.

## Stop Signals (Natural Language)

Treat these as stop-and-draft signals:
- RU: "достаточно", "хватит", "давай драфт"
- EN: "enough", "skip", "just draft it", "stop asking", "move on"
- UA: "досить", "вистачить", "давай драфт", "рухаємось далі"

When detected:
- Do not ask another question in this stage loop.
- Move to drafting with available context.
- For internal agent calls only, pass \`--skip-questions\` on the next advance helper call.

## Conditional Grilling (Only On Risk Triggers)

Ask an extra 3-5 sharp questions only when one of these triggers appears:
- Irreversibility (data deletion, schema migration, breaking API/contract)
- Security/auth boundary changes
- Domain-model ambiguity with multiple plausible invariants

Do not ask extra questions "for theater" on simple low-risk work.

## Question Budget Hint (Soft Guidance)

Use as orientation, never as a hard stop. Source of truth is \`questionBudgetHint(track, stage)\`:

${budgetTable}

Track mapping note: \`quick\` ~= lightweight, \`medium\` ~= standard, \`standard\` ~= deep.
Stop based on clarity/user signal, not raw count.

## Stage Forcing Questions

Always keep at least one unresolved forcing question in play until answered or explicitly waived:

- Brainstorm:
  - What pain are we solving?
  - What is the most direct path?
  - What happens if we do nothing?
  - Who is the operator/user impacted first?
  - What are non-negotiable no-go boundaries?
- Scope:
  - What is definitely in and definitely out?
  - Which decisions are already locked upstream?
  - What is the rollback path if this fails?
  - What are the top failure modes we must design for?
- Design:
  - What is the data flow end-to-end?
  - Where are the seams/interfaces and ownership boundaries?
  - Which invariants must always hold?
  - What will we explicitly NOT refactor now?

## One-Way Override (Irreversible Decisions)

For irreversible moves (deletion, schema migration, breaking API):
- Ask for explicit confirmation even if user asked to stop questions.
- Proceed only after explicit override ("I understand the irreversible risk; proceed").
- Record the override in \`## Q&A Log\` and in the stage artifact decision section.

## Completion Rule

"Continue until clear OR user wants to proceed."
Never force a fixed N-question script.`;
}
