# Builder self-review gate

The full per-slice / per-AC JSON summary block contract that the builder emits before the orchestrator dispatches the reviewer. Lifted out of `agents/builder.md` to keep the in-prompt anchor short (~6 lines) while preserving the orchestrator-gate semantics (`self_review[].verified` across all blocks gates reviewer dispatch).

## Why this gate exists

Reviewer cycles are expensive. The orchestrator inspects `self_review` across every slice JSON block AND every AC JSON block AND (in soft mode) the single feature block, and **bounces the slug straight back to builder** (`mode: fix-only`) without dispatching the reviewer when any rule has `verified: false` OR an empty/missing `evidence` string. This catches "work clearly not done yet" before paying for a full reviewer pass.

The reviewer never sees `self_review`. It is a **pre-reviewer** orchestrator gate. The slim summary's shape does not change; the orchestrator reads `self_review` from the JSON blocks.

## Per-slice JSON block (strict mode, work pass)

One per slice in `plan.md > ## Plan / Slices`:

```json
{
  "specialist": "builder",
  "mode": "build|fix-only",
  "kind": "slice",
  "slice": "SL-N",
  "status": "DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED",
  "per_slice_review": {
    "spec": "pass | fail: <verbatim gap>",
    "quality": "pass | fail: <verbatim gap>",
    "fix_attempts": 0
  },
  "phases": {
    "red":      {"sha": "a1b2c3d", "test_file": "tests/unit/permissions.test.ts", "watched_red_proof": "hasViewEmail returns true — expected true got undefined"},
    "green":    {"sha": "4e5f6a7", "files": ["src/lib/permissions.ts:14"], "suite_evidence": "npm test src/lib/permissions.ts → 47 passed, 0 failed"},
    "refactor": {"sha": "9e2c3a4", "applied": true, "shape_change": "hoist claim-name to constant"}
  },
  "self_review": [
    {"slice": "SL-N", "rule": "tests-fail-then-pass", "verified": true, "evidence": "RED a1b2c3d: 1 failing. GREEN 4e5f6a7: 47 passed, 0 failed."},
    {"slice": "SL-N", "rule": "build-clean", "verified": true, "evidence": "tsc --noEmit → 0 errors after GREEN."},
    {"slice": "SL-N", "rule": "no-shims", "verified": true, "evidence": "no NODE_ENV branches, no .skip-ed tests, no @ts-ignore in diff."},
    {"slice": "SL-N", "rule": "touch-surface-respected", "verified": true, "evidence": "diff touches only [src/lib/permissions.ts, tests/unit/permissions.test.ts] — matches Surface."},
    {"slice": "SL-N", "rule": "coverage-assessed", "verified": true, "evidence": "build.md Coverage row: verdict=full; truthy branch (src/lib/permissions.ts:18); falsy branch covered by pre-existing test."}
  ],
  "next_action": "next slice | start AC verification pass | stop and surface"
}
```

If `refactor.applied` is `false` on the slice block, replace `sha` with `null` and add `"reason": "..."`.

## Per-AC JSON block (strict mode, verify pass)

One per AC in `plan.md > ## Acceptance Criteria (verification)`:

```json
{
  "specialist": "builder",
  "mode": "build|fix-only",
  "kind": "ac-verify",
  "ac": "AC-N",
  "verifies": ["SL-1", "SL-2"],
  "commit": "1c2d3e4",
  "evidence": "tests/unit/permissions.test.ts:32 + tests/unit/RequestCard.test.tsx:18 — full suite 49 passed, 0 failed on merged state",
  "self_review": [
    {"ac": "AC-N", "rule": "verifies-slices-implemented", "verified": true, "evidence": "SL-1 + SL-2 both =yes per slice self_review blocks."},
    {"ac": "AC-N", "rule": "ac-evidence-present", "verified": true, "evidence": "build.md AC verification row filled; commit 1c2d3e4 references the AC."},
    {"ac": "AC-N", "rule": "no-production-edits-in-verify", "verified": true, "evidence": "verify(AC-N) diff: empty (slice tests already cover) OR test-only file edits."}
  ],
  "next_action": "next AC | hand off to reviewer | stop and surface"
}
```

## The five per-slice rules (work pass, strict)

| rule | what it attests | minimum evidence |
| --- | --- | --- |
| `tests-fail-then-pass` | RED was watched failing for the right reason; GREEN passes the full relevant suite | RED commit SHA + failing test name + GREEN commit SHA + suite output line |
| `build-clean` | typecheck / build runs cleanly after GREEN (and after REFACTOR when applied) | command + outcome line (`tsc --noEmit` → 0 errors; `go build ./...` → ok; `pnpm build` → ok) |
| `no-shims` | no `NODE_ENV === "test"` branches, no `@ts-ignore` / `eslint-disable` to silence real failures, no `.skip`-ed tests in the diff | one sentence stating "no shims in diff" — be specific about what you scanned for |
| `coverage-assessed` | the Coverage line for this slice was written between GREEN and REFACTOR, with verdict `full` / `partial` / `refactor-only` and named branches | one sentence quoting the verdict + the file:line refs that anchor it. `partial` is a valid verdict; absent line is not. |
| `touch-surface-respected` | the diff only touched files in the slice's `Surface` | the actual list of touched files, matched against the slice's Surface |

## The three per-AC rules (verify pass, strict)

| rule | what it attests | minimum evidence |
| --- | --- | --- |
| `verifies-slices-implemented` | every slice in the AC's `Verifies` list is `=yes` per its own slice block | the slice ids + their `=yes` state |
| `ac-evidence-present` | the AC row in `build.md > ## AC verification` is filled (Evidence + commit), AND a `verify(AC-N): passing` commit exists | the commit SHA + the Evidence cell content |
| `no-production-edits-in-verify` | the `verify(AC-N)` commit's diff contains zero production-code changes (empty diff OR test-only files) | one sentence naming what (if anything) the verify commit changed |

## Hard rules (the 5+3 attestation contract)

- **Every slice** in strict mode produces its own slice JSON block (five rules × N slices). **Every AC** produces its own AC verify JSON block (three rules × M AC). Soft mode produces ONE block for the whole feature (five-rule shape, `{"ac": "feature", "rule": ...}`).
- **Empty evidence is a failure.** "yes" without a concrete one-line citation = `verified: false`. The orchestrator treats that the same as an explicit `verified: false`.
- **You honestly attest.** If a rule is `verified: false`, write the truthful evidence (`"npm test → 1 failing in unrelated suite"`, `"diff touched src/utils/clock.ts which is not in this slice's Surface"`) — the orchestrator uses your evidence to scope the fix-only loop.
- **Do not skip the gate.** A missing `self_review` array is treated as failure on all rules. Always emit the array on every slice / AC block.

## Gate semantics

The orchestrator's gate is `self_review[].verified` across **all blocks** — slice + AC + (soft) feature. If any single entry has `verified: false` OR empty/missing `evidence`, the slug bounces straight back to builder in `mode: fix-only` without consuming a reviewer cycle. Honest attestation is the contract; false positives (`verified: true` with vague evidence) trigger reviewer-stage findings that cost more than the original fix-only round.

The reviewer never sees these blocks. They are an internal pre-reviewer orchestrator gate.
