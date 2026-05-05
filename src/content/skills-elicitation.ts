import { RUNTIME_ROOT } from "../constants.js";
import { questionBudgetHint } from "../track-heuristics.js";

const ELICITATION_STAGES = ["brainstorm", "scope", "design"] as const;

function renderQuestionBudgetHintTable(): string {
  const rows: string[] = [];
  for (const mode of ["lean", "guided", "deep"] as const) {
    for (const stage of ELICITATION_STAGES) {
      const hint = questionBudgetHint(mode, stage);
      rows.push(
        `| \`${mode}\` | \`${stage}\` | ${hint.min} | ${hint.recommended} | ${hint.hardCapWarning} |`
      );
    }
  }
  return `| Discovery mode | Stage | Min | Recommended | Hard cap warning |
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
- **Good**: User asks for a "simple web app" -> agent asks Q1 (what pain) -> Q2 (direct path) -> Q3 (first operator/user) -> Q4 (no-go boundaries) -> self-eval: clear -> drafts the brainstorm artifact.

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
- **Early-loop ledger discipline**: Never append \`.cclaw/state/early-loop-log.jsonl\` rows whose \`iteration\` exceeds the active \`maxIterations\`. If the cap fired, escalate or accept convergence outcomes—do not bump the iteration counter afterward. \`deriveEarlyLoopStatus\` clamps persistence, but the log source should stay honest too.
- **Convergence floor (a.k.a. "Q&A Ralph Loop" / "Elicitation Convergence")**: do NOT advance the stage (do NOT call \`stage-complete.mjs\`) until Q&A converges. The machine contract matches \`evaluateQaLogFloor\` in \`src/artifact-linter/shared.ts\` (rule \`qa_log_unconverged\`). Pass when ANY holds: (a) every forcing-question topic id is tagged \`[topic:<id>]\` on at least one \`## Q&A Log\` row; (b) the Q&A Ralph Loop detector fires (last 2 substantive rows are non-decision-changing: \`skip\`/\`continue\`/\`no-change\`/\`done\`/etc.) **and** the log has at least \`max(2, questionBudgetHint(discoveryMode, stage).min)\` substantive rows — **unless** \`discoveryMode\` is \`guided\` or \`deep\` with pending forcing-topic ids (then the Q&A Ralph Loop alone cannot pass until topics are tagged, a stop-signal is recorded, or \`--skip-questions\` downgrades the finding to advisory); (c) an explicit user stop-signal row; or (d) \`--skip-questions\` was persisted (unconverged is advisory only). made \`[topic:<id>]\` mandatory (no English keyword fallback). The "Q&A Ralph Loop" is the elicitation-stage convergence mechanism; the producer/critic Concern Ledger that drives early-stage iteration is the **Early-Loop**, persisted in \`.cclaw/state/early-loop-log.jsonl\` and \`early-loop.json\` — they are different machines, do not conflate them.
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

Label disambiguation: The word **skip** is a valid stop phrase during brainstorm/scope/design Q&A. In ship closeout retros, compound clustering, or any structured retro ask, expose **no changes** / **accept as-is** for the passive option instead of wording it as "skip" so agents do not mix elicitation stop-signals with closeout choreography.

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

## Question Budget Hint (\`questionBudgetHint\` — min rows feed the convergence floor)

Source of truth: \`questionBudgetHint(discoveryMode, stage)\`. The \`Min\` column is **not advisory** for the Q&A Ralph Loop exit: \`evaluateQaLogFloor\` requires at least \`max(2, Min)\` substantive rows before the no-new-decisions path can converge (other exits — full topic coverage, stop-signal, \`--skip-questions\` advisory — ignore that minimum). \`Recommended\` and \`Hard cap warning\` remain pacing hints for the harness.

${budgetTable}

Default mapping note: \`lean\` maps to a lightweight specialist tier on early stages, \`guided\` to standard, \`deep\` to deep; risk signals can escalate further.

**Walk the forcing questions list one-by-one in order, asking each as a separate turn.** Do NOT batch. Do NOT pick favorites — go in order. For each question record one of:
- \`asked\` — question was asked and answered.
- \`asked (confirmed assumption)\` — question was asked, user confirmed your prior reading.
- \`skipped (already covered: turn N)\` — answered implicitly by an earlier reply; cite the turn.
- \`waived (user override)\` — user explicitly waived this question.

### Topic tagging (MANDATORY for forcing-question rows)

Each forcing question has a stable topic id (kebab-case ASCII, e.g. \`pain\`, \`direct-path\`, \`data-flow\`). Tag the matching Q&A Log row's \`Decision impact\` cell with \`[topic:<id>]\` so the linter can verify coverage in any natural language. This is a **HARD requirement** in the linter no longer keyword-matches English question prose, so an un-tagged row does NOT count toward coverage even if the answer fully addresses the topic.

RU example (after asking \`pain\` in Russian):

\`\`\`
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Какую боль мы решаем? | Регистрация занимает 30 минут. | scope-shaping [topic:pain] |
\`\`\`

Multiple tags in one row are allowed when one answer covers several topics: \`[topic:pain] [topic:direct-path]\`. Stop-signal rows do NOT need a tag.

Stage forcing question lists (id → topic):

- **Brainstorm**:
  - \`pain\` — What pain are we solving?
  - \`direct-path\` — What is the most direct path?
  - \`operator\` — Who is the operator/user impacted first?
  - \`no-go\` — What are non-negotiable no-go boundaries?
- **Scope**:
  - \`in-out\` — What is definitely in and definitely out?
  - \`locked-upstream\` — Which decisions are already locked upstream?
- **Design**:
  - \`data-flow\` — What is the data flow end-to-end?
  - \`seams\` — Where are the seams/interfaces and ownership boundaries?
  - \`invariants\` — Which invariants must always hold?
  - \`not-refactor\` — What will we explicitly NOT refactor now?

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
