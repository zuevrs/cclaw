---
name: context-engineering
trigger: always-on (every specialist dispatch builds a fresh context window); applies whenever the agent is composing a dispatch envelope, deciding what to read before acting, or noticing the conversation is drifting because too much / too little information is loaded
---

# Skill: context-engineering

A specialist's first turn is shaped less by its prompt and more by **what landed in its context window**. cclaw's seven-hop flow already pre-pays the curation cost — `triage.taskSummary`, `triage.assumptions`, the dispatch envelope's "Required first read / second read", the slim-summary protocol, the runbook trigger table — but the **rules behind those primitives** were spread across `dispatch-envelope.md`, `pre-flight-assumptions.md`, `conversation-language.md`, and unwritten orchestrator behaviour. This skill is the single canonical home for the rules a healthy context window obeys: a *hierarchy* of what to load, *packing strategies* for fitting the relevant material under the budget, and *confusion management* when the loaded material starts contradicting itself.

The skill is `["always"]`-stage-windowed because every specialist dispatch is a context-construction event. Read this before deciding what goes into the envelope, before re-reading a file the orchestrator already summarised, and whenever you find yourself answering a question the inputs do not actually answer.

## When to use

- **Every dispatch envelope you build.** Before listing the inputs the sub-agent reads, walk the context hierarchy from "rules" down: rules / specs / source / errors / conversation. Each layer admits inputs the lower layer cannot replace; each layer is finite.
- **When a specialist asks for more context.** A specialist that hits its first turn and replies "I need more inputs" is signalling the dispatch envelope under-packed. Re-pack using the strategy below (brain-dump → selective-include → hierarchical-summary), don't just append the file the specialist asked for.
- **When a specialist's slim summary returns `Confidence: low` with a "context" dimension cited.** The fix is upstream of the specialist: the orchestrator re-builds the envelope, not the specialist re-reads files inside its turn.
- **When the user's conversation contradicts the artifact on disk.** Apply the confusion-management protocol below: surface the conflict explicitly, ask one targeted question, do **not** silently pick a side. Confusion management is what stops the orchestrator from "helpfully" reconciling user-typed prose with `flow-state.json` against the user's actual intent.
- **When you are about to inline a file the orchestrator already summarised.** A slim summary is a deliberate context-window save; re-inlining the underlying artifact is a regression to pre-v8.4 behaviour. Quote the summary instead.

## When NOT to apply

- **Inside a sub-agent's own turn.** Context-engineering is the **dispatcher's** discipline. A specialist that re-curates its own context window mid-turn is exceeding its contract — its job is to read the envelope's inputs in order and act, not to second-guess the orchestrator's packing decisions.
- **For trivial / inline flows.** The inline path has no specialist dispatch; the orchestrator writes the code itself with the small filebag the user named. Context hierarchy still applies in principle (read the file you are editing before editing it), but the formal envelope construction this skill governs is large-medium / large-risky only.
- **When the issue is a missing skill body, not a context-window pack.** If `tdd-and-verification.md` is uninstalled, the fix is `cclaw install` / `cclaw refresh`, not a re-pack. Distinguish "the agent has the right inputs but is reasoning poorly" (a skill / prompt gap) from "the agent does not have the right inputs" (this skill's domain).
- **When the harness's context-window quota itself is the bottleneck.** Compression strategies (hierarchical summary) buy ~30% more headroom; they do not replace splitting a too-big slug into multiple flows. If you find yourself summarising the summaries, the slug is mis-triaged — re-triage it as multiple small/medium flows.
- **When the conversation is going well.** Don't re-engineer a context window because a checklist says to. The signal is *confusion, missing input, or contradiction* — never "the checklist hasn't been run this dispatch".

## Context hierarchy

Context loads in five layers, ranked by **immutability and authority**. Earlier layers bind later ones; a conflict between two layers is resolved in the earlier layer's favour and surfaced.

1. **Rules** — the cclaw orchestrator body (`/cc` markdown), iron laws, `.cursor/rules/`, `AGENTS.md`, project-root config (`cclaw.config.json`), and skill bodies. These are **the contract**: they define how every other layer is interpreted. Rules never change mid-flow; if they appear to (a skill was edited locally), the orchestrator surfaces the diff before the specialist runs.
2. **Specs** — the artifacts the flow itself produced: `flows/<slug>/plan.md`, `flows/<slug>/build.md`, `flows/<slug>/review.md`, `triage.assumptions`, ADR catalogue entries, the `learnings-research` blob. These are **the agreed contract for this slug**. Specs override the source-of-truth layer below when they pin a behaviour the source does not yet implement (e.g. a new AC).
3. **Source** — the project's code, tests, configuration, dependency manifests, fixtures. The runtime ground truth. When specs and source disagree, the disagreement is itself a finding (review writes it as `F-N`); the orchestrator never silently picks one.
4. **Errors** — verification output: failing tests, type-checker output, lint warnings, runtime traces, browser console messages. Errors are **fresh** ground truth; they override stale notes (the file the user described "always worked fine" is now red). When an error contradicts a spec, treat the error as the lead and re-read the spec; do not assume the error is a flake.
5. **Conversation** — the user's `/cc <task>` prompt, follow-up clarifications, replies to `askUserQuestion`, free-form chat. The user's prose **directs intent** but does not retroactively override committed specs / source / errors. A user saying "ignore the tests, just ship" is captured as a slim-summary `Notes:` line and surfaced for confirmation; the orchestrator does not act on it as if it were a rule.

In every dispatch envelope, the inputs are listed **from rules down**: the specialist's contract (Layer 1), the wrapper skill (Layer 1), the stage's artifact and templates (Layer 2), the touched-source list and recent diff (Layer 3), the most recent error log if any (Layer 4), the user's literal task description (Layer 5). The order matters — the sub-agent reads top-down and never starts with the conversation.

## Packing strategies

Three strategies, in order of preference for the slug's complexity:

### 1. Brain dump (inline only)

For inline / trivial flows: dump everything you have into one prompt and let the model sort it out. Inline flows have one file, ~30 lines, no specialists, no slim-summary protocol. The packing cost is zero because there is nothing to pack. Skip this section unless the flow is inline.

### 2. Selective include (small-medium, the default)

For small-medium flows: list the **specific files / sections / line ranges** the specialist needs and inline them. Filter aggressively: no "for context" appendices, no full-module copy-paste when the specialist needs one function, no test files the AC does not touch.

The dispatch envelope's input list is the canonical artifact for selective include. Each input is one bullet, one path, one rationale ("plan.md — the AC table the slice-builder is implementing"; "build.md — the prior-RED test the fix-only is responding to"). If a rationale cannot be written in one line, the input does not belong.

The most common selective-include miss: forgetting to include the prior iteration's slim summary when running a fix-only loop. The slice-builder needs the `Concern Ledger` rows the reviewer left, not the full `review.md` — quote the rows, not the file.

### 3. Hierarchical summary (large-risky, fallback for over-packed small-medium)

For large-risky flows, or any flow where selective-include would still cross the context-window budget: build a hierarchical summary.

- **Layer A (1 line per file in scope):** filename + one-sentence purpose. The specialist scans Layer A to decide which files to expand.
- **Layer B (function-level summary per Layer-A file):** for each file in scope, list the exported functions / types / classes with a one-line contract. The specialist reads Layer B to decide which functions to expand.
- **Layer C (full inline of the chosen functions):** the actual code, in full, for the functions the specialist named in its first turn's "Reading 1: I need X" callback.

Hierarchical summary turns a 50k-token full dump into a ~3k-token outline plus a ~10k-token targeted expansion. The trade-off: it adds one round-trip (the specialist replies with "Reading 1: I need files X, Y, Z" before its real first turn). On large-risky that round-trip is acceptable; on small-medium it is overhead and selective-include wins.

The `repo-research` sub-agent's job is precisely Layer A + Layer B for brownfield large-risky flows; the `learnings-research` blob is Layer B for the knowledge log. Both are **pre-pack** steps that produce summaries the ac-author then selectively includes.

## Confusion management

Confusion has three sources; each has a different fix.

### Source 1 — Internal conflict (two inputs disagree)

Two artifacts inside the same envelope contradict each other: e.g. `plan.md`'s AC-3 says "reject empty payload"; the test `tests/api.test.ts` asserts `expect(handler({})).resolves.toBe("ok")`.

**Fix:** surface the conflict explicitly in the slim summary. Do not silently pick one side. The user (or the next specialist) resolves it; the orchestrator records the resolution as a slim-summary `Notes:` line.

The exact line: "Conflict: AC-3 demands rejection; test asserts acceptance. I am pausing for your decision before writing code that would satisfy one and break the other."

### Source 2 — Missing requirement (the inputs don't answer the question)

The specialist's task requires information none of the loaded inputs contain: e.g. the AC says "stripe webhook handler" but no stripe API version is pinned in any spec or in the project manifest.

**Fix:** ask **one targeted question** before acting. The question names the missing input and lists the candidates the specialist can see. The user replies; the orchestrator stamps the answer in `triage.assumptions` or `plan.md`'s `## Assumptions` so the answer is durable across resumes.

The exact shape: "I do not see the stripe API version pinned. Candidates I detected: `package.json` lists `stripe@14.21.0`; no version mentioned in plan.md. Pinning to 14.21.0 unless you say otherwise."

### Source 3 — Drift (loaded material is stale)

The loaded material is no longer valid: e.g. the slim summary the orchestrator quoted was for `currentStage: plan`, but the user just typed `/cc fix-only` after a review iteration. The plan-stage summary is stale; the review-stage summary is what the slice-builder needs.

**Fix:** re-pack from disk. `flow-state.json` is the canonical pointer; if the in-conversation state and the on-disk state disagree, on-disk wins. The orchestrator re-reads, re-summarises, and re-builds the envelope. **The user does not need to be asked** — the on-disk state is authoritative.

Drift is the only confusion source that resolves silently. Conflict and missing-requirement both surface to the user.

## Common rationalizations

| rationalization | truth |
| --- | --- |
| "I'll just include the whole file — it's not that big." | Token budget is a real constraint, and the file you're not pruning is the file the **next** dispatch can't fit in its envelope. Practise selective-include even when you're below the budget; the discipline pays off when you're close to it. |
| "The specialist can ask for more inputs if it needs them." | A specialist that has to ask is a specialist that lost a turn. Round-trips cost the user wall-clock time. Pre-pack the obvious adjacent inputs (the test file alongside the source file; the prior iteration's slim summary alongside the current diff). |
| "If the user typed it, they want it that way." | Conversation is Layer 5. It directs intent but does not override committed specs (Layer 2) or source (Layer 3). User says "skip the tests" → record as a Notes line, surface for confirmation, never silently obey. |
| "I'll just hierarchically-summarise the small-medium flow too — never hurts to compress." | Hierarchical summary costs a round-trip. On small-medium that round-trip is overhead; selective-include is the right strategy. Use hierarchical only when the envelope budget is the bottleneck. |
| "I'll reconcile the conflict in my own reasoning and move on." | Silent reconciliation is the bug confusion-management exists to prevent. Surface the conflict. The user (or next specialist) decides; the orchestrator records the decision. The audit trail then shows *who* picked the side. |
| "The orchestrator's slim summary is enough — I don't need to read the artifact." | Slim summary is enough **for the orchestrator**. The next specialist reads the artifact; the slim summary is the orchestrator's read shortcut. Don't pass slim-summary-only to a specialist that needs the artifact's full body. |
| "I'll keep all five layers in scope just in case." | Each layer admits inputs the others cannot, but only the relevant subset of each layer rides in the envelope. The discipline is "what does this specific specialist need" — not "everything that might apply". |
| "The conversation language doesn't matter for the spec — I'll translate it." | Specs (Layer 2) stay in their canonical language. Conversation (Layer 5) follows the user. Translating a Russian-conversation user's prose into English specs is a `conversation-language` violation; quoting verbatim in the slim summary is the correct move. |

## Red flags

Stop and re-pack when you notice any of these:

- **You are inlining a file the orchestrator already summarised.** The slim-summary protocol exists to save context; re-inlining the file is a regression. Quote the summary; if the specialist needs more than the summary carries, that is a *separate* re-pack decision, not a default.
- **The dispatch envelope's input list has more than 8-10 bullets.** Selective-include is too loose. Apply hierarchical-summary (Layer A first, expand on request) or split the slug.
- **The specialist's first-turn reply is "Reading 1: I need X, Y, Z, W, V, U".** The envelope under-packed. Don't keep appending; re-pack from scratch using selective-include or hierarchical-summary as the slug-size suggests.
- **The slim summary you're quoting is from a prior stage (e.g. plan stage's summary on a build-stage dispatch).** Drift. Re-read `flow-state.json` for the most recent stage's summary.
- **You are about to "helpfully" reconcile a conflict the user did not explicitly resolve.** Stop. Surface the conflict in the slim summary's `Notes:` line. The user resolves.
- **The user's `/cc <task>` prose contradicts `triage.assumptions` and you are tempted to update `triage.assumptions` silently.** Don't. `triage.assumptions` is immutable for the flow's lifetime; the user's new intent is captured as a follow-up flow or surfaced as a discussion-point.
- **A specialist's slim summary cites "I am missing context" without naming the specific dimension.** The missing-context citation is too vague to act on. Re-dispatch with `/cc expand <stage>` (richer envelope) only after the specialist names *which* file / artifact / decision they are missing.

## Verification

After building a dispatch envelope and before announcing the dispatch:

- [ ] Each input is on its own bullet with a one-line rationale.
- [ ] The contract reads (Layer 1: `agents/<id>.md` + wrapper skill) are the **first** two bullets.
- [ ] No input is included "for context" without naming what the specialist will read it for.
- [ ] If the slug is small-medium, the envelope uses selective-include (no Layer-A summaries; no "Reading 1" round-trip planned).
- [ ] If the slug is large-risky and brownfield, the envelope quotes the `repo-research` Layer-A blob; the specialist expands Layer C in its first turn's reply.
- [ ] If any conflict between inputs was detected during packing, it is surfaced in the dispatch announcement's `Notes:` field — not silently resolved.
- [ ] The conversation language (user's language) governs the announcement prose; mechanical tokens stay English (`AC-N`, `/cc`, slugs, paths).
- [ ] `triage.assumptions` is included by reference (the envelope says "see `triage.assumptions`"), not re-inlined. The reference is durable; re-inlining is drift waiting to happen.

If any box is unchecked, **re-pack** before announcing. An envelope that fails verification produces a specialist turn that fails the slim summary's `Confidence:` line.

## Cross-references

- `dispatch-envelope.md` (runbook) — the literal envelope shape; this skill is the **rules** behind the shape.
- `pre-flight-assumptions.md` (reference skill) — `triage.assumptions` is the rule-layer hand-off for confusion management's "missing requirement" path.
- `conversation-language.md` — Layer 5 (conversation) follows the user's language; the rule layer (Layer 1) does not.
- `flow-resume.md` — resume reads the slim summary, not the full artifact. This skill's "stale material" red flag governs the re-pack at resume time.
- `tdd-and-verification.md` — errors (Layer 4) come from the verification gate. This skill defines how the orchestrator weights them against specs (Layer 2).
- `review-discipline.md` — the Concern Ledger is the canonical artifact for surfacing internal conflicts (confusion-management source 1).

---

*Adapted from the addy-osmani context-engineering pattern. The five-layer hierarchy (rules / specs / source / errors / conversation) is cclaw's specific layering against the orchestrator's seven-hop flow; the three packing strategies and three confusion sources are addy's, fit to cclaw's selective-include-by-default discipline and the v8.18 prior-learnings lookup.*
