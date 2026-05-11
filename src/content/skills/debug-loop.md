---
name: debug-loop
trigger: when build hits a stop-the-line event (test fails for unclear reason, flaky test, regression, hook rejection); also dispatch by request when the user reports a hard-to-reproduce bug
---

# Skill: debug-loop

> The slowest part of debugging is **not** finding the fix. It is **shrinking the loop until the bug is reproducible cheaply**. This skill is the playbook for that shrinking.

## When to invoke

The slice-builder reads this skill in the **stop-the-line procedure** of `tdd-cycle.md` and follows it instead of the generic "diagnose root cause" bullet. Reviewers cite this skill when a finding describes a debugging shortcut (skipped reproduction, single-run flakiness conclusion, untagged debug logs).

The orchestrator may also dispatch a slice-builder in `fix-only` mode with this skill mandated when the user's task is "fix bug X that I keep seeing in production" — the harness needs the discipline more than the speed.

## Phase 1 — Hypothesis ranking (mandatory before any probing)

Before you change a single line of code, write down **3-5 hypotheses** for what is causing the symptom. Each hypothesis has THREE parts:

1. **The hypothesis** (one sentence). "The cache is stale because invalidation is keyed off `user_id` but writes use `account_id`."
2. **Test cost** (one sentence). "Cheap — add a log statement before the cache lookup, run the failing scenario, check the log."
3. **Likelihood** (`high` / `medium` / `low`). "Medium — the symptom matches but I have not confirmed the key mismatch."

Sort by **(likelihood × 1 / test cost)** descending. The top entry is your first probe.

**Show the ranked list to the user** (via slim summary or inline message) **before** running any probes, unless the user explicitly said "just fix it" or the bug is in a fresh slug they have not opened. The user may know which hypothesis is wrong instantly; spending a probe on a known-wrong hypothesis is a flow-budget leak.

## Phase 2 — The loop ladder

Pick the **cheapest** loop type that can prove or disprove the top hypothesis. Walk down this ladder; the lower the rung, the cheaper and faster the iteration.

| Rung | Loop type | When to use | Cost |
|---|---|---|---|
| 1 | **Failing test** (vitest `-t "<name>"`, jest `--testNamePattern`, pytest `-k`) | The bug is reproducible in test scope and the test runner is fast | seconds |
| 2 | **Curl / HTTP script** | The bug is on an HTTP boundary; reproduction is one request | seconds |
| 3 | **CLI invocation** | The bug is in a CLI / script; one command reproduces | seconds |
| 4 | **Headless browser** (Playwright / Puppeteer) | The bug is in client-side JS / DOM / state | tens of seconds |
| 5 | **Trace replay** | The bug came from production; you have a request log / trace dump | seconds once trace is in hand, hours to capture |
| 6 | **Throwaway harness** (a tiny script that imports the suspect module and exercises one path) | None of the above isolate the suspect cleanly | minutes to write, seconds to run |
| 7 | **Property / fuzz loop** (fast-check, hypothesis, libfuzzer) | The bug is "sometimes" and the input shape is enumerable | minutes |
| 8 | **Bisection harness** (`git bisect run <cmd>`) | The bug is a regression; `<cmd>` exits non-zero on the bug | minutes per step, automated |
| 9 | **Differential loop** (compare known-good output to current output) | The bug is "the output looks subtly wrong" but you have a known-good output | minutes |
| 10 | **HITL bash script** (you script the steps, the human runs the part that requires manual interaction) | The bug requires user input / device / credentials the agent cannot have | depends on the human |

**Hard rule:** start at rung 1 unless rung 1 is provably impossible. A failing test is the cheapest, most durable loop type — it stays in the suite as a regression guard after the fix lands. Going straight to rung 6+ when rung 1 was viable is a time leak.

## Phase 3 — Tagged debug logs

When you add temporary log statements during debugging, tag them with a **unique 4-character hex prefix** generated for this debugging session. Format:

```
console.log("[DEBUG-a4f2] cache lookup", { key, hit: !!entry });
```

Pick the prefix once (e.g. `a4f2`) and reuse it for every log added in this session. Why:

- **Cleanup is mechanical.** `rg "\[DEBUG-a4f2\]"` returns every log you added; `sed` or your editor's find-replace removes them in one pass.
- **Multiple debugging sessions don't cross-contaminate.** A second bug a week later uses prefix `b71e`; you do not delete the first session's logs by accident.
- **Reviewers can prove cleanup happened.** The reviewer greps for `\[DEBUG-` in the final diff; if the count is 0, cleanup is verified.

The reviewer cites untagged debug logs as **A-6 — Untagged debug logs** with severity `required` (the cleanup risk is real: a stray `console.log` in production is the canonical post-mortem opener).

Before commit:

1. `rg "\[DEBUG-<your-prefix>\]" src/` — should return 0 hits.
2. `rg "console\.(log|error|warn)" -g '!*.test.*' src/` (or stack equivalent) — sanity check; do not commit any new `console.*` calls outside test files unless the AC asks for it.

## Phase 4 — Multi-run protocol for non-determinism

If a test fails **once** and passes on a re-run, **the test is not green**. It is undecided. The most common AI-coding failure here is "I re-ran it and it passed; moving on" — that is **A-7 — Single-run flakiness conclusion**, severity `required`.

The protocol:

1. Run the failing test **N times** in isolation, where N depends on observed flakiness rate:
   - First failure observed → run **20 times**.
   - 1 failure in 20 → run **100 times** (it is real, you need a frequency estimate).
   - 0 failures in 20 → likely environmental; capture environment delta (env vars, RNG seed, time-of-day, network) and document.
2. Capture the **failure pattern**: which iterations failed, exact assertion, stderr.
3. Diagnose: ordering bug? RNG seed? Time-zone math? Concurrency race? Each has a different fix shape.
4. The fix MUST eliminate the failure, not reduce its rate. A fix that drops the failure rate from 5% to 0.5% is not a fix; it is a band-aid.
5. After the fix, re-run **N×2 times** (40 / 200) to verify zero failures.

Document the multi-run evidence in `build.md`'s GREEN section:

```
GREEN evidence — AC-3
- Affected test: tests/unit/scheduler.test.ts -t "schedules in fairness order"
- Single run: PASS
- Multi-run protocol (flakiness was suspected): 200 iterations, 0 failures.
  Command: for i in {1..200}; do npm test -- -t "schedules in fairness" 2>&1 | tail -3; done
- Full suite: PASS (npm test, 491 passing).
```

## Phase 5 — The "no seam" finding

If, at the end of Phase 1-4, you cannot construct **any** loop that reliably reproduces the bug under cclaw's testing infrastructure, that itself is a **finding**, not a failure. The architectural diagnosis is **"this code has no testable seam for the failure mode"**, and the right response is:

1. Stop trying to fix the bug in this slug.
2. Surface a finding to the reviewer: `F-N | architecture | required | AC-X | <file> | No testable seam exists for the reported failure mode (cite hypotheses tried in Phase 1, loop types attempted in Phase 2). Recommend an architecture slug that introduces dependency injection / observable state at <boundary> before the bug fix retries. | Open a separate architecture slug.`.
3. The orchestrator escalates: the bug becomes a follow-up slug (`refines: <current-slug>`) that runs after the architecture slug ships.

This is the pattern `mattpocock` calls "if no correct seam exists, that itself is the finding". Pretending the bug has a quick fix when it does not is how production bugs become permanent.

## Phase 6 — Artifact

When debug-loop runs as part of a slice-builder dispatch, write a short `flows/<slug>/debug-N.md` (where N is the iteration index, 1-based) with:

```markdown
---
slug: <slug>
stage: build
debug_iteration: 1
hypotheses_count: 3
loop_rung: 1
multi_run: 200
debug_prefix: "a4f2"
seam_finding: false
---

# debug-1.md

## Hypotheses (Phase 1, ranked)
1. **[high, cheap]** … (top — chosen for first probe)
2. **[medium, cheap]** …
3. **[low, expensive]** …

## Loop ladder (Phase 2)
- Picked rung 1 (failing test). Reproduces in <2s.

## Tagged debug logs (Phase 3)
- Prefix: `[DEBUG-a4f2]`
- Locations: `src/lib/cache.ts:84`, `src/lib/cache.ts:127`.
- Cleanup verified: `rg "[DEBUG-a4f2]" src/` returns 0 hits at commit time.

## Multi-run (Phase 4)
- Trigger: test failed once on first observation.
- Iterations: 200; failures: 0 (post-fix).
- Conclusion: was real (cache key collision under concurrency).

## Outcome
- Root cause: `<file>:<line>`. Fix landed under AC-N RED + GREEN.
- Suite: full test run PASS.

## Summary — debug-loop iteration 1
### Changes made
- Probed hypothesis 1; root cause confirmed at `src/lib/cache.ts:127` (cache key composed without account scope).
### Noticed but didn't touch
- Cache layer has no observability hooks; future debugging will need similar tagged logs.
### Potential concerns
- Multi-run was 200; if the bug recurs under different load, escalate.
```

This artifact is **append-only**. Each new debugging iteration in the same slice writes `debug-2.md`, `debug-3.md`, etc. The reviewer reads them as evidence for the GREEN bookkeeping.

## Hard rules

- **Hypotheses before probes.** No "let me just add a log here and see what happens". Three to five hypotheses, ranked, written down, optionally shown to the user.
- **Cheapest loop first.** Rung 1 unless rung 1 is provably impossible.
- **Tagged debug logs only.** Untagged `console.log` is A-6.
- **Single-run pass is not green when flakiness was observed.** Multi-run protocol is mandatory.
- **No seam is a finding.** Do not invent a seam by mocking a real dependency.

## Composition

Dispatched by slice-builder during stop-the-line. Reviewer cites the skill when a build's debugging discipline is sloppy. Orchestrator may dispatch with the skill flagged when the input task is "fix bug X" and ac-mode is strict.
