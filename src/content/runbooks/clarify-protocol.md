# Clarify protocol

The architect's Phase −1 Clarify inner detail: 4-dimension scoring math, gap-lens table, challenge-mode stance rotation, hide-render decision, and the anti-rationalization table. Lifted out of `agents/architect.md` to keep the in-prompt anchor short (~6 lines) while preserving the math-gated exit semantics.

The architect's in-prompt body keeps the **entry condition** (`clarify_opens = (ambiguityScore >= threshold) AND (ceremonyMode != "inline")`), the **one-question-per-turn discipline**, the **early-exit signal set** (user says "ready"/"go"/"proceed"), and the **carry-over rule** for plan.md's `## Assumptions (correct me now)` section. Everything below is the inner machinery the architect references when actually composing each round's question.

## Per-dimension ambiguity scoring (silent-orchestrator)

After every user answer (including before the FIRST question, on the silent pre-Clarify score), compute four scores in `[0.0, 1.0]` (1.0 = "this dimension is fully clear; no further question needed"):

| Dimension | Weight | What it measures |
| --- | --- | --- |
| `goal` | 0.4 | Primary-objective clarity. Can you state the one-sentence goal without qualifiers? Are the key nouns + verbs unambiguous? |
| `constraints` | 0.3 | Boundary clarity. Are the limitations, non-goals, compatibility requirements, and out-of-scope cuts named? |
| `criteria` | 0.3 | Verification clarity. Could you write a test or AC that proves the task shipped? Are the pass/fail signals concrete? |
| `context` | 0.0 | Repo / existing-system clarity. Do you understand the surrounding code well enough to modify it safely? **Informational, not gating** — surfaced to the user so they can volunteer pointers, but the math-gated exit does NOT block on context. |

Compute the scalar:

```text
ambiguity = 1 - (goal * 0.4 + constraints * 0.3 + criteria * 0.3 + context * 0.0)
```

`context * 0.0` is deliberate: a brownfield project may have unknowable context (parts of the repo you haven't read yet); blocking on it would prevent Clarify from ever exiting on a fresh codebase. The architect's Phase 0 Bootstrap reads enough context BEFORE the plan lands; Clarify is about pinning the *task*, not the *repo*.

**Math-gated exit:** stop early when `ambiguity < 0.25` (i.e. weighted-score sum > 0.75 across the gating dimensions goal/constraints/criteria). The threshold matches the deep-interview reference's clarity threshold and fires in addition to the user-signal exit and the round cap.

**Targeting the next question:** the next question MUST target the **weakest dimension** (lowest `score`) among `{goal, constraints, criteria, context}` after the user's last answer. Ties: prefer the dimension with the higher weight (goal > constraints = criteria > context). Weight resolves *ties* between equal-low scores; it does NOT pre-empt the score.

## Gap-lens table (everyinc-compound Phase 1.2)

Re-use the four gap lenses when composing the question — the mapping from triage signal to dimension to lens to question template:

| Dimension | Triage signal (canonical match) | Lens | Question template |
| --- | --- | --- | --- |
| `goal` | `vague-verbs` | **specificity** | "When you said `<verb>`, what concrete change would you want to see in the diff / on the screen / in the test output? Pick one example you'd recognise as 'done'." |
| `criteria` | `missing-AC` | **evidence** | "What's the one thing that, if true after this lands, would convince you the work shipped successfully? Cite a test, a metric, a user-visible behaviour, or an error condition that should be gone." |
| `constraints` | `multiple-interpretations` | **counterfactual** | "I can read `<task>` as either A or B (give two concrete plausible interpretations the prompt could land). Which one do you mean — or is it a third reading I'm missing?" |
| `context` | `no-concrete-names` | **attachment** | "Which file / module / function does this live in? If you don't know yet, point me at the symptom (an error log, a screenshot, a test that fails today) so I can find it." |

You may compose the question in the user's language; the template wording is a starting point, not a literal phrase to paste. Keep each question SHORT (one sentence; max two if the second sentence is the example).

## Challenge-mode stance rotation (internal stance, no user-visible label)

To prevent the late rounds from devolving into incremental clarifications of the same framing, rotate the question stance on the late rounds. The stance is an internal authoring guide for the orchestrator's question composition; do NOT prefix the question with the stance label (no "Round 4 — Contrarian mode:" header in the user-visible turn). The user sees a single question with a single stance behind it; the rotation is the orchestrator's discipline, not a surface artifact.

- **Round 4 stance — contrarian.** Before composing round 4's question, ask yourself "what if the opposite were true?" or "what if this constraint doesn't actually exist?". The goal is to test whether the user's framing is correct or just habitual. The question still targets the weakest dimension; the *stance* is contrarian. Example: if `constraints` is the weakest dimension and the user has assumed all reads must hit Postgres, ask "what if reads could be served from a stale cache for 60s — would that break your goal?".
- **Round 5 stance — simplifier.** Before composing round 5's question, ask "what's the simplest version that would still be valuable?" or "which of these constraints are actually necessary vs. assumed?". The goal is to find the minimal viable specification. Example: if the user has been piling on requirements, ask "if you had to ship something in two hours, which of the AC you've listed would you drop first?".

The rotation reference is `oh-my-claudecode/skills/deep-interview/SKILL.md > "Phase 3: Challenge Agents"`. Rounds 1-3 are open-ended questions in the four gap-lens style (specificity / evidence / counterfactual / attachment); rounds 4-5 carry the contrarian / simplifier stance internally — the user just sees the question. Earlier exit (math-gated or user-signal) skips the rotation entirely — most flows close out by round 3 and never see the contrarian stance.

## Hide-render rule

**Do NOT render the per-round score table to the user.** The 4-row `Dimension / Score / Weight / Why` block and the trailing `Next target: <weakest-dimension>` line are **internal** to the orchestrator — compute them, use them to pick the weakest dimension, persist them to `flow-state.json > clarifyRounds[]`, but do NOT emit them in chat. The user sees only the next question (one sentence, one turn, one reply). Rendering the table is a dominant friction signal — users read the table once, then start skimming the question and missing the targeted dimension; hiding the table puts the question back at the centre of the dialogue.

Stamp every round into `flow-state.json > clarifyRounds[]` (append-only) as a `ClarifyRoundState` entry (`{ round, dimensionScores, ambiguity, targetedDimension, question }`). The persisted array is the canonical audit trail downstream specialists / learnings capture read AND the only durable record of the round-by-round math — compound learnings, the post-ship audit, and any future "why did we ask question 3?" trace all read the persisted scores. The render absence is user-facing only; the math itself persists with full fidelity.

## Choosing which question to ask (per-round procedure)

1. Score the current state across all 4 dimensions (use the rationale column to record what each score reflects).
2. Compute `ambiguity` per the formula. If `ambiguity < 0.25`, exit Clarify immediately — no further question.
3. Identify the **weakest dimension** (lowest score; tiebreaker prefers higher weight: goal > constraints = criteria > context).
4. Map the dimension to its lens + question template via the table above. If the round number is 4, apply contrarian stance (silently); if round 5, apply simplifier stance (silently). Do NOT prefix the question with a stance label — the user reads a single question, not a stance header.
5. Compose the question in the user's language; keep it short (one sentence + optional example).
6. Persist the round's full scores + targeted dimension + question into `flow-state.json > clarifyRounds[]` (the persisted audit trail replaces the user-visible per-round table; render the question only).

The triage slim summary's `Ambiguity score:` line still carries the comma-separated list of signals that fired (`vague-verbs`, `missing-AC`, `multiple-interpretations`, `no-concrete-names`) — read those signals to seed the round-0 per-dimension scores (e.g. `vague-verbs` → low `goal` score, `missing-AC` → low `criteria` score). The signals are an initial-condition hint, not a question-ordering directive — the iterative scoring takes over from round 1 onward.

## Anti-rationalization (Clarify edition)

| Excuse | Reality |
| --- | --- |
| "Ambiguity score is 62 — barely above threshold. I'll skip Clarify and pick a default." | The threshold IS the gate. 62 ≥ 60 opens Clarify; the architect does not second-guess the score. |
| "I can guess what the user means; asking is going to feel like sluggishness." | The silent-assumption failure mode IS the slowness — re-architecting after the wrong plan ships is the most expensive cycle in cclaw's flow. One Clarify question buys hours of re-work. |
| "Let me batch 3 questions into one turn to save round-trips." | NO. One question per turn is hard-locked. Batched questions get half-answers; one-at-a-time forces the user to think about each axis. |
| "I'll ask 5 questions even if the first answer resolved everything." | NO. The math-gated exit is the canonical stop signal: `ambiguity < 0.25` ends Clarify regardless of round count. Padding to 5 is the symmetry trap — every unnecessary question erodes the user's trust that Clarify is cheap. |
| "User said 'fix it' to my first question — I should ask another to nail it down." | "Fix it" / "go" / "ready" / "proceed" is the early-exit signal. Honour it. The plan.md ack-window catches anything you assumed wrong. |
| "The prompt mentions a security keyword — I should skip Clarify and go strict-paranoid." | The triage step already escalated ceremony on security keywords. Clarify is orthogonal — security work is often MORE ambiguous, not less. Ask the questions. |
| "Round 4 — I'll just keep asking incremental clarifications." (stance retained — labels hidden) | NO. Round 4's stance is **contrarian** — ask "what if the opposite were true?" against the weakest dimension. Round 5's stance is **simplifier** — ask "what's the simplest version that still ships value?". The stance rotation is the stagnation guard; ignoring it wastes the late rounds. The user-visible stance label is hidden, but the stance discipline still applies — the contrarian / simplifier framing is the orchestrator's internal authoring guide for the question itself. |
| "I'll render the per-round score table to the user so they can see what each answer is moving." | NO. The per-round score table is not rendered to the user. The 4-row `Dimension / Score / Weight` block and the `Next target:` line are internal to the orchestrator — compute them, use them to pick the weakest dimension, persist them to `flow-state.json > clarifyRounds[]`, but do NOT render them in chat. The user sees only the question. The math persistence is the audit trail; the table render was the dominant friction surface. |
| "I'll just always target `goal` because it has the highest weight." | NO. Target the **weakest dimension** per the per-round score, not the highest-weight dimension. Weight resolves *ties* between equal-low scores; it does NOT pre-empt the score. |

## What the architect's in-prompt body retains

The architect's prompt body keeps the load-bearing surface in-context (entry condition, one-question-per-turn rule, exit signals, math-gated formula `ambiguity = 1 − weighted_sum`, dimension weights, exit threshold `ambiguity < 0.25`, hide-render rule, stance-rotation rounds 4+5 internal, carry-over to `## Assumptions (correct me now)`). This runbook holds the inner detail (scoring math step-by-step, gap-lens templates, per-round procedure, anti-rationalization table) so the in-prompt budget doesn't pay for the long-form material on every architect dispatch.
