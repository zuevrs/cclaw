---
name: verification-loop
trigger: before any handoff between specialists or before ship; auto-triggered for slice-builder (between phases) and reviewer (before dispatch)
---

# Skill: verification-loop (v8.13, T2-1)

A **staged verification gate**. Each step runs only when the previous step passed. The point: catch regressions at the earliest, cheapest gate, instead of letting build/lint failures surface at ship and costing a full review iteration.

## Gates (in order)

1. **build** — `npm run build` (or the project's equivalent). Compilation / bundling success. Cheapest gate, catches type errors that escape the editor LSP, missing imports, etc.
2. **typecheck** — `npm run typecheck` / `tsc --noEmit` / `pyright` / `mypy` / `go vet`. Run separately from `build` because some build pipelines emit on type errors and only fail at runtime; the typecheck gate makes the contract explicit.
3. **lint** — `npm run lint` / `ruff check` / `golangci-lint run`. Style + obvious-bugs gate. Lint warnings count as **failures** here when the project has lint-as-error in CI; otherwise warnings pass but are recorded.
4. **test** — the project's full relevant suite (`npm test`, `pytest`, `go test ./...`). The slice-builder's GREEN evidence is a *subset* of this gate (per-AC suite); verification-loop runs the full repo suite.
5. **security** — when the slug's `security_flag` is true OR the diff matches the security-sensitive heuristic from the review stage (see start-command.ts), run the project's security check (`npm audit --audit-level=high`, `pip-audit`, `bandit`, `govulncheck`). When the check is absent, skip with an explicit "no security check configured" line in the verification log.
6. **diff** — `git diff --stat` + `git diff --name-only` against the slug's plan-base. Verifies the working tree is clean (no uncommitted changes) and the touched-file set matches the AC's union of touchSurfaces. Detects accidental commits to files outside the slug.

## How to run

Run gates **in order**. On failure of any gate:

- **Stop**. Do not continue to later gates — they will be running on a known-broken state and their output is misleading.
- **Capture** the failing gate's output (command + 1-3 line failure excerpt).
- **Decide** the recovery path:
  - If the gate is `build` / `typecheck` / `lint` and the failure is mechanical (missing semicolon, unused import, type widening): fix it, re-run from gate 1. **No reviewer dispatch yet.**
  - If the gate is `test` and the failure is a real regression: bounce the slice back to slice-builder in `fix-only` mode citing the failing test. **No reviewer dispatch yet.**
  - If the gate is `security`: surface to user with the audit output; require explicit `accept-warns` for medium-severity, `fix-only` for high+.
  - If the gate is `diff`: investigate uncommitted changes — were they leftover from a fix-only loop? Stage and commit, or stash and re-run.

## Modes

- **strict** (default for ship-gate): every gate must pass; failure of any blocks the next.
- **continuous** (slice-builder between AC): runs in the background as you work; reports status after each AC's REFACTOR commit. Failures surface as warnings; build proceeds to the next AC, but the cumulative failure list must be empty before review-stage entry.
- **diff-only** (text-only changes): skip build/typecheck/lint/test/security; run only the diff gate (working tree cleanliness + touchSurface match).

## Output format

Append to `flows/<slug>/build.md > Verification log` (one block per run):

```markdown
## Verification log — 2026-05-10T19:34Z (mode=strict)

| gate | command | result | evidence |
| --- | --- | --- | --- |
| build | npm run build | pass | exit 0; bundle size 142kb |
| typecheck | npm run typecheck | pass | exit 0; 0 errors |
| lint | npm run lint | pass | exit 0; 0 warnings |
| test | npm test | pass | 47 passed, 0 failed (2.3s) |
| security | npm audit --audit-level=high | pass | 0 high or critical vulnerabilities |
| diff | git diff --stat origin/main...HEAD | pass | 4 files changed, 89 ins, 12 del; touchSurface match |

Verdict: pass — ready for handoff.
```

When a gate fails, the row records `fail` with the excerpt; subsequent rows are blank with a single line "(skipped — earlier gate failed)" instead of running. The verdict is `fail — <reason>`.

## When to invoke

- **slice-builder** runs the loop in `continuous` mode after every AC's REFACTOR commit; in `strict` mode before returning the slim summary.
- **reviewer** runs the loop in `strict` mode before deciding `clear` or `warn`; a failed gate forces `block` regardless of finding count.
- **ship-gate** runs the loop in `strict` mode (this is the same set of gates §2 + §2a of the ship runbook codifies; verification-loop is the named skill that wraps them coherently).
- **slice-builder fix-only** runs the loop in `strict` mode after the fix commit, before re-handing off to reviewer.

## Hard rules

- **Never skip a gate to "save time".** A skipped gate is recorded as `skipped` with reason; the reviewer treats unjustified skips as `required` (axis=correctness).
- **Never run later gates after an earlier failure.** Their output is meaningless on a broken substrate.
- **Never silence a failing gate by editing the gate config** (changing lint rules, removing security audits, marking tests as `.skip`) without an explicit `Decisions.md` entry citing why.
- **Never claim a gate passed by pasting yesterday's output.** Run it fresh in the current turn.

## Common pitfalls

- Running test before typecheck and reporting "tests pass" while the build is broken — typecheck catches contract violations the test cannot.
- Running the gate then immediately re-editing without re-running. The recorded evidence must match the current working tree.
- Treating lint warnings as "fyi" without checking the project's CI strictness — many CI pipelines fail on warnings.
- Skipping the diff gate because "I know what I changed". The diff gate catches uncommitted leftover edits from a prior loop that would have shipped without anyone noticing.
- Running security only when `security_flag` is set, even though the diff added a new dependency. Dependency adds always trigger security regardless of the flag.
