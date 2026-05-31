---
name: investigation-discipline
title: Investigation discipline (debug-branch)
activation: on-demand
kind: skill
trigger: specialist:investigator | stage:plan | taskShape:debug | task_shape:debug
---

# Skill: investigation-discipline

Auto-triggers on every investigator dispatch. Codifies the **three-lane discipline** + the **evidence-collection rubric** the investigator specialist applies on every bug-shaped flow (`triage.taskShape == "debug"`), AND the **builder pre-edit investigation gate** (absorbed from `pre-edit-investigation`) — the fact-forcing gate before the builder's FIRST Write/Edit/MultiEdit on any file. The skill is the canonical authority for "what does an honest investigation look like" on both surfaces: the investigator's three-lane debug fan-out (sections below) and the builder's edit gate (the **Builder pre-edit investigation gate** section at the end). The three canonical probes (`git log` / `rg` / full-file read) are authored once and shared by both.

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

Every piece of evidence in a lane's `Evidence collected:` bullet list MUST be one of these five canonical shapes (anything else is "vibes-investigation" — the failure mode this discipline was designed to kill):

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
4. **Counter-evidence is NOT optional on ≥6-confidence lanes.** A lane that claims 7 confidence must list at least one piece of counter-evidence it considered and dismissed (with a reason). High-confidence lanes that skip the counter-evidence step are sycophantic by construction; the critic's adversarial pass catches them.

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

## Probe shapes (canonical; shared with the builder pre-edit gate below)

The three canonical probe shapes the investigator's lanes use, identical to the builder pre-edit gate's Probe 1/2/3 (authored in full in the **Builder pre-edit investigation gate** section below):

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

- **`triage.taskShape == "build"`** (the default) — feature additions, refactors, performance work without a regression claim, doc updates, dependency bumps. Use the standard plan → build → review → critic → ship path. Forcing the investigator on a build task burns 10 minutes of agent budget for no signal (there is no bug to investigate; the three lanes return `Confidence: 0` across the board).
- **`triage.taskShape == "research"`** — the `/cc research <topic>` entry point already has its own multi-lens specialist roster (`research-engineer` / `research-product` / `research-architecture` / `research-history` / `research-skeptic` / `research-design`) driven by the `research-investigation-skill` body. Layering the bug-shaped investigator on top doubles the dispatch and conflates research with debug discipline.
- **Trivial typo fixes / lint fixes / formatting-only commits** even when keywords like `fix` appear — the AND gate on the triage side guards against this (no repo-anchored bug evidence; the task is unanchored). If a task slips through (rare false-positive), the synthesis lands on `direct-fix` quickly and the artifact's evidence is minimal (one file:line citation) — the cost is bounded but still wasted.
- **Production incident-response tasks where the user is mid-page** — the user wants a hotfix NOW, not a 10-minute three-lane investigation. In incident mode the user typically frames the task as a tiny, single-file fix ("fix the null guard at src/api/list.ts:42") so the triage heuristic lands on `ceremonyMode == "inline"` and the entire specialist pipeline (including the investigator) is structurally skipped; the investigator hop is preserved for ceremonyMode ∈ {soft, strict} where the discipline is worth its cost.
- **`taskShape == "debug"` BUT the triage-block carries `iteration: 1` already on the second dispatch** — the cap is 2 investigator dispatches per slug; a `more-investigation` recommendation on the second dispatch triggers stop-and-report instead of re-dispatch (the orchestrator surfaces the artifact's `Notes:` line to the user and ends the turn).

If you find yourself reaching for the investigator on a task that does not match the debug shape, the failure is upstream (triage misclassified). Surface it to the user as "this looks like a build / research task — should I rerun triage?" rather than running the investigator anyway. Forced investigation on a non-debug task is the canonical "shotgun debugging" failure mode this skill exists to prevent.

---

# Builder pre-edit investigation gate (absorbed `pre-edit-investigation`)

cclaw's builder is the only specialist that writes code. The most common defect class in builder output is **editing a file before fully understanding its current state** — modifying a function based on a partial read, missing a recent unrelated edit that conflicts with the planned change, breaking an invariant a sibling caller depends on. Each instance produces a fix-only round-trip; cumulatively, it is the largest source of `axis=correctness` findings.

This gate installs a fact-forcing check before the first edit of any file: three mandatory facts must be gathered (recent edits, usage sites, full file read) before the builder may write. Adapted from the GateGuard runtime hook pattern (deny → force → allow), implemented prompt-only because cclaw's removal of mechanical hooks moved this discipline into prompt-level review. The reviewer enforces the rule ex-post via the `edit-discipline` axis — a slice that lacks pre-edit evidence is flagged at handoff. The three probes below are the SAME `git log` / `rg` / full-file-read probes the investigator's `cause-code` lane uses (see **Probe shapes** above); this section authors them in full.

## When the gate fires

Fires on `stages: ["build"]`, specifically:

1. **Before the builder's FIRST `Write` / `Edit` / `MultiEdit` in a build dispatch.** The first edit in a strict-mode AC's GREEN phase, the first edit in a soft-mode cycle's implementation step, the first edit in a fix-only iteration. "First" is per-file: editing a second file in the same AC also triggers the gate, scoped to the new file.
2. **At the boundary between RED and GREEN in a `test-first` AC.** The RED commit touches test files; the GREEN commit is the first production edit. The gate fires for the GREEN edit even though the builder already edited a test file in the RED phase — production files have their own investigation surface.
3. **In `fix-only` mode, before editing a file the builder has not yet touched in THIS fix iteration.** Re-using investigation evidence from a prior iteration is acceptable when the file has not changed since; cite the prior iteration's evidence with timestamp. Re-running investigation is mandatory when the file has been edited (by anyone) since the last investigation.
4. **In `parallel-build` slices** — each builder runs the gate independently for each file it edits. Sibling slices' edits are invisible (slices never read each other's worktrees mid-flight); the gate's "recent edits" facet still surfaces them via `git log` against `main`.

## When the gate does NOT apply

- **Fresh files with no history** — when the builder's plan declares a new file (the path does not yet exist in the working tree OR in `git log`), there is no history to read. The investigation step is the file path declaration + verification that the file is not in `git log --oneline -- <path>`. Skip the symbol-usage probe (no callers exist yet) and the full-file-read probe (no file exists yet); the gate is "verified clean slate, file path = X". Cite the verification in the build log.
- **Test files in the RED phase of `test-first` posture** — the builder is creating new test files (or appending to test files). RED is by definition the test author's first edit; the gate's "recent edits" probe still runs (to surface a sibling builder having added an unrelated test in the same file), but the "full file read" probe applies to the test file scope, not the production module the test will exercise (which is unchanged at RED time).
- **Inline / trivial flows** — `triage.ceremonyMode == "inline"` skips builder dispatch entirely; the orchestrator's own inline edit follows lighter discipline (one read, one edit, one commit). The gate is a builder discipline; the inline path's lighter discipline is captured in the start-command orchestrator body.
- **Mechanical formatting operations on the builder's just-authored code** — the builder's editor running prettier / rustfmt / gofmt on a file the builder just authored in the same iteration. The file's state is already in the builder's working memory; no re-investigation needed.
- **Re-commits inside the same AC after the investigation already landed** — the gate fires once per AC per file. After the RED → GREEN → REFACTOR chain's first GREEN edit lands with investigation evidence, the REFACTOR edit on the same file does not re-trigger (the investigation surface already covers the file's pre-edit state).

## Mandatory facts (three probes before first edit)

Before any `Write` / `Edit` / `MultiEdit` against a file, gather these three facts and cite each in the build log under the AC's `Discovery` column (strict mode) or in the soft-mode build log's `## Build log > Discovery` section.

### Probe 1 — recent edits

Run `git log --oneline -10 -- <path>` against the file you are about to edit. The output is a list of the last 10 commits that touched the file. Read each commit subject; flag any that landed since the plan was authored (compare against `flow-state.json > triage.decidedAt` or the slug's plan-base commit). Recent edits surface unrelated work that may conflict with your AC's planned change — e.g., a refactor that moved the function you were about to modify, a security fix that hardened the validator you were about to relax.

Cite in the Discovery column:

```
- `git log --oneline -10 -- src/lib/permissions.ts` →
    a1b2c3d (3 hours ago) refactor(SL-1): extract hasViewEmail (this slug, SL-1)
    8e9f0a1 (yesterday) green(SL-2 of `20260513-token-rotation`): rotate auth tokens
    ... (8 more commits older than plan-base)
  Verdict: one recent unrelated edit (token-rotation) — surface area is `src/lib/permissions.ts:34-48`, my edit is at `:18`; no overlap.
```

When `git` is not available (`triage.downgradeReason == "no-git"`), the probe is skipped with a one-line note in the Discovery column. The reviewer's `edit-discipline` axis honours the skip in that case.

### Probe 2 — usage sites

Run a ripgrep against the symbol(s) you are about to edit:

```
rg "<symbol-name>" --type <lang>
```

(or the project's equivalent — `ag`, `grep -r`, language-aware search). The output is the list of files that reference the symbol. Read each citation; flag any that depend on a behaviour your edit will change. Usage sites surface invariant breaks — e.g., a caller in `src/api/list.ts` that expected the function to throw on null, when your edit changes it to return false; a test in `tests/integration/auth.test.ts` that pins the old behaviour.

Cite in the Discovery column:

```
- `rg "hasViewEmail" --type ts` →
    src/lib/permissions.ts:14 (export)
    src/components/dashboard/RequestCard.tsx:97 (call site)
    tests/unit/permissions.test.ts:23 (test)
  Verdict: 2 call sites + 1 test — RequestCard's caller does not depend on the null-throw behaviour; the test pins the truthy/falsy contract which my fix preserves.
```

When the symbol is the file path itself (renaming a file rather than editing it), the probe extends to `rg "<old-path>"` to find imports. When the symbol is too generic to grep effectively (e.g., `get`, `value`), narrow the search with file-type filters and module-prefix qualifiers.

### Probe 3 — full file read

Read the **entire target file** (not just the edit window). Reading only the function you are editing misses: invariants documented in the file's docstring / module comment; sibling functions that share state via module-level variables; type definitions at the top of the file that constrain your edit; exports at the bottom that your edit might affect.

For files >300 lines, read in chunks but cover the whole file before the edit. The reviewer cites partial reads (builder edited a 500-line file after reading only lines 14-58) as `edit-discipline` findings.

Cite in the Discovery column:

```
- Full read of `src/lib/permissions.ts` (87 lines) → no module-level state; one type alias (PermissionClaims) at line 5; three exports (hasViewEmail, hasEditEmail, formatPermissions); my edit at `:18` does not affect the other exports.
```

## When the three probes contradict the plan

If any probe surfaces a fact that contradicts the AC's planned edit — recent edit conflicts with the planned change, usage site depends on the behaviour the AC would break, full-file read reveals an invariant the AC didn't account for — **stop and surface the conflict** in the builder's slim summary. Do not silently revise the plan; the orchestrator hands the slug back to the `architect` (whose Decisions phase re-enters on large-risky, or whose Plan-tier re-runs on small/medium).

This is the gate's core value-add: the three probes are cheap (≈90 seconds total per file), and they catch the wrong-edit class of failure before any code lands. The cost of one fix-only iteration is ~15 minutes; the cost of pre-edit investigation is one minute. The math favours always running the gate.

## Process (builder first-edit moment)

1. **Open the file you are about to edit** with the project's read tool (no edit operation yet).
2. **Run Probe 1** (`git log --oneline -10 -- <path>`); paste the output to the Discovery column; verdict whether any recent edit conflicts.
3. **Run Probe 2** (`rg "<symbol>" --type <lang>` or equivalent); paste the citation list; verdict whether any usage site depends on the about-to-change behaviour.
4. **Run Probe 3** (full file read); paste the file's outline (one line per export / type / invariant); verdict whether the AC's planned edit fits cleanly into the file's structure.
5. **Decide.** If all three verdicts are clean, proceed with the edit; the gate is satisfied. If any probe surfaces a contradiction, stop and surface (per "When the three probes contradict the plan" above).
6. **Run the edit.** The first edit lands; the investigation evidence sits in the build log under the AC's Discovery column. Subsequent edits on the same file within the same AC do not re-trigger the gate.

The Discovery column in `build.md` is the **durable record** of investigation evidence. The reviewer's `edit-discipline` axis reads the column at handoff; an empty Discovery cell on a file the builder edited is the canonical `severity=required` finding.

## Verification (builder pre-edit gate)

The reviewer's `edit-discipline` axis enforces the rule ex-post. The check: for every file the builder edited (per `git show --stat <commits>`), the build log's Discovery column must cite Probe 1 + Probe 2 + Probe 3 outputs. A file with edits but no Discovery entries is `severity=required (axis=edit-discipline)`. A file with partial Discovery (one or two probes, not all three) is `severity=consider (axis=edit-discipline)` with a recommended fix-only run for the missing probes.

When the builder declares an exception (fresh file with no history, test file in RED phase, post-format pass), the build log MUST cite the exception with one line ("Pre-edit investigation skipped: fresh file with no history"); the reviewer accepts the skip when the cited reason matches one of the "When the gate does NOT apply" cases above.

## Builder pre-edit gate — common rationalizations

**Cross-cutting rationalizations:** the canonical "I read this file last week" / "AC names the exact line" / "touchSurface is enough" / drive-by rows live in `.cclaw/lib/anti-rationalizations.md` under category `edit-discipline`. The rows below stay here because they cover investigation-specific framings (Probe 1/2/3 filter rules, post-edit-recorded probes, generic-symbol scope rule); the catalog covers the cross-cutting "investigate before edit" prose.

| rationalization | truth |
| --- | --- |
| "I read this file last week; I remember its structure." | Last week's read is stale evidence by now — see `anti-slop.md`. Re-read; the cost is 30 seconds, the cost of editing on a stale memory is one fix-only iteration. |
| "The AC names the exact line I should edit; reading the rest is overhead." | The AC says WHAT to edit; the gate tells you whether the WHAT is safe. The line the AC names is part of a file whose invariants the AC author may not have known. |
| "Probe 1 (git log) is going to show my own commits; that's not useful." | Filter out your own commits (the ones with this slug's prefixes) and read the rest. The probe surfaces sibling builders' work and unrelated security fixes that may have landed since the plan. |
| "Probe 2 (rg for the symbol) takes too long on large repos." | Scope with `--type` filters and module-prefix qualifiers. A focused rg on a typed module returns in under a second; if the symbol is too generic, narrow it OR skip the probe with explicit rationale ("symbol `value` is too generic — read direct importers via `grep import.*<module>`"). |
| "The plan already lists touchSurface; I don't need to investigate the listed files." | touchSurface is a permission list, not an investigation report. The plan author did not run Probe 1/2/3 against your build-state diff; their list may be stale by the time you edit. |
| "I'll just edit and run the tests; if anything breaks, I'll fix it." | This is the failure mode the gate prevents. The fix-only iteration costs 15 minutes; the investigation costs one. Math doesn't work in favour of skipping. |
| "Probe 3 (full file read) is overkill for a 5-line file." | Then it's a 5-line read; the cost is negligible. The rule is "read the whole file"; "the whole file" is short on short files. |
| "I'll skip the investigation, then add it to the build log after the edit." | Investigation-after-edit is the canonical anti-pattern. The evidence is meant to surface contradictions BEFORE the edit; capturing it after is theater. The reviewer flags it as `edit-discipline severity=required`. |

## Builder pre-edit gate — red flags

When you catch any of these in your own work, **stop** and run the three probes before proceeding:

- A `Write` / `Edit` / `MultiEdit` operation against a file not yet cited in the build log's Discovery column.
- A Discovery column with one or two probe outputs but missing the third (the partial-discipline anti-pattern).
- A claim like "I know this file" or "I've worked on this before" in the build log instead of fresh investigation evidence.
- Editing a function whose `rg` output has callers you haven't read.
- A first-edit-of-the-iteration that lands before the Discovery row.
- Re-using investigation evidence from a prior iteration's build log without a timestamp note confirming the file is unchanged.

The red flag is not "investigating slowly"; the red flag is "editing without evidence". A 30-second probe + 30-second rg + 60-second read is faster than the cheapest fix-only iteration.

## Builder pre-edit gate — worked example (RIGHT)

builder's first edit moment for AC-1 (touch `src/lib/permissions.ts`):

```markdown
| AC | Discovery | RED proof | ...
| --- | --- | --- |
| AC-1 | git log --oneline -10 -- src/lib/permissions.ts → last 10 commits; most recent unrelated edit was 7d ago (token-rotation, lines 34-48); no overlap with AC-1 edit (line 18).
        rg "hasViewEmail" --type ts → 2 call sites (RequestCard.tsx:97, permissions.test.ts:23); neither depends on null-throw behaviour my fix preserves.
        Full read (87 lines): no module-level state; one type alias; three exports; AC-1 edit at line 18 fits cleanly in the existing structure. | ... |
```

Then the edit lands; the gate is satisfied; the reviewer's `edit-discipline` axis confirms all three probes present.

## Builder pre-edit gate — worked example (WRONG, and the rebuttal)

```markdown
| AC | Discovery | RED proof | ...
| --- | --- | --- |
| AC-1 | Edited `src/lib/permissions.ts:18` to add null guard. | ... |
```

Violations: no Probe 1 output (recent edits unread); no Probe 2 output (usage sites unread); no Probe 3 output (full file unread); Discovery is a verb (the edit narration), not investigation evidence. The reviewer flags this as F-N | `edit-discipline` | `severity=required` | `AC-1` | "Pre-edit investigation evidence missing for `src/lib/permissions.ts`; run Probe 1+2+3 per `.cclaw/lib/skills/investigation-discipline.md`; cite outputs in the Discovery column." The builder bounces back in fix-only mode, runs the probes (≈90 seconds), updates the Discovery column, and re-handoff. One round-trip lost; the cost of the original skip exceeded the cost of running the gate up front.

## Builder pre-edit gate — composition

The gate is the builder's discipline (`stages: ["build"]`). The reviewer reads the Discovery column ex-post via the `edit-discipline` axis; the builder writes the column at investigation time. Pairs with `tdd-and-verification.md` (Discovery is also the surface where tdd's discovery-complete + impact-check gates land — same column, complementary content), with `commit-hygiene.md` (the Discovery column anchors the surgical-edit-hygiene check by establishing the file's pre-edit state), and with `anti-slop.md` (reusing prior investigation evidence without a freshness citation is the stale-evidence anti-pattern).
