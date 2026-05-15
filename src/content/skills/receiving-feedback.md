---
name: receiving-feedback
trigger: when a specialist or the orchestrator receives review.md findings, critic.md gaps / verdicts, security-reviewer findings, or any user feedback that names a defect in upstream output; auto-fires at build (fix-only loop), review (re-iteration), and ship (final pre-merge sweep)
---

# Skill: receiving-feedback

cclaw's adversarial chain (reviewer → critic → ship gate) only works when the **receiving** specialist engages with the feedback honestly. The failure mode is sycophantic acknowledgement: "good point, you're right, let me address that" without analysis, classification, or a real plan. The next iteration ships the same defect with cosmetic adjustments and the reviewer flags it again. Two iterations wasted, signal-to-noise dropped.

This skill replaces the sycophantic-acknowledge reflex with a structured response pattern: restate the finding, classify it against the ship gate, declare a plan with evidence. It is paired with `completion-discipline.md` (the rule that the response's "I fixed it" claim itself needs evidence) and with the reviewer's anti-sycophancy `What's done well` gate (the symmetric rule for the reviewer side).

## When to use

Always-on when a specialist or the orchestrator is processing **feedback that names a defect in their own prior output**. Concretely, the four triggering surfaces:

1. **Reviewer findings** — slice-builder receiving F-N rows from `review.md`'s Findings table (every iteration of the review-fix loop, every `severity ∈ {critical, required, consider, nit}` row that targets slice-builder's diff).
2. **Critic gaps / verdicts** — slice-builder OR ac-author receiving `critic.md > ## Gap analysis` rows (G-N records) or a `Verdict: block-ship` / `Verdict: iterate` line. The critic is read-only on the codebase; the receiver is whoever owns the file the gap targets.
3. **Security-reviewer findings** — same as reviewer findings, scoped to the security axis. Severity escalates faster (every `critical` security finding blocks ship in every ceremonyMode); the response pattern below still applies.
4. **User feedback that points at a defect** — the user typing `/cc` with prose saying "AC-2 missed the edge case where X" or "the plan doesn't mention Y". Treat this as a finding (severity inferred from prose; default to `required` when the user names a concrete miss).

Fires on `stages: ["build", "review", "ship"]` because the receive-feedback moment can land at any of those stages (slice-builder in build, reviewer in review-iteration, both at ship-gate fix-only).

## When NOT to apply

- **Praise** — `What's done well` items from the reviewer. The receiving response to praise is a one-line acknowledgement at most ("noted") OR silence. Treating praise like criticism by running the four-step pattern below is its own anti-pattern (sycophancy-in-reverse).
- **Hypothesis statements during debug-loop discipline.** When the user is collaborating on a debug-loop ("my top hypothesis is X") and is not naming a defect in your output, the response is the next probe, not the receive-feedback pattern. This skill applies to defect feedback, not to collaborative problem-solving.
- **Procedural requests** — `/cc show`, `/cc cancel`, `/cc --mode=auto`. These are state-machine instructions, not feedback. The orchestrator handles them mechanically; no analysis pattern fires.
- **Inline / trivial flows where no review or critic ran.** Inline flows skip review and critic; the only feedback surface is user-typed prose (which still applies via case #4 above).
- **`fyi` severity findings.** `fyi` rows are informational; the response is "noted, carried to learnings" — single line, no four-step analysis. The pattern below applies to actionable severities (`critical`, `required`, `consider`, `nit`).

## Forbidden phrases

These are sycophantic acknowledgement-tokens that signal "I am agreeing with the feedback without thinking about it". Forbidden as a substitute for the four-step response pattern below:

- "good point"
- "you're right"
- "I see your concern"
- "let me address that"
- "great catch"
- "fair enough"
- "absolutely, I'll fix it"
- "that's a fair criticism"
- "noted, will fix"

The phrases can appear in your reply when paired with the four-step pattern below (e.g., "Good point — restated: <finding>, classified as <severity>, plan is <plan>") — what is forbidden is the bare token as the **whole** response. A reply consisting only of "good point, let me fix it" is what gets caught here; the same words inside the structured pattern are fine.

Two more phrases are forbidden categorically (they hide disagreement under fake-agreement):

- "I see what you mean, but..." — this is a sycophantic preface to a pushback. If you're pushing back, say so in the four-step pattern's `Plan` step (`Plan: push back with evidence — <evidence>`); don't pretend to agree first.
- "Yes and..." — the improv "yes-and" reflex. Cclaw's adversarial chain is not improv; the receiving specialist's job is to classify, not to extend.

## The four-step response pattern

When you receive a finding, your reply (in the slim summary's `Notes:` line, the next iteration's build log entry, or the user-facing prose) follows this shape:

### Step 1 — Restate

State the finding back in your own words. One sentence. The restatement proves you parsed the finding; if your restatement is wrong, the upstream can correct before you commit to a fix.

> Restated F-2: my GREEN diff at `src/lib/permissions.ts:18` does not handle the null-claims branch — when `claims === null`, the function throws instead of returning `false`.

### Step 2 — Classify

Place the finding against the ship gate. One of:

- **`block-ship`** — fixing is mandatory before ship (any `critical` row; any `required` row in strict mode; any `required + architecture` row in soft mode per the v8.20 priors).
- **`iterate`** — fixing is recommended but does not block (most `required` rows in soft mode; most `consider` rows in any mode when the iteration count is well under cap).
- **`fyi`** — informational; no fix required, but the lesson carries to `learnings.md`.

The classification is **explicit** — write `Classified: block-ship` (or the appropriate value) verbatim. The orchestrator and the reviewer both read this column.

### Step 3 — Plan

State the action plan in one sentence. One of three shapes:

- **`fix`** — "Plan: fix — write RED test asserting null-claims returns false, then GREEN at `src/lib/permissions.ts:18` adding the null-guard". The plan must be concrete (file:line refs, named tests, named refactors); "I'll fix it" without specifics is sycophantic agreement.
- **`push-back-with-evidence`** — "Plan: push back — the null-claims branch is unreachable per `src/auth/middleware.ts:42` which guarantees `claims !== null` before this function is called. Evidence: `tests/integration/auth-middleware.test.ts:88` exercises that path." Use this when you disagree with the finding; the evidence is what distinguishes informed push-back from sycophantic resistance.
- **`accept-warning`** — "Plan: accept warning — the finding is correct but `ceremonyMode: soft` and `severity: consider` carries over without blocking. Will surface in `learnings.md`." Use this when the finding is valid but the ship gate allows the carry-over.

### Step 4 — Evidence

When the plan is `fix`, the evidence is the result of the fix (per `completion-discipline.md`): commit SHA, suite output, file:line of the change. When the plan is `push-back-with-evidence`, the evidence is the file:line / test name / git blame proof that supports the push-back. When the plan is `accept-warning`, the evidence is the carry-over citation (the `learnings.md` row id, or the `## Summary > Potential concerns` bullet).

The evidence lands **in the same response** as the plan, not in a follow-up turn. Splitting plan and evidence across turns is how the receive-feedback discipline degrades back to "I'll fix it" + silence.

## Process

When a review.md / critic.md / security-reviewer finding lands, follow this sequence (≈45-60 seconds per finding):

1. **Read the finding to the end.** Including the proposed fix, the cited file:line, and the severity. Do not respond after reading only the first sentence.
2. **Apply the four-step pattern above.** Restate / Classify / Plan / Evidence. Write the four lines in the same turn.
3. **Run the fix (if `Plan: fix`).** Per `completion-discipline.md`, the fix needs fresh evidence — run the suite, capture the result, paste it in the response.
4. **Surface the response in the right surface.** For build's fix-only loop, the response sits in the next iteration's `build.md` block under `### Fix iteration N — review block K`. For review re-iteration, the response sits in the next reviewer pass's iteration block. For ship-gate fix-only, the response sits in `ship.md > ## Fix-only response`. The four-step pattern is the durable record; do NOT bury the pattern in a slim summary's `Notes:` line and lose it.

When multiple findings land in one review block (typical: 3-5 F-N rows in one iteration), apply the pattern **per finding**, not in aggregate. Aggregate responses ("I'll fix all three") are sycophantic by construction.

## When you disagree (push-back with evidence)

The receiving discipline is **not** "always agree and fix". Cclaw expects honest push-back when the finding is wrong, scoped wrong, or addressable by re-classifying rather than re-coding. The push-back pattern is the same four steps; only `Plan` changes shape:

```
Restated F-3: review claims the touchSurface includes `src/api/list.ts` outside the declared list.
Classified: iterate
Plan: push back with evidence — plan.md > AC-2 > touchSurface includes `src/api/list.ts:42-58` (the pagination helper). The diff line cited by the reviewer (`src/api/list.ts:50`) is inside that range. Suggest the reviewer re-read the touch surface row before re-running the check.
Evidence: plan.md:38 (touchSurface list with src/api/list.ts:42-58) + git diff --stat showing all touched lines fall in 42-58.
```

Push-back without evidence is forbidden — "I disagree" alone is not a Plan. The evidence column is what makes the push-back fall outside sycophantic-resistance.

When the upstream agrees with the push-back, the reviewer's row close requires a citation per `completion-discipline.md` (the Citation column points at your push-back evidence). When the upstream disagrees, the iteration loop continues — your push-back was honest, just wrong.

## Verification

The fix-only loop's effectiveness is the canonical measure: a fix-only iteration that closes the cited findings on the next reviewer pass is the receive-feedback discipline working. A fix-only iteration that re-opens the same finding (or surfaces a near-duplicate F-N pointing at the same file:line) means the response was sycophantic — the upstream agreed without analyzing, and the same defect shipped.

The reviewer's row-close citations are the audit trail; the orchestrator's run-mode pause-on-block is the enforcement gate. Three layers of catch — the rule is "respond with structure, not acknowledgement"; each layer enforces it from a different angle.

## Common rationalizations

**Cross-cutting rationalizations:** the canonical "looks good to me" sycophancy rows live in `.cclaw/lib/anti-rationalizations.md` under category `completion` (v8.49). The rows below stay here because they cover receive-feedback-specific framings (polite-prelude, false-sympathy + silent disagreement, "let me address that" placeholder, aggregate fixes).

The reflex to acknowledge-without-analyzing is the most common scope-discipline break in the receive-feedback surface. Table maps every excuse to its rebuttal.

| rationalization | truth |
| --- | --- |
| "Saying 'good point' first is polite; the actual fix follows." | Polite-prelude is sycophantic by the time it ships through three iterations. Replace with the four-step pattern; structure is the politeness that the next agent can act on. |
| "The finding is small, I'll just fix it without restating it." | Restating is the cheapest step (one sentence). Skipping it skips the parse-check; if your restatement would have been wrong, the unrestrained fix lands in the wrong place. |
| "I disagree but the reviewer is the gate, so I'll just fix it." | False sympathy + silent disagreement. Push back with evidence; if the reviewer holds, fix. If they don't, you saved a fix-only round. The cost of one honest push-back is less than the cost of a wrong fix. |
| "Let me address that." | Forbidden phrase; replace with `Plan: fix — <concrete one-sentence plan>`. The phrase is a placeholder for "I haven't planned yet"; the concrete plan is the gate. |
| "I'll address all three findings together in one fix." | One response per finding. Aggregate fixes hide which finding drove which line of the diff; the reviewer's row-close citations break. |
| "I'll fix it and just commit; the response can be implicit in the diff." | The diff is evidence, not response. The four-step pattern lives in `build.md` or `review.md`; the diff is what step 4 (Evidence) cites. Skipping the prose response means the next reviewer cannot reconstruct your reasoning. |
| "The finding is correct but doesn't apply to my AC." | That's a push-back with evidence; surface as `Plan: push back — finding targets AC-2 but my touchSurface is AC-1; recommend re-routing.` Don't silently ignore; the orchestrator needs to see the response to re-route. |
| "Great catch, will fix in next iteration." | Sycophantic preface + can-kick. The next iteration is THIS response; the four-step pattern lands now. |

## Red flags

When you catch any of these in your own response, **stop** and restructure to the four-step pattern:

- A response that opens with one of the forbidden phrases above as its full content.
- A response with no `Restated:` / `Classified:` / `Plan:` / `Evidence:` shape (the four labels are mandatory; lighter shapes degrade to sycophancy).
- A `Plan: fix` immediately followed by a fix commit with no `tests/<path>` RED commit preceding it (in strict mode + `test-first` posture; per `tdd-and-verification.md`). The plan said "fix"; the discipline says fix means RED → GREEN → REFACTOR.
- A `Plan: push back` with no `Evidence:` line. Push-back without evidence is forbidden.
- A response that addresses N findings with N-K shapes (some have all four steps, some have one-line acknowledgements). Inconsistency is the smell.
- Repeated identical responses across two iterations on the same finding ("I'll fix it" twice). The reviewer is showing you the same row because the prior response was structureless.

## Worked example — RIGHT

Review block 1 contains:

> F-2 | correctness | required | AC-1 | `src/lib/permissions.ts:18` | the GREEN diff does not handle the null-claims branch; throws on `claims === null` instead of returning `false`. → Add null-guard before the property access.

slice-builder's response in the next build.md fix-iteration block:

```markdown
### Fix iteration 1 — review block 1

**F-2 response:**
- Restated F-2: my GREEN diff at `src/lib/permissions.ts:18` does not handle `claims === null`; the function throws instead of returning `false`.
- Classified: block-ship (strict mode, severity=required, axis=correctness — per the v8.20 architecture priors block-ship rule, this required row gates ship until closed).
- Plan: fix — write RED test asserting `hasViewEmail(null) === false` in `tests/unit/permissions.test.ts`, then GREEN at `src/lib/permissions.ts:18` adding `if (claims === null) return false;` guard.
- Evidence (after fix lands): RED `red(AC-1): hasViewEmail null-guard` (SHA bbbcccc); GREEN `green(AC-1): fix F-2 — null-guard` (SHA dddeeee); npm test → 48 passed, 0 failed.

| F-N | AC | phase | commit | files | note |
| --- | --- | --- | --- | --- | --- |
| F-2 | AC-1 | red | bbbcccc | tests/unit/permissions.test.ts:55 | asserts hasViewEmail(null) === false |
| F-2 | AC-1 | green | dddeeee | src/lib/permissions.ts:18 | null-guard added |
| F-2 | AC-1 | refactor (skipped) | — | — | 2-line guard, idiomatic |
```

Four steps present; evidence cited per `completion-discipline.md`; row-close citation handed to the reviewer for the next iteration.

## Worked example — WRONG (and the rebuttal)

```markdown
### Fix iteration 1 — review block 1

Good point on F-2, you're right. Let me address that and the other findings.
```

Violations:

- Three forbidden phrases in one line ("good point", "you're right", "let me address that").
- No restatement (sycophantic agreement; the reviewer cannot verify the parse).
- No classification (the ship gate cannot evaluate the response).
- No plan (the next iteration cannot know what code is changing).
- Aggregate response (one prose line for "F-2 and the other findings"; the row-close citations break).

The reviewer will re-flag this as a process finding (`severity=consider`, `axis=readability`, citing this skill); the slice-builder bounces back with a real response. One iteration wasted.

## Composition

`stages: ["build", "review", "ship"]` — fires whenever a specialist is in a position to receive a finding-laden artifact (build during fix-only, review during re-iteration, ship during pre-merge sweep). The reviewer never receives findings as input (they author them); the receive-feedback pattern is for the **producers** of code or plan, not for the reviewer.

Pairs with `completion-discipline.md` (the "I fixed it" claim itself needs fresh evidence per that skill) and with the reviewer's anti-sycophancy `What's done well` gate (symmetric rule on the reviewer side — the receiving side runs four-step structure; the reviewing side runs evidence-backed praise).
