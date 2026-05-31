---
name: ambiguity-discipline
trigger: at the triage step (score computation) and at the architect step (Clarify phase gating + ## Assumptions authoring)
---

# Skill: ambiguity-discipline

cclaw has a **pre-plan clarify mode** to kill the silent-assumption failure mode. When the user's `/cc <task>` is ambiguous, silently picking a default and baking it into `plan.md` means the user only sees the wrong assumption after build has already started, at which point correcting it costs a full re-architect cycle. The clarify mode forces the architect to surface those forks BEFORE plan.md is written, and to record every silent inference in a mandatory `## Assumptions (correct me now)` section the user reviews before build starts.

This skill codifies the discipline. It auto-triggers at the `triage` stage (the score is computed here) and at the `plan` stage (the architect reads the score and runs Clarify when the gate fires). It is **NOT** a runtime step on its own — the actual gating + dialogue lives in the triage and architect specialist contracts. Read this skill when authoring those prompts, when debugging a flow that shipped the wrong feature because an assumption was silent, or when extending the score's signal set.

## Three sources the discipline draws from

- **obra-superpowers `brainstorming` (HARD-GATE + one-question-at-a-time + scaling sections by complexity).** Brainstorming is a *dialogue*, not a form to fill. Asking one question per turn forces the user to think about each axis instead of half-answering a batched checklist. The hard-gate "don't proceed without explicit user signal" prevents the architect from drifting into authoring while the user is still thinking.
- **forrestchang / Karpathy `Think Before Coding`.** Engineers who think before coding ship the right thing more often. Silent assumptions are the inverse: thinking *while* coding produces locally-correct code that solves the wrong problem. Surfacing assumptions up-front is the cheapest form of thinking.
- **addyosmani `spec-driven-development` (the ASSUMPTIONS I'M MAKING block).** Every spec carries an explicit assumptions list. The user reads it, edits in place, or pushes back — but never gets surprised post-build by an assumption they never saw.
- **everyinc-compound `ce-brainstorm` Phase 1.2 gap lenses (evidence / specificity / counterfactual / attachment).** Four lenses for picking which question to ask first. Evidence: "what would convince you it's done?". Specificity: "what concrete thing does that vague verb mean?". Counterfactual: "I read it two ways — A or B?". Attachment: "where does this live in the repo?". The triage signals map onto these lenses one-to-one.

## The contract (where the discipline lives in cclaw)

| Surface | Contract |
| --- | --- |
| `src/content/specialist-prompts/triage.ts` | Computes `ambiguity_score` (integer in `[0, 100]`) from four signals (vague-verbs / missing-AC / multiple-interpretations / no-concrete-names). Emits the score in the slim summary's `Ambiguity score:` line; the orchestrator persists it to `triage.ambiguityScore` in `flow-state.json`. |
| `src/content/specialist-prompts/architect.ts` | Reads `triage.ambiguityScore`. When `score >= config.clarify.ambiguity_threshold` (default 60) AND `ceremonyMode != "inline"`, runs the **Phase −1 Clarify protocol** BEFORE Bootstrap: one question per turn, max 5, until the user signals "go" / "ready" / "proceed" or ambiguity resolves. The architect maps signals → question templates via the four ce-brainstorm gap lenses. |
| `src/content/artifact-templates.ts > PLAN_TEMPLATE` + `PLAN_TEMPLATE_SOFT` | The `## Assumptions (correct me now)` section is the architect's mandatory output. 3-7 short bullets; user-pinned answers are bare, architect-silent inferences carry the `(architect inference)` tag. Position: at the top of plan.md, after `## Extends` (when present) and before `## Frame` (strict) or `## Plan` (soft). |
| `src/content/start-command.ts` | After the architect returns and plan.md is written, the orchestrator emits one ack-window line in plain prose pointing the user at the `## Assumptions (correct me now)` section by name. `/cc` (no args) auto-continues to build; this IS the ack window — there is no separate "approve plan?" picker. |
| `src/config.ts > ClarifyConfig` | `clarify.ambiguity_threshold` (default 60). Users who want Clarify to fire more aggressively lower the threshold; users running batch / CI pipelines may raise it. Values outside `[0, 100]` fall back to the default. |

## Hard rules (apply at the contract level)

- **The threshold IS the gate.** `ambiguityScore >= clarify_threshold` opens Clarify on every non-inline path. The architect does not second-guess the score — suppressing Clarify "because the score's just barely above threshold" reintroduces the silent-assumption failure mode.
- **One question per turn.** Batched questions get half-answers. The 5-question cap is precious; spend it one-at-a-time.
- **Maximum 5 questions across the whole Clarify phase.** If you reach 5 without ambiguity resolving, stop and proceed to Bootstrap with your best-guess assumptions surfaced verbatim in plan.md's `## Assumptions (correct me now)` section. The cap is hard.
- **Stop early when the user signals "go" / "ready" / "proceed".** Match loosely on intent. Padding to 5 is the symmetry trap; every unnecessary question erodes the user's trust that Clarify is cheap.
- **Stop early when ambiguity is resolved.** If after one answer every `## Assumptions (correct me now)` bullet can be filled with concrete content rather than a fork, stop asking.
- **Every architect-silent inference goes in `## Assumptions (correct me now)`** with the `(architect inference)` tag. The ack window after plan.md is written catches anything wrong — but only if the inference is visible. Hiding it because "it's obvious" is the failure mode this discipline is designed to kill.
- **The Clarify phase runs ONLY in the architect dispatch.** The orchestrator does not loop questions, the reviewer does not re-open Clarify, the critic does not second-guess the architect's Clarify outcomes. One dispatch, one dialogue.
- **`ceremonyMode: inline` skips Clarify regardless of score.** Inline / trivial tasks have no plan.md and no surface for assumptions to land in; the gate is structurally absent.

## Signal → question template mapping (the four ce-brainstorm gap lenses)

| Signal that fired in triage | Gap lens | Question template (compose in user's language) |
| --- | --- | --- |
| `vague-verbs` | **specificity** | "When you said `<verb>`, what concrete change would you want to see in the diff / on the screen / in the test output? Pick one example you'd recognise as 'done'." |
| `missing-AC` | **evidence** | "What's the one thing that, if true after this lands, would convince you the work shipped successfully? Cite a test, a metric, a user-visible behaviour, or an error condition that should be gone." |
| `multiple-interpretations` | **counterfactual** | "I can read `<task>` as either A or B (name two concrete plausible interpretations). Which one do you mean — or is it a third reading I'm missing?" |
| `no-concrete-names` | **attachment** | "Which file / module / function does this live in? If you don't know yet, point me at the symptom (an error log, a screenshot, a test that fails today) so I can find it." |

Walk the signals in the order the triage slim summary listed them and ask the strongest-signal question first. Compose in the user's language. Keep each question SHORT (one sentence, max two if the second is the example).

## When NOT to apply

- **`triage.path == ["build"]` (inline / trivial).** No plan.md, no architect dispatch, no Clarify phase. The trivial path has no assumption surface.
- **`ambiguityScore < clarify_threshold`.** The architect proceeds directly to Bootstrap. The `## Assumptions (correct me now)` section is still mandatory — the architect's own silent inferences land there, labelled `(architect inference)`.
- **Resume from a paused flow.** The user already saw the assumptions block on the prior turn; the orchestrator does not re-open Clarify. The architect's Bootstrap reads existing plan.md as ground truth.
- **`/cc research <topic>` (research mode).** Research mode runs its own open-ended discovery dialogue in the main-context orchestrator (no fixed question cap). The architect is NOT dispatched on research-mode flows.

## Anti-rationalization table

| Excuse | Reality |
| --- | --- |
| "Ambiguity score is 62 — barely above threshold. I'll skip Clarify and pick a default." | The threshold IS the gate. 62 ≥ 60 opens Clarify; the architect does not second-guess the score. This discipline was designed to kill exactly this rationalization. |
| "I can guess what the user means; asking is going to feel like sluggishness." | The silent-assumption failure mode IS the slowness — re-architecting after the wrong plan ships is the most expensive cycle in cclaw's flow. One Clarify question buys hours of re-work. |
| "Let me batch 3 questions into one turn to save round-trips." | NO. One question per turn is hard-locked (obra-superpowers brainstorming discipline). Batched questions get half-answers; one-at-a-time forces the user to think about each axis. |
| "I'll ask 5 questions even if the first answer resolved everything." | NO. Stop early when ambiguity is resolved. Padding to 5 is the symmetry trap. |
| "User said 'fix it' to my first question — I should ask another to nail it down." | "Fix it" / "go" / "ready" / "proceed" is the early-exit signal. Honour it. The plan.md ack-window catches anything you assumed wrong. |
| "The assumption is obvious; no need to list it in `## Assumptions (correct me now)`." | "Obvious" is the rationalization that creates silent assumptions. Every surface-area decision a senior reviewer would ratify goes in. Only table-stakes (use the existing ESLint config) are exempt. |
| "I should raise the threshold in config to make Clarify fire less often." | The threshold is a project-level knob, not a per-task escape hatch. Raising it system-wide is a deliberate policy choice (e.g. for CI pipelines); raising it for one task is the silent-assumption failure mode dressed as configuration. |

## Worked example

Task: `/cc improve onboarding`.

Triage computes ambiguity_score = 95 (signals: vague-verbs, missing-AC, multiple-interpretations, no-concrete-names). All four signals fire; no concrete anchor subtracts. ceremonyMode lands at `soft`. The architect dispatches and opens Clarify:

- Opening framing: "The task is fairly ambiguous (ambiguity score: 95). I'll ask 1-5 quick clarifying questions before authoring plan.md. Say 'ready' anytime to skip remaining questions."
- Question 1 (specificity — strongest signal in this case is vague-verb): "When you said 'improve', what concrete change would you want to see in the onboarding flow? Pick one example you'd recognise as 'done'."
- User answers: "Fewer drop-offs at the email-verification step."
- Question 2 (evidence — missing AC, second-strongest): "What's the one thing that, if true after this lands, would convince you drop-offs dropped? A metric we'd measure, or a user-visible behaviour change?"
- User answers: "Verification email arrives within 30 seconds of signup; current p95 is 2 minutes."
- The architect now has enough — specificity + AC are both pinned. No interpretation fork remains (the fix is in the email-send path). Stop, proceed to Bootstrap.

`plan.md > ## Assumptions (correct me now)` ends up with bullets like:

- Target metric: verification-email p95 latency under 30s (down from current 2 minutes).
- Fix surface: the email-send service, not the signup form or the verification redirect (architect inference based on the user's framing).
- "Improvement" measured by drop-off rate at the verification step; success = drop-off rate falls below current baseline (architect inference; user named the symptom, not the success threshold).

The user reads the bullets after plan.md is written, sees the `(architect inference)` tags, and either edits in place (e.g. "actually success is drop-off below 10%, not 'below current baseline'") or runs `/cc` to continue with the assumptions as-is.

## Why this discipline is one skill, not three

The triage score, the architect's Clarify protocol, and the plan template's `## Assumptions (correct me now)` section are all surfaces of the same underlying contract: **the architect MUST surface its assumptions before build runs, and the user MUST get a cheap ack window to push back**. Splitting the discipline across three skills would invite drift (someone updates the triage score signals without updating the architect's question templates, or vice versa). One skill, one source of truth.
