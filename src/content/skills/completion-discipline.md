---
name: completion-discipline
trigger: before any "done" / "complete" / "ready" / "ready to ship" / "looks good" claim a specialist or the orchestrator makes; auto-fires on every dispatch return (slim-summary write) and at every stage exit (ship / finalize)
---

# Skill: completion-discipline

cclaw's most expensive failure mode is **claiming work is done before verifying it**. A slice-builder that returns `Stage: build ✅ complete` without running the suite. An ac-author that returns `Confidence: high` without re-reading the plan. A reviewer that closes a finding without citing the fix evidence. Each instance costs at minimum one orchestrator round-trip; at worst, it ships a broken build because the next stage's "verification" looked at stale state.

This skill makes the rule explicit: **no completion claim without fresh verification evidence**. The discipline is concentrated here so every specialist and every stage applies the same gate. The Iron Law on completion claims, the anti-slop ban on "looks good", and the reviewer's `Verification story` table are all instances of this one rule — completion-discipline is the canonical source they all defer to.

## When to use

Always-on. Every cclaw specialist and the orchestrator obey it on every dispatch. The rule fires at four specific moments:

1. **Before writing a slim-summary `Stage: ... ✅ complete` line.** A complete-marker without cited evidence is the canonical failure mode.
2. **Before promoting a `Recommended next: continue`.** "Continue" claims the upstream is done — without fresh evidence, the next stage rolls forward on a stale snapshot.
3. **Before closing a Findings row (`status: closed`).** The reviewer's row close requires a citation; without it, the close is itself a finding (axis=correctness, severity=required).
4. **Before the orchestrator stamps `ship.md > status: shipped` or runs finalize.** The Victory Detector reads structured signals from preceding stages; faking any of them propagates downstream.

The rule applies in every ceremonyMode (`inline` / `soft` / `strict`) and every stage (`plan` / `build` / `review` / `critic` / `ship`).

## When NOT to apply

- **Mid-stage probing / debug-loop runs.** When a specialist runs a probe to understand a failure (e.g., capture a stack trace, dump intermediate state), the probe's output is evidence, not a completion claim. The "I ran this and it failed because X" surfacing is fine; the "I'm done debugging, this works now" claim that follows it must carry fresh evidence per this skill.
- **Mechanical step acknowledgements.** A specialist saying "I read `plan.md`" or "I opened the runbook" is not a completion claim; it is a procedural acknowledgement. No verification gate fires on procedural moves.
- **Hypothesis statements during debug-loop discipline.** Stating "my top hypothesis is X" (per `debug-and-browser.md`) is not a completion claim — it is a hypothesis to test. The fix-and-claim moment after the probe lands is what fires the gate.
- **Re-rendering a prior slim summary** during resume (e.g., `flow-resume.md` rendering the last specialist's return verbatim). Re-render does not re-claim; the prior claim's evidence is what survives on disk.

## Forbidden phrases

These are sycophantic claim-tokens that signal "I didn't verify and I'm guessing the answer is yes". They are forbidden in any user-facing prose, slim summary, build / review / ship artifact, or commit message body **whenever they precede or substitute for a completion claim**:

- "should work"
- "should be fine"
- "probably works"
- "looks good"
- "I think this is done"
- "this should pass"
- "should be ready"
- "everything seems fine"
- "I believe this works"

The word "should" appearing in a contractual statement of intent ("the verification line should encode the AC") is **not** forbidden — that is a prescription, not a completion claim. The forbidden form is "X should work" used as a substitute for "I verified X works (here is the evidence)". When unsure, pick the rebuttal column of the Common rationalizations table below and act accordingly.

## Mandatory evidence shapes

A completion claim is valid only when paired with **at least one** of these evidence shapes, cited in the same slim summary, artifact, or commit body where the claim lives:

1. **Command + exit code + 1-3 relevant log lines.** Example: `npm test → 47 passed, 0 failed (2.3s)`. The command must be the one that exercises the claim; "ran the linter" does not cover "the build is green".
2. **Test output excerpt.** Test name + assertion result. Example: `tests/unit/permissions.test.ts > "renders email when permission set" → PASS`.
3. **Git log proof.** `git log --oneline <range>` showing the commits the claim is over. Example: `red(AC-1) a1b2c3d → green(AC-1) 4e5f6a7 → refactor(AC-1) 9e2c3a4`.
4. **File:line citation against the claim.** When the claim is structural ("the helper is extracted"), cite the post-change file:line where the helper now lives.
5. **Closing-citation for a Findings row.** Per the reviewer's contract: commit SHA, test name, OR new file:line that resolves the row.

The evidence must be **fresh** — captured in the current dispatch / iteration, not copy-pasted from a prior stage. Stale evidence is a re-run-without-rerun anti-pattern (see `anti-slop.md`). When evidence cannot be captured (e.g., the test runner is not reachable from the current context), the slim summary's `Confidence` field drops to `medium` minimum and `Notes:` cites the reason — the completion claim itself must NOT be promoted past `Confidence: high` without evidence.

## Process

Before any completion claim, walk this checklist (≈30 seconds):

1. **Name the claim.** "Build is complete for AC-1" / "Review iteration 2 returns `clear`" / "Plan ready for slice-builder dispatch". State the claim in one sentence; vague claims pass the gate the most easily.
2. **List the evidence required.** What command, test, or citation proves this exact claim? (Step 1's specificity dictates step 2's shape.)
3. **Run the verification fresh.** Capture command output, test result, or git log in the current turn. Do not reuse evidence from a prior turn unless the underlying state has not changed (re-using yesterday's `npm test` output to claim today's build is green is the exact failure mode this rule prevents).
4. **Paste the evidence next to the claim.** In the slim summary's `Notes:` line, in the artifact's Summary block, in the commit body — wherever the claim lands, the evidence lands with it.
5. **Drop confidence if evidence is partial.** When you ran a subset of tests (not the full suite), when the verification probe surfaced no errors but did not actively assert the AC's outcome, when the citation is to a prior commit rather than a fresh one — drop `Confidence` to `medium` (or `low` on serious gaps) and surface the dimension in `Notes:`.

## Verification

The reviewer's per-iteration **Verification story** table (`Tests run / Build run / Security checked`) is the canonical surface where this skill's evidence requirement is enforced ex-post. The slice-builder's `self_review[]` JSON attestation enforces it at handoff. The orchestrator's finalize step — per-criterion `verified` flag check, shipped in v8.48 — enforces it at ship time. Three layers of catch — the rule is the same one stated above; each layer re-asserts it in the surface most appropriate to that stage.

If a downstream stage finds an upstream claim lacked evidence, that is **F-N severity=required (axis=correctness)** — the upstream claim was a violation, not a noticing.

## Common rationalizations

**Cross-cutting rationalizations:** the canonical "should pass" / "looks good to me" / "I'll claim complete now" rows live in `.cclaw/lib/anti-rationalizations.md` under category `completion` (v8.49). The rows below stay here because they cover completion-specific framings (stale-evidence citation rule, `Confidence: high + Notes:` hedge, verification line transcription); the catalog covers the shared rebuttal prose so the cross-cutting set stays consistent across surfaces.

The "claim now, evidence later" reflex is how completion-discipline breaks. The table below names every excuse a specialist will produce; pair it with the rebuttal and pick the right column.

| rationalization | truth |
| --- | --- |
| "I just ran the tests, they should pass on this kind of change." | "Should" is not evidence; "did" with the exit code is. Run the suite and paste the line — 30 seconds saves a review iteration. |
| "Looks good to me." | Sycophancy. Replace with "AC-1 verified: `npm test ...` → 47 passed" or drop the claim to `Confidence: medium`. |
| "This is a 5-line change, the test obviously passes." | Then run it and prove it. The 5-line change is exactly the kind whose unverified pass becomes the next stage's stale dependency. |
| "I'll claim complete now; the reviewer will catch any gaps." | The reviewer reads your slim summary as ground truth, then re-runs ex-post. A false complete-marker poisons the reviewer's `Verification story` — they cite "Tests run: yes" based on your claim and miss the regression. |
| "The previous turn's test output is enough." | Stale evidence (see `anti-slop.md`). Re-run if the underlying state could have moved. If it could not have moved (no code edits since), cite the exact prior turn's command + result; do not re-paste without the citation. |
| "I'm confident; I don't need to write the evidence down." | The evidence is for the next reader, not for you. The next agent reading your slim summary cannot reconstruct your confidence; they read the evidence or they don't. |
| "The verification line is in the AC; copying it into the slim summary is redundant." | Copy it anyway, in the form `verified: <command + result>`. Verification line is the spec; evidence is the proof. They live at different layers. |
| "I'll mark `Confidence: high` and put the caveat in `Notes:`." | `Confidence: high` with a `Notes:` caveat is the same as `Confidence: medium` with no caveat — pick the right value. The `Notes:` field is for unavoidable context, not for hedging a wrong confidence. |
| "The build was green yesterday; nothing material has changed." | Material change is judged by code edits, not by your sense of stability. If the working tree changed since yesterday's run, re-run. If it did not, cite the prior run by command + timestamp. |

## Red flags

When you catch any of these in your own output, **stop** and re-run the verification before sending:

- "should" / "probably" / "looks like" / "seems to" preceding a completion verb.
- A slim summary with `✅ complete` but no cited command in `What changed:` or `Notes:`.
- A Findings row closed with `Status: closed | Closed in: 2` but no `Citation:` column populated.
- A `Confidence: high` line where the build was last verified in a turn you cannot identify.
- Any "everything passes" / "all good" / "ready to ship" without a paired command excerpt.
- A `Recommended next: continue` immediately after a "should work" caveat.

The red flag is not the claim itself; the red flag is the claim without paired evidence. Adding evidence converts every example above into a valid completion claim.

## Worked example — RIGHT

slice-builder's slim summary after AC-1 commits:

```
Stage: build  ✅ complete
Artifact: .cclaw/flows/20260514-tooltip-permission/build.md
What changed: AC-1 RED+GREEN+REFACTOR committed (red a1b2c3d, green 4e5f6a7, refactor 9e2c3a4); npm test → 47 passed, 0 failed (2.3s).
AC verified: AC-1=yes
Open findings: 0
Confidence: high
Recommended next: review
Notes: tsc --noEmit → 0 errors; coverage row written (verdict=full).
```

Evidence shapes: command + exit code (`npm test → 47 passed`), git log proof (three SHAs in commit-ordering), per-criterion verified flag. The completion claim (`✅ complete`) is paired with all three.

## Worked example — WRONG (and the rebuttal)

```
Stage: build  ✅ complete
Artifact: .cclaw/flows/20260514-tooltip-permission/build.md
What changed: AC-1 done, looks good.
Open findings: 0
Confidence: high
Recommended next: review
```

Violations:

- "Looks good" — forbidden phrase (sycophancy, no evidence).
- `What changed:` carries no command, no exit code, no SHA.
- `Confidence: high` without paired evidence.
- No `AC verified:` line — the orchestrator's finalize check shipped in v8.48 will refuse ship.

The reviewer's Verification story will catch this, but the cost is one full review iteration; the cheaper path is to follow the Process checklist above before authoring the summary.

## Composition

This skill is **always-on** — every specialist, every stage. Auto-trigger on `stages: ["always"]`; the rule fires on every dispatch return and every stage exit. The reviewer's `Verification story` table, the slice-builder's `self_review[]`, the orchestrator's finalize per-criterion `verified` check are all enforcement surfaces; this skill is the source of truth they share.

Pairs with `receiving-feedback.md` (when receiving review / critic findings, the response must include fresh evidence per this skill) and with `anti-slop.md` (stale evidence and shimming-instead-of-verifying are the two flavours of evading completion-discipline).
