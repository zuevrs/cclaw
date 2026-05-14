---
name: pre-edit-investigation
trigger: before the FIRST `Write` / `Edit` / `MultiEdit` operation a slice-builder performs in a slug (or in a fix-only iteration that touches a file the slice-builder has not edited yet in this iteration); auto-fires at the build stage when the slice-builder is about to make its first source-file modification
---

# Skill: pre-edit-investigation

cclaw's slice-builder is the only specialist that writes code. The most common defect class in slice-builder output is **editing a file before fully understanding its current state** — modifying a function based on a partial read, missing a recent unrelated edit that conflicts with the planned change, breaking an invariant a sibling caller depends on. Each instance produces a fix-only round-trip; cumulatively, it is the largest source of `axis=correctness` findings in the v8.40+ baseline.

This skill installs a fact-forcing gate before the first edit of any file: three mandatory facts must be gathered (recent edits, usage sites, full file read) before the slice-builder may write. Adapted from the GateGuard runtime hook pattern (deny → force → allow), implemented prompt-only because cclaw's v8.40 removal of mechanical hooks moved this discipline into prompt-level review. The reviewer enforces the rule ex-post via the `edit-discipline` axis from v8.48 onwards — a slice that lacks pre-edit evidence is flagged at handoff.

## When to use

Fires on `stages: ["build"]`, specifically:

1. **Before the slice-builder's FIRST `Write` / `Edit` / `MultiEdit` in a build dispatch.** The first edit in a strict-mode AC's GREEN phase, the first edit in a soft-mode cycle's implementation step, the first edit in a fix-only iteration. "First" is per-file: editing a second file in the same AC also triggers the gate, scoped to the new file.
2. **At the boundary between RED and GREEN in a `test-first` AC.** The RED commit touches test files; the GREEN commit is the first production edit. The gate fires for the GREEN edit even though the slice-builder already edited a test file in the RED phase — production files have their own investigation surface.
3. **In `fix-only` mode, before editing a file the slice-builder has not yet touched in THIS fix iteration.** Re-using investigation evidence from a prior iteration is acceptable when the file has not changed since; cite the prior iteration's evidence with timestamp. Re-running investigation is mandatory when the file has been edited (by anyone) since the last investigation.
4. **In `parallel-build` slices** — each slice-builder runs the gate independently for each file it edits. Sibling slices' edits are invisible (slices never read each other's worktrees mid-flight); the gate's "recent edits" facet still surfaces them via `git log` against `main`.

## When NOT to apply

- **Fresh files with no history** — when the slice-builder's plan declares a new file (the path does not yet exist in the working tree OR in `git log`), there is no history to read. The investigation step is the file path declaration + verification that the file is not in `git log --oneline -- <path>`. Skip the symbol-usage probe (no callers exist yet) and the full-file-read probe (no file exists yet); the gate is "verified clean slate, file path = X". Cite the verification in the build log.
- **Test files in the RED phase of `test-first` posture** — the slice-builder is creating new test files (or appending to test files). RED is by definition the test author's first edit; the gate's "recent edits" probe still runs (to surface a sibling slice-builder having added an unrelated test in the same file), but the "full file read" probe applies to the test file scope, not the production module the test will exercise (which is unchanged at RED time).
- **Inline / trivial flows** — `triage.acMode == "inline"` skips slice-builder dispatch entirely; the orchestrator's own inline edit follows lighter discipline (one read, one edit, one commit). The gate is a slice-builder discipline; the inline path's lighter discipline is captured in the start-command orchestrator body.
- **Mechanical formatting operations on the slice-builder's just-authored code** — the slice-builder's editor running prettier / rustfmt / gofmt on a file the slice-builder just authored in the same iteration. The file's state is already in the slice-builder's working memory; no re-investigation needed.
- **Re-commits inside the same AC after the investigation already landed** — the gate fires once per AC per file. After the RED → GREEN → REFACTOR chain's first GREEN edit lands with investigation evidence, the REFACTOR edit on the same file does not re-trigger (the investigation surface already covers the file's pre-edit state).

## Mandatory facts (three probes before first edit)

Before any `Write` / `Edit` / `MultiEdit` against a file, gather these three facts and cite each in the build log under the AC's `Discovery` column (strict mode) or in the soft-mode build log's `## Build log > Discovery` section.

### Probe 1 — recent edits

Run `git log --oneline -10 -- <path>` against the file you are about to edit. The output is a list of the last 10 commits that touched the file. Read each commit subject; flag any that landed since the plan was authored (compare against `flow-state.json > triage.decidedAt` or the slug's plan-base commit). Recent edits surface unrelated work that may conflict with your AC's planned change — e.g., a refactor that moved the function you were about to modify, a security fix that hardened the validator you were about to relax.

Cite in the Discovery column:

```
- `git log --oneline -10 -- src/lib/permissions.ts` →
    a1b2c3d (3 hours ago) refactor(AC-1): extract hasViewEmail (this slug, AC-1 RED)
    8e9f0a1 (yesterday) green(AC-2 of `20260513-token-rotation`): rotate auth tokens
    ... (8 more commits older than plan-base)
  Verdict: one recent unrelated edit (token-rotation) — surface area is `src/lib/permissions.ts:34-48`, my AC's edit is at `:18`; no overlap.
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

For files >300 lines, read in chunks but cover the whole file before the edit. The reviewer cites partial reads (slice-builder edited a 500-line file after reading only lines 14-58) as `edit-discipline` findings.

Cite in the Discovery column:

```
- Full read of `src/lib/permissions.ts` (87 lines) → no module-level state; one type alias (PermissionClaims) at line 5; three exports (hasViewEmail, hasEditEmail, formatPermissions); my edit at `:18` does not affect the other exports.
```

## When the three probes contradict the plan

If any probe surfaces a fact that contradicts the AC's planned edit — recent edit conflicts with the planned change, usage site depends on the behaviour the AC would break, full-file read reveals an invariant the AC didn't account for — **stop and surface the conflict** in the slice-builder's slim summary. Do not silently revise the plan; the orchestrator hands the slug back to ac-author (small/medium) or re-enters design Phase 4 (large-risky).

This is the discipline's core value-add: the three probes are cheap (≈90 seconds total per file), and they catch the wrong-edit class of failure before any code lands. The cost of one fix-only iteration is ~15 minutes; the cost of pre-edit investigation is one minute. The math favours always running the gate.

## Process

The full sequence in the slice-builder's first-edit moment:

1. **Open the file you are about to edit** with the project's read tool (no edit operation yet).
2. **Run Probe 1** (`git log --oneline -10 -- <path>`); paste the output to the Discovery column; verdict whether any recent edit conflicts.
3. **Run Probe 2** (`rg "<symbol>" --type <lang>` or equivalent); paste the citation list; verdict whether any usage site depends on the about-to-change behaviour.
4. **Run Probe 3** (full file read); paste the file's outline (one line per export / type / invariant); verdict whether the AC's planned edit fits cleanly into the file's structure.
5. **Decide.** If all three verdicts are clean, proceed with the edit; the gate is satisfied. If any probe surfaces a contradiction, stop and surface (per "When the three probes contradict the plan" above).
6. **Run the edit.** The first edit lands; the investigation evidence sits in the build log under the AC's Discovery column. Subsequent edits on the same file within the same AC do not re-trigger the gate.

The Discovery column in `build.md` is the **durable record** of investigation evidence. The reviewer's `edit-discipline` axis reads the column at handoff; an empty Discovery cell on a file the slice-builder edited is the canonical `severity=required` finding.

## Verification

The reviewer's `edit-discipline` axis — axis #8 in the eight-axis review, shipped in v8.48 — enforces the rule ex-post. The check: for every file the slice-builder edited (per `git show --stat <commits>`), the build log's Discovery column must cite Probe 1 + Probe 2 + Probe 3 outputs. A file with edits but no Discovery entries is `severity=required (axis=edit-discipline)`. A file with partial Discovery (one or two probes, not all three) is `severity=consider (axis=edit-discipline)` with a recommended fix-only run for the missing probes.

When the slice-builder declares an exception (fresh file with no history, test file in RED phase, post-format pass), the build log MUST cite the exception with one line ("Pre-edit investigation skipped: fresh file with no history"); the reviewer accepts the skip when the cited reason matches one of the "When NOT to apply" cases above.

## Common rationalizations

The "I already know this file" reflex is how pre-edit-investigation breaks. The table below names every excuse a slice-builder will produce; pair it with the rebuttal and pick the right column.

| rationalization | truth |
| --- | --- |
| "I read this file last week; I remember its structure." | Last week's read is stale evidence by now — see `anti-slop.md`. Re-read; the cost is 30 seconds, the cost of editing on a stale memory is one fix-only iteration. |
| "The AC names the exact line I should edit; reading the rest is overhead." | The AC says WHAT to edit; pre-edit-investigation tells you whether the WHAT is safe. The line the AC names is part of a file whose invariants the AC author may not have known. |
| "Probe 1 (git log) is going to show my own commits; that's not useful." | Filter out your own commits (the ones with this slug's AC prefixes) and read the rest. The probe surfaces sibling slice-builders' work and unrelated security fixes that may have landed since the plan. |
| "Probe 2 (rg for the symbol) takes too long on large repos." | Scope with `--type` filters and module-prefix qualifiers. A focused rg on a typed module returns in under a second; if the symbol is too generic, narrow it OR skip the probe with explicit rationale ("symbol `value` is too generic — read direct importers via `grep import.*<module>`"). |
| "The plan already lists touchSurface; I don't need to investigate the listed files." | touchSurface is a permission list, not an investigation report. The plan author did not run Probe 1/2/3 against your build-state diff; their list may be stale by the time you edit. |
| "I'll just edit and run the tests; if anything breaks, I'll fix it." | This is the failure mode the gate prevents. The fix-only iteration costs 15 minutes; the investigation costs one. Math doesn't work in favour of skipping. |
| "Probe 3 (full file read) is overkill for a 5-line file." | Then it's a 5-line read; the cost is negligible. The rule is "read the whole file"; "the whole file" is short on short files. |
| "I'll skip the investigation, then add it to the build log after the edit." | Investigation-after-edit is the canonical anti-pattern. The evidence is meant to surface contradictions BEFORE the edit; capturing it after is theater. The reviewer flags it as `edit-discipline severity=required`. |

## Red flags

When you catch any of these in your own work, **stop** and run the three probes before proceeding:

- A `Write` / `Edit` / `MultiEdit` operation against a file not yet cited in the build log's Discovery column.
- A Discovery column with one or two probe outputs but missing the third (the partial-discipline anti-pattern).
- A claim like "I know this file" or "I've worked on this before" in the build log instead of fresh investigation evidence.
- Editing a function whose `rg` output has callers you haven't read.
- A first-edit-of-the-iteration that lands before the Discovery row.
- Re-using investigation evidence from a prior iteration's build log without a timestamp note confirming the file is unchanged.

The red flag is not "investigating slowly"; the red flag is "editing without evidence". A 30-second probe + 30-second rg + 60-second read is faster than the cheapest fix-only iteration.

## Worked example — RIGHT

slice-builder's first edit moment for AC-1 (touch `src/lib/permissions.ts`):

Build log entry:

```markdown
| AC | Discovery | RED proof | ...
| --- | --- | --- |
| AC-1 | git log --oneline -10 -- src/lib/permissions.ts → last 10 commits; most recent unrelated edit was 7d ago (token-rotation, lines 34-48); no overlap with AC-1 edit (line 18).
        rg "hasViewEmail" --type ts → 2 call sites (RequestCard.tsx:97, permissions.test.ts:23); neither depends on null-throw behaviour my fix preserves.
        Full read (87 lines): no module-level state; one type alias; three exports; AC-1 edit at line 18 fits cleanly in the existing structure. | ... |
```

Then the edit lands; the gate is satisfied; the reviewer's `edit-discipline` axis confirms all three probes present.

## Worked example — WRONG (and the rebuttal)

Build log entry:

```markdown
| AC | Discovery | RED proof | ...
| --- | --- | --- |
| AC-1 | Edited `src/lib/permissions.ts:18` to add null guard. | ... |
```

Violations:

- No Probe 1 output (recent edits unread).
- No Probe 2 output (usage sites unread).
- No Probe 3 output (full file unread).
- Discovery is a verb (the edit narration), not investigation evidence.

The reviewer flags this as F-N | `edit-discipline` | `severity=required` | `AC-1` | "Pre-edit investigation evidence missing for `src/lib/permissions.ts`; run Probe 1+2+3 per `.cclaw/lib/skills/pre-edit-investigation.md`; cite outputs in the Discovery column."

The slice-builder bounces back in fix-only mode, runs the probes (≈90 seconds), updates the Discovery column, and re-handoff. One round-trip lost; the cost of the original skip exceeded the cost of running the gate up front.

## Composition

`stages: ["build"]` — the gate is the slice-builder's discipline. The reviewer reads the Discovery column ex-post via the `edit-discipline` axis introduced in v8.48; the slice-builder writes the column at investigation time. Other specialists (design, ac-author, reviewer, critic, security-reviewer) do not edit source files — the gate is not relevant to their dispatch.

Pairs with `tdd-and-verification.md` (Discovery is also the surface where tdd's discovery-complete + impact-check gates land — same column, complementary content), with `commit-hygiene.md` (the Discovery column anchors the surgical-edit-hygiene check by establishing the file's pre-edit state), and with `anti-slop.md` (reusing prior investigation evidence without a freshness citation is the stale-evidence anti-pattern).
