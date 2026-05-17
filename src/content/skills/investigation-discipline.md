---
name: investigation-discipline
title: Investigation discipline (debug-branch)
activation: on-demand
kind: skill
trigger: specialist:investigator | stage:plan | taskShape:debug | task_shape:debug
---

# Skill: investigation-discipline

Auto-triggers on every investigator dispatch (v8.77+). Codifies the **three-lane discipline** + the **evidence-collection rubric** the investigator specialist applies on every bug-shaped flow (`triage.taskShape == "debug"`). The skill is the canonical authority for "what does an honest investigation look like" — the specialist prompt restates the discipline but defers to this skill on the details (probe shapes, confidence ladder, anti-shotgun-debugging rules).

## When this skill fires

- **Always** when `triage.taskShape == "debug"` AND the orchestrator is about to dispatch the investigator (initial dispatch OR `more-investigation` re-dispatch).
- **Always** when a specialist prompt mentions `specialist:investigator` in its trigger list.
- The skill does NOT fire on `build` / `research` shape flows (the architect / multi-lens research orchestrator have their own discipline skills).

## The three-lane discipline

The investigator dispatches **three parallel hypothesis lanes** on every bug-shaped flow. The three lanes are canonical, MECE (Mutually Exclusive, Collectively Exhaustive), and **fixed**:

| lane id | scope | most common on |
| --- | --- | --- |
| `cause-code` | code path, regression bisect (`git log --oneline -20 -- <touched files>`), dependency analysis (callers / callees / data shape), recent refactor side-effects | regression-style bugs ("it worked before") |
| `cause-config` | config drift, env-var presence + value shape, feature-flag manifest, lock-file version mismatch, runtime version markers (`.tool-versions` / `.nvmrc` / `Gemfile`), build artifact staleness | "works locally / fails in prod" / "works on my machine" / "broke after deploy" bugs |
| `cause-measurement` | observation bias, instrumentation gap, test flakiness, retry-mask, error reporting wiring, log gap (the bug isn't where it looks because the log line lies) | intermittent failures, "passes locally fails in CI", "no error in logs but symptom visible" |

**Hard rules:**

1. **All three lanes always run.** A lane that finds nothing returns `Confidence: 0` with the literal text "no evidence collected" — it is NOT omitted from the artifact. Skipping a lane is the failure mode the discipline exists to prevent (most production bugs are multi-causal; pruning a lane early loses the cross-cutting signal).
2. **Lanes are independent.** Lane A does not cite Lane B's evidence; Lane A does not change its hypothesis based on Lane B's findings. Cross-lane observations are the synthesis step's job, not within-lane findings.
3. **One hypothesis per lane.** Two competing hypotheses on the same lane mean the lane has not investigated enough — drop the weaker one or commit to the stronger one based on evidence. If the lane genuinely cannot pick, the lane's `Confidence` is ≤4 and the synthesis recommends `more-investigation`.
4. **Parallel tool-call batching.** When the investigator reads three different files for three different lanes, batch them into a single tool-use turn. Sequential reads burn budget without buying any independence (the lanes do not block on each other).

## Evidence-collection rubric

Every piece of evidence in a lane's `Evidence collected:` bullet list MUST be one of these five canonical shapes (anything else is "vibes-investigation" — the failure mode the v8.77 release was designed to kill):

| shape | example | when to use |
| --- | --- | --- |
| **file:line citation** | `src/api/list.ts:42 — \`filter(x => x.active)\` crashes when \`x\` is undefined` | reading code; pinning the suspect statement |
| **command output excerpt** | `\`npm test\` → 3 failed: \`Cannot read property 'active' of undefined\`` | running the project's verification; the output IS the evidence |
| **log excerpt** | `\`[2026-05-17T14:23:01Z] ERROR list.ts:42: TypeError: Cannot read property 'active' of undefined\`` | reading runtime logs; cite the verbatim line, not a paraphrase |
| **commit SHA** | `\`abc1234\` (2026-05-15) — "refactor: simplify filter to single-pass; removed null guard"` | regression-bisect lane; the commit IS the inflection point |
| **config snippet** | `.env.production: \`LIST_FILTER_STRICT=true\` (staging has it unset)` | env-drift lane; the difference IS the evidence |

**Hard rules:**

1. **No hand-waving evidence.** "The code looks suspicious" is not evidence — cite the file:line. "Tests have been flaky" is not evidence — cite the failed run's output. "Probably a config issue" is not evidence — cite the config drift OR mark `Confidence: 0` for the lane.
2. **No paraphrased logs.** When the log line is the evidence, quote it verbatim. Paraphrased log lines lose timing / level / surrounding context the next reader needs.
3. **No fabricated SHAs.** Every commit SHA cited must be one the investigator actually saw (typically via `git log --oneline -20`). Reviewer's `edit-discipline` axis cross-checks; a fabricated SHA is a `required` finding.
4. **Counter-evidence is NOT optional on ≥6-confidence lanes.** A lane that claims 7 confidence must list at least one piece of counter-evidence it considered and dismissed (with a reason). High-confidence lanes that skip the counter-evidence step are sycophantic by construction; the v8.77 critic's adversarial pass catches them.

## Confidence ladder (0-10 per lane)

Each lane's `Confidence` field is an integer 0-10. The ladder is honest — not aspirational:

| confidence | meaning |
| --- | --- |
| **0** | lane found nothing; the symptom does not seem to live on this axis |
| **1-2** | one suggestive signal but no causal chain (e.g. "the touched file was edited 3 days ago" without naming what changed) |
| **3-4** | a candidate hypothesis with one piece of supporting evidence but no end-to-end chain |
| **5-6** | a defensible hypothesis with multiple pieces of supporting evidence; causal chain has 1-2 gaps |
| **7-8** | causal chain complete with no gaps; counter-evidence considered and dismissed |
| **9-10** | root cause proven with a controlled reproduction (changing the suspect input changes the symptom predictably); the lane can write the fix itself if asked |

**A lane at confidence 10 means:** the lane could reproduce the symptom by manipulating the suspect input, and the fix is mechanical. **A lane at confidence 8 means:** the lane has the causal chain end-to-end but did not run a controlled reproduction (typically because the reproduction requires production state the agent cannot stage). **A lane at confidence 5 means:** the lane has a working hypothesis but a fix written against it might be a symptom fix rather than the root cause.

**Synthesis rule:** the artifact's overall `confidence: high | medium | low` derives from the max lane confidence:

- **high** — max lane confidence ≥7 with a single coherent root cause (one lane carries the load) OR two lanes converged on the same mechanism at ≥6 each.
- **medium** — max lane confidence is 5-6, defensible but with residual uncertainty.
- **low** — no lane crossed 5; the synthesis cannot honestly name a single root cause.

## Anti-shotgun-debugging rules

Shotgun debugging — changing multiple things at once "to see what helps" — is the failure mode the investigator hop exists to prevent. The discipline enforces:

1. **No fix proposals inline.** The investigator does not write code or commit anything. The fix is the builder's job; the investigator's job is to locate the cause.
2. **One root cause per synthesis.** When the lanes converge on a single root cause, the synthesis names it singularly. When the lanes diverge, the synthesis says "insufficient evidence for a single root cause; recommend `more-investigation`" — it does NOT enumerate 2-3 candidate causes and tell the builder to "try them all".
3. **Hypothesis before probe.** Every probe the investigator runs (read a file, run a test, inspect a log) must be backed by an active hypothesis. Random "let me read 10 files to see what's there" is not a probe, it's a fishing expedition. Read with intent; cite the hypothesis that motivated the read in the lane's evidence bullet.
4. **One change at a time** (applies downstream — the investigator cites this rule in the `## Fix scope` section on the direct-fix path so the builder honours it). When the synthesis says "fix the null guard at `src/api/list.ts:42`", the builder fixes EXACTLY that — not the surrounding code, not the formatting, not the imports. Drive-by changes during a bug fix are the canonical regression source.

## Probe shapes (canonical; reuse `pre-edit-investigation.md`)

The three canonical probe shapes the investigator's lanes use, mirroring the builder's pre-edit-investigation gate:

1. **`git log --oneline -10 -- <path>`** — surface recent edits to the suspect file (cause-code lane's regression-bisect entry point).
2. **`rg "<symbol>" --type <lang>`** — surface every usage site of the suspect symbol (cause-code lane's dependency analysis).
3. **Full-file read** (not just the edit window) — surface the surrounding invariants the AC author may not have known about (cause-code lane's "is the line really doing what the name implies" check).

For the `cause-config` lane, add:

4. **`cat <env-file> | grep <suspect-var>`** OR `Read` of the manifest — surface the env-var / config-key value.
5. **`cat package-lock.json | jq '.dependencies."<suspect-dep>"'`** OR equivalent for the project's lock file — surface the version pin vs. expected.

For the `cause-measurement` lane, add:

6. **Re-run the failing test 3+ times** with `--verbose` / `--no-coverage` flags as relevant — confirm or refute reproducibility (intermittent vs. deterministic).
7. **Read the test runner config** (`vitest.config.ts` / `jest.config.js` / `pytest.ini`) — surface timeouts, retry counts, parallelism settings that could mask the real cause.

## When to recommend each next-step value

The investigator's `## Next step recommendation` is EXACTLY ONE of four canonical values. The skill's rubric:

| recommendation | gate |
| --- | --- |
| `direct-fix` | root cause is on ≤3 file:line refs in one module; fix is mechanical (null guard / typo / off-by-one / missing import / wrong type-coercion / forgotten await); NO architectural decision implied; max lane confidence ≥7 |
| `needs-plan` | root cause is non-trivial: cross-cutting (≥4 files affected), architectural smell (the fix implies a design decision), security-sensitive surface (auth / data / payment / migration), OR "the fix opens 2-3 defensible options requiring a structural pick"; max lane confidence ≥5 |
| `more-investigation` | the three lanes converged on "insufficient evidence" — max lane confidence ≤5, no clear root cause, the synthesis CAN name the next probe but cannot name the cause; iteration must be 0 (cap at 2 investigator dispatches per slug) |
| `not-a-bug` | the investigation concluded the reported symptom is expected behaviour; the synthesis CAN cite "the relevant docs / spec / test that proves the behaviour is intended" — this requires evidence, not a polite shoulder-shrug |

## Anti-rationalization (read once before composing the synthesis)

| excuse | reality |
| --- | --- |
| "The cause-code lane returned high confidence — I can skip the other lanes." | All three lanes always run. One axis's high confidence doesn't tell you another axis isn't also contributing. |
| "Two lanes returned confidence 0 — the artifact is noisy; drop them." | A "no signal" finding is itself a signal (it prunes the search space for the next specialist). Record verbatim. |
| "The user clearly meant X — let me just author the fix." | The investigator is read-only. Recommend `direct-fix` and let the builder run. |
| "The lanes are uncertain but I trust my read — declare confidence 7." | The lanes' confidence drives the synthesis. Overriding the lanes silently is the failure mode that ships premature fixes. |
| "Cause-measurement found a flaky test — that IS the cause, ship a retry block." | Often wrong. Flaky tests are SYMPTOMS of timing / state / race issues. Investigate the flakiness for its underlying cause. |
| "`not-a-bug` is the safe verdict when I don't know." | NO. `not-a-bug` requires citing the spec / docs / test that proves intent. Otherwise the verdict is `more-investigation`. |

## Red Flags (catch these in the artifact before submitting)

The synthesis is wrong (or premature) if ANY of these red flags fires in the draft artifact:

- **All three lanes report `Confidence: 0`** AND the synthesis nevertheless names a root cause → the synthesis is fabricated; the only honest verdict is `more-investigation` or `not-a-bug` (the latter only with cited spec evidence).
- **A lane lists ≥3 hypotheses** in its body — the discipline forbids competing hypotheses on the same lane; collapse to the strongest one OR drop confidence to ≤4 and let the synthesis recommend `more-investigation`.
- **The synthesis cites evidence not in any lane's `Evidence collected:` list** — every fact in the synthesis must trace back to a lane's evidence bullet (otherwise the artifact is internally inconsistent; the reviewer's `edit-discipline` axis catches it).
- **The `## Fix scope` section** appears on a `needs-plan` / `more-investigation` / `not-a-bug` verdict — `## Fix scope` is for `direct-fix` ONLY; on other verdicts the section is omitted entirely (it's the architect's / re-investigator's / user's job to scope the response).
- **The verdict is `direct-fix` but the synthesis names ≥4 files affected** — the gate is "root cause on ≤3 file:line refs in one module"; cross-cutting fixes are `needs-plan`.
- **The verdict is `more-investigation` but `iteration: 1` already** — the cap is 2 dispatches per slug; the second `more-investigation` triggers a stop-and-report to the user (the artifact must include `Notes:` explaining what the next human-driven probe would be).
- **A confidence ≥7 lane skipped the counter-evidence bullet** — high-confidence lanes must list at least one piece of counter-evidence they considered; missing counter-evidence is sycophantic by construction.

## Verification (the artifact is correct iff)

A finished `investigation.md` passes the gate iff ALL of these hold:

1. **Three lane sections present.** `### Lane: cause-code`, `### Lane: cause-config`, `### Lane: cause-measurement` — all three appear under `## Investigation lanes` (in canonical order), even if one or more return `Confidence: 0`.
2. **Per-lane structure complete.** Each lane has `Hypothesis:` (one sentence), `Evidence collected:` (one or more bullets from the five canonical shapes), `Confidence:` (integer 0-10), `Recommended next probe:` (one sentence — or `n/a` for confidence ≥8 lanes that converged).
3. **Synthesis names a single root cause.** `## Root cause (working hypothesis)` is one or two sentences naming ONE mechanism. Multi-cause synthesis is the failure mode the discipline exists to prevent.
4. **Convergence / divergence notes present.** `## Convergence / divergence notes` records whether lanes converged on the same mechanism OR diverged; on divergence it states which lane's hypothesis the synthesis went with and why.
5. **Verdict is exactly one of four values.** `## Next step recommendation` opens with `Verdict:` followed by exactly `direct-fix | needs-plan | more-investigation | not-a-bug` (case-sensitive); the trailing paragraph explains the routing implication.
6. **`## Fix scope` present iff `Verdict: direct-fix`.** On any other verdict the section is omitted (not stubbed with "n/a"; omitted entirely).
7. **Slim summary parses.** The slim summary returned to the orchestrator carries exactly seven lines (`Stage:` / `Artifact:` / `Lanes:` / `Root cause:` / `Next step:` / `Iteration:` / `Confidence:`) plus an optional `Notes:` line that is REQUIRED when `Confidence != high` OR `Next step ∈ {more-investigation, not-a-bug}`.
8. **No code changes shipped.** `git status` from the investigator's working tree shows ONLY the new `investigation.md` (or its update on the re-dispatch path). Any other modified file is a discipline violation — the investigator is strictly read-only.

## When NOT to apply

This skill does NOT fire — and the investigator hop does NOT run — on the following:

- **`triage.taskShape == "build"`** (the default; pre-v8.77 entire-input space) — feature additions, refactors, performance work without a regression claim, doc updates, dependency bumps. Use the standard plan → build → review → critic → ship path. Forcing the investigator on a build task burns 10 minutes of agent budget for no signal (there is no bug to investigate; the three lanes return `Confidence: 0` across the board).
- **`triage.taskShape == "research"`** — the `/cc research <topic>` entry point already has its own multi-lens specialist roster (`research-engineer` / `research-product` / `research-architecture` / `research-history` / `research-skeptic` / `research-design`) driven by the `research-investigation-skill` body. Layering the bug-shaped investigator on top doubles the dispatch and conflates research with debug discipline.
- **Trivial typo fixes / lint fixes / formatting-only commits** even when keywords like `fix` appear — the AND gate on the triage side guards against this (no repo-anchored bug evidence; the task is unanchored). If a task slips through (rare false-positive), the synthesis lands on `direct-fix` quickly and the artifact's evidence is minimal (one file:line citation) — the cost is bounded but still wasted.
- **Production incident-response tasks where the user is mid-page** — the user wants a hotfix NOW, not a 10-minute three-lane investigation. In incident mode the user invokes the orchestrator with `--inline` (which forces `ceremonyMode == "inline"` and skips the entire specialist pipeline including the investigator); the investigator hop is preserved for ceremonyMode ∈ {soft, strict} where the discipline is worth its cost.
- **`taskShape == "debug"` BUT the triage-block carries `iteration: 1` already on the second dispatch** — the cap is 2 investigator dispatches per slug; a `more-investigation` recommendation on the second dispatch triggers stop-and-report instead of re-dispatch (the orchestrator surfaces the artifact's `Notes:` line to the user and ends the turn).

If you find yourself reaching for the investigator on a task that does not match the debug shape, the failure is upstream (triage misclassified). Surface it to the user as "this looks like a build / research task — should I rerun triage?" rather than running the investigator anyway. Forced investigation on a non-debug task is the canonical "shotgun debugging" failure mode this skill exists to prevent.
