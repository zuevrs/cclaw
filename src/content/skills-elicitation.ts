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
description: "Harness-native one-question-at-a-time dialogue for brainstorm/scope/design with stop signals, smart-skip, and append-only Q&A logging. Walking forcing questions in order is mandatory; the linter blocks stage-complete when Q&A Log is below floor."
---

# Adaptive Elicitation

Pinned anchor: "Don't tell it what to do, give it success criteria and watch it go."

## Anti-pattern (BAD examples — never do these)

These behaviors are the exact reason this skill exists. The linter will block your stage-complete if you do them.

- **Bad**: User asks for a "simple web app" -> agent asks 1 question about stack -> 1 question about auth -> drafts the brainstorm artifact and asks for approval.
- **Good**: User asks for a "simple web app" -> agent asks Q1 (what pain) -> Q2 (direct path) -> Q3 (do-nothing cost) -> Q4 (first operator/user) -> Q5 (no-go boundaries) -> self-eval: clear -> drafts the brainstorm artifact.

- **Bad**: Agent immediately dispatches a subagent (\`product-discovery\`, \`critic\`, \`planner\`) at the start of brainstorm/scope/design to "gather context" before any user dialogue.
- **Good**: Agent walks the Q&A loop with the user first; subagent dispatch happens only after the user approves the elicitation outcome.

- **Bad**: Agent batches 3-5 grill questions into one large message and asks the user to answer them all at once.
- **Good**: Agent asks one grill question, waits, logs the answer, asks the next.

- **Bad**: Agent skips forcing questions because it "already has a good idea" of the answer.
- **Good**: Agent asks the forcing question; if the user's reply confirms the assumption, log it as \`asked (confirmed assumption)\` and move on. Do not silently skip.

## HARD-GATE (machine-enforced)

- User does not run cclaw manually. Do not tell the user to run CLI commands for answers.
- Ask exactly one question per turn and wait for the answer before asking the next one.
- Use harness-native question tools first; prose fallback is allowed only when the tool is unavailable.
- Keep a running Q&A trace in the active artifact under \`## Q&A Log\` in \`${RUNTIME_ROOT}/artifacts/\` as append-only rows.
- **Convergence floor**: do NOT advance the stage (do NOT call \`stage-complete.mjs\`) until Q&A converges. Convergence is reached when ANY of: (a) all forcing-question topics are addressed in \`## Q&A Log\`, (b) the last 2 substantive rows produce no decision-changing impact (\`skip\`/\`continue\`/\`no-change\`/\`done\`), or (c) an explicit user stop-signal row is recorded. The linter rule \`qa_log_unconverged\` enforces this; \`stage-complete\` will fail otherwise. Wave 23 (v5.0.0) replaced the fixed-count floor with this convergence detector.
- **NEVER run shell hash commands** (\`shasum\`, \`sha256sum\`, \`md5sum\`, \`Get-FileHash\`, \`certutil\`, etc.) to compute artifact hashes. If a linter ever asks you for a hash, that is a linter bug — report failure and stop, do not auto-fix in bash.
- **NEVER paste cclaw command lines into chat** (e.g. \`node .cclaw/hooks/stage-complete.mjs ... --evidence-json '{...}'\`). Run them via the tool layer; report only the resulting summary. The user does not run cclaw manually and seeing the command line is noise.

## Harness Question Surface

Preferred native tool names:
- Claude Code: \`AskUserQuestion\`
- Codex: \`request_user_input\`
- Gemini: \`ask_user\`
- Cursor: \`AskQuestion\`

If unavailable, ask one concise prose question and explicitly wait for chat answer.

## Core Protocol

1. Ask one decision-changing question via the harness-native question tool.
2. Wait for the answer.
3. Append one row to \`## Q&A Log\`: \`Turn | Question | User answer (1-line) | Decision impact\`.
4. Self-evaluate:
   - What did I learn?
   - Is context enough to draft now? (yes/no + reason)
   - Have I covered all stage forcing questions in order? (yes/no + which remain)
   - If forcing questions remain or context is incomplete, what is the next decision-changing question?
5. Repeat until **all forcing questions are answered/skipped/waived AND self-evaluation says context is sufficient**, OR user records an explicit stop-signal row.

## Question Shape Rules

- Prefer single-select multiple choice when one direction/priority/next step must be chosen.
- Use multi-select only for compatible sets (goals, constraints, non-goals).
- Smart-skip: if a question is already answered earlier (directly or implicitly), log \`skipped (already covered: turn N)\` instead of skipping silently. The smart-skip row counts as a substantive Q&A Log entry for floor purposes.

## Stop Signals (Natural Language)

Treat these as stop-and-draft signals:
- RU: "достаточно", "хватит", "давай драфт", "хватит вопросов"
- EN: "enough", "skip", "just draft it", "stop asking", "move on", "no more questions"
- UA: "досить", "вистачить", "давай драфт", "рухаємось далі"

When detected:
- Append a Q&A Log row exactly like: \`Turn N | (stop-signal) | <user quote> | stop-and-draft\` — this row satisfies the linter floor escape hatch.
- Do not ask another question in this stage loop.
- Move to drafting with available context.
- For the next internal agent-only call to advance-stage, pass \`--skip-questions\`. **The user never sees or types this flag.**

## Conditional Grilling (Only On Risk Triggers)

When one of these triggers appears, continue the elicitation loop with sharper questions **one at a time** (do NOT batch them):
- Irreversibility (data deletion, schema migration, breaking API/contract)
- Security/auth boundary changes
- Domain-model ambiguity with multiple plausible invariants

Each grill question follows the same Core Protocol: ask one, wait, log, self-eval, ask next.

Do not ask extra questions "for theater" on simple low-risk work.

## Question Budget Hint (advisory only — Wave 23 dropped the count floor)

Source of truth: \`questionBudgetHint(track, stage)\`. The numbers below are
**soft hints** for harness UI and elicitation pacing; gate blocking is done
by the \`qa_log_unconverged\` rule (Ralph-Loop convergence detector), NOT by
a fixed count.

${budgetTable}

Track mapping note: \`quick\` ~= lightweight, \`medium\` ~= standard, \`standard\` ~= deep.

How to use the columns:
- \`Min\` — soft minimum to surface forcing questions; not a blocking gate.
- \`Recommended\` — target for normal flows.
- \`Hard cap warning\` — point at which to stop or compress remaining forcing questions into one final batched ask. Not skip.

## Stage Forcing Questions (walk in order, one per turn)

**Walk the forcing questions list one-by-one in order, asking each as a separate turn.** Do NOT batch. Do NOT pick favorites — go in order. For each question record one of:
- \`asked\` — question was asked and answered.
- \`asked (confirmed assumption)\` — question was asked, user confirmed your prior reading.
- \`skipped (already covered: turn N)\` — answered implicitly by an earlier reply; cite the turn.
- \`waived (user override)\` — user explicitly waived this question.

Stage forcing question lists:

- **Brainstorm**:
  - What pain are we solving?
  - What is the most direct path?
  - What happens if we do nothing?
  - Who is the operator/user impacted first?
  - What are non-negotiable no-go boundaries?
- **Scope**:
  - What is definitely in and definitely out?
  - Which decisions are already locked upstream?
  - What is the rollback path if this fails?
  - What are the top failure modes we must design for?
- **Design**:
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

Continue asking forcing questions in order until one of:
- (a) all forcing questions for the stage are answered/skipped/waived AND self-evaluation says context is sufficient, OR
- (b) user records an explicit stop-signal row in \`## Q&A Log\`, OR
- (c) the \`hard cap warning\` count is reached and you compressed the remaining forcing questions into one final batched ask (not skip).

Do NOT exit the loop after the first 1-2 questions just because you can draft something. The point of the loop is to surface the user's actual constraints, not to confirm your initial reading.`;
}
