---
name: reviewer-axis-edit-discipline
trigger: every reviewer iteration in `strict` or `soft` ceremonyMode — the edit-discipline axis is the only "always-on" axis among the gated five. Structurally skipped on `ceremonyMode: inline` and on `triage.downgradeReason == "no-git"`.
---

# Skill: reviewer-axis-edit-discipline

Full rubric, evidence-collection guidance, and severity matrix for the reviewer's `edit-discipline` axis (split slice work + AC verification; parallel-by-default safety net). Lifted out of `reviewer.ts` — the prompt now carries only a 5-line stub pointing here.

The `edit-discipline` axis is the ex-post enforcement of the plan's `Touch surface` declarations and the builder's `investigation-discipline` pre-edit gate. Two distinct sub-checks, two distinct findings shapes, codified below.

## When to use

Auto-loads on every reviewer dispatch in `strict` or `soft` ceremonyModes. The axis runs without needing a per-slug gate (it always fires in non-inline modes), so the skill is pinned to the reviewer's dispatch envelope whenever the reviewer runs and ceremonyMode is not `inline`. The axis's two sub-checks (Surface compliance + Pre-edit-investigation evidence) walk the diff after every builder commit lands; iteration N's findings are appended to `flows/<slug>/review.md > Findings` with the same F-N namespace as the other axes.

## When NOT to apply

- `ceremonyMode: inline` — both sub-checks skip; inline mode has no per-criterion commit tracking, so there is no Touch-surface ↔ commit cross-reference to run. Note "edit-discipline: skipped (ceremonyMode=inline)" in the iteration block.
- `triage.downgradeReason == "no-git"` — both sub-checks skip; the diff exists but git history is unavailable. Cite the reason in the iteration block; the orchestrator will not gate on chain integrity.
- A slice with no commits in the build range yet (the builder has not started the slice) — defer the sub-check to the next reviewer iteration; emit zero findings.
- A plan that has no `## Plan / Slices` table AND no legacy `## Acceptance Criteria` table — that is itself a finding on the plan, not on the diff; surface as severity=required (axis=architecture) and recommend the architect re-author the plan.

## Process

**Sub-check 1 — Per-slice surface compliance.** Run `git log --grep="^[a-z]+(SL-[0-9]+)" --name-only --pretty=format:"%H %s"` against the build range. Group commits by their slice id (the `(SL-N)` token in the subject). For each slice, the **set of files touched** must be a subset of the files declared in `plan.md > ## Plan / Slices` under that slice's `Surface` column.

This sub-check is the parallel-by-default safety net's ex-post half: the architect declares each slice's `Surface`, plan-critic §4b verifies that supposedly-independent slices have disjoint surfaces (pre-build gate), and **this sub-check verifies that each per-slice commit actually stayed within its declared `Surface`** (post-build gate). When the builder dispatches sub-builders for a topological layer in parallel, each sub-builder is contractually bound to its assigned slice's Surface; this check is how the reviewer pins that contract.

A file that appears in a slice's commit diff but is NOT in the slice's `Surface` is an **edit-discipline finding (severity=iterate)** — file the finding with the slice id, the undeclared file, and the commit SHA. Cross-slice file touches inside a single `(SL-N)` commit (a `green(SL-2)` that modifies a file declared only in SL-3's `Surface`) are particularly load-bearing — the parallel dispatch would have raced on the file if both slices had landed concurrently. Recommended fix: either add the file to the slice's `Surface` via a plan amendment (fix-only loop authored by architect; the architect also updates `dependsOn` if the new file is shared with another slice) OR revert the undeclared edit. The finding does NOT block ship by default (severity=iterate is below the `required` floor of the ship gate), but it accrues — three or more open `edit-discipline` rows on a single slug escalate to `required` (axis=edit-discipline) for the umbrella concern "build is drifting from declared scope". A single `(SL-N)` commit that touched files exclusively in **another slice's** `Surface` (zero overlap with its own) is **severity=required immediately** — that is a contract violation by the sub-builder, not scope drift.

**Per-AC verify-commit compliance (additional check; runs after Sub-check 1).** For each AC in `plan.md > ## Acceptance Criteria (verification)`, run `git show --stat <verify(AC-N) SHA>` and confirm the diff is **empty OR contains only test files** (no `src/**` / `lib/**` / `app/**`). A verify commit that touches production code is severity=`critical` (axis=correctness, not edit-discipline) — verification commits never carry production behaviour. This check is structurally separate from Sub-check 1 (it asserts a property of verify commits, not a Surface containment), but the file-grouping logic runs in the same git-log pass so the two are listed adjacent here.

**Archived-flow legacy.** Legacy slugs (single AC table, no `## Plan / Slices`) still use `(AC-[0-9]+)` commit grouping and the legacy `Touch surface` declaration on each AC row — run the same containment check with that scope. The reviewer's posture-aware checks already detect the legacy shape; the same detection drives Sub-check 1's grouping regex.

**Sub-check 2 — Pre-edit-investigation evidence.** For every criterion in strict mode, read the criterion row's **Discovery** column in `build.md`. For each non-fresh file in the criterion's `touchSurface`, the cell MUST cite three probes:

1. `git log --oneline -10 -- <path>` outcome (one line citing the most recent commit SHA + subject relevant to the edit, OR the literal "no recent edits" when 10 commits returned nothing in the file's history).
2. `rg "<symbol>" --type <lang>` outcome (count of usage sites + the file:line locations).
3. Full-file-read confirmation (one sentence stating what the read revealed about module-level state, decorators, or re-exports that could change semantics).

A Discovery cell missing any of the three probes — without the explicit `new-file` token — is an **edit-discipline finding (severity=iterate)**. Cite the AC id, the missing probe, and the path. Recommended fix: builder bounces in fix-only mode, runs the missing probe, appends the citation to the Discovery cell, and re-commits the AC row (the build.md row is append-only, so the fix is a new row reference, not an edit-in-place).

**Sub-check 3 — Not-Doing scope-drift cross-reference (folded from the retired `scope-drift` axis).** The former `scope-drift` axis is retired; its essential check folds here as the ex-post enforcement of the plan's `## Not Doing (and why)` declarations. `## Not Doing (and why)` is a first-class plan-template section and plan-critic §6.5 gates ship on the section being non-empty (3-5 bullets naming explicit scope exclusions with one-sentence rationale). Run this sub-check whenever `flows/<slug>/plan.md` carries a non-empty `## Not Doing (and why)` section (the orchestrator stamps `walkScopeDriftAxis: true` as the plan-state signal; legacy plans without the section and inline ceremonies skip).

Read `plan.md > ## Not Doing (and why)` and enumerate every bullet (shape: `- **<scope item>** — <one-sentence reason>.`). Parse the bold-token `<scope item>` and scan the shipped diff (`git diff <plan-commit>..HEAD`), `## Plan / Slices`, and `## Acceptance Criteria (verification)` for evidence the item was implemented via the **four-signal match rubric**:

1. **File-path match** — the diff touches a file whose path maps to the scope item (`caching layer` → `src/cache/**`, `src/lib/cache.ts`).
2. **Symbol / identifier match** — the diff introduces a top-level export / class / function / component whose name maps to the scope item (`webhook delivery retries` → `retryWebhook` / `WebhookRetryQueue`).
3. **AC / Slice-text match** — an AC summary or Slice title references the scope item verbatim or near-verbatim.
4. **Commit-message match** — a commit subject in `git log --grep="<scope-item-token>" --oneline` cites the scope item by name.

A match on ANY of the four signals is a finding filed as `SD-N: <not-doing item> appears to be implemented despite exclusion` (the `SD-` prefix is the scope-drift mnemonic inside the reviewer's `F-N` ledger; recorded with `axis=edit-discipline`). Cite the matching evidence (file:line / plan.md anchor / commit SHA). Severity grading by signal strength (0-10 scale, named in the finding description):

- **0-3** — weak signal (single commit-keyword or a weakly-mapping symbol). Severity = `consider`; author may push back with a citation that the match is coincidental (downgrade to `fyi` only with the citation).
- **4-6** — medium signal (two of the four categories match, unambiguous mapping). Severity = `required`; blocks ship in strict.
- **7-10** — strong signal (three or more categories match; a fresh agent would read the diff as the implementation). Severity = `required` (blocks strict AND soft); on `triage.complexity == "critical"` escalates one tier to `critical`.

**Acknowledged-reversal exception.** A scope-drift signal is NOT a blocking finding when the plan explicitly acknowledges the reversal — either the Not-Doing bullet itself was amended (`- **<scope item>** — was originally excluded; <reason for re-including>.`) OR a `## Open questions` / `## Decisions` row names the reversal verbatim. When acknowledged, emit a `fyi` finding noting the in-flight reversal (so compound captures it as a learnings row); `fyi` never blocks ship.

**Plan-amendment alternative.** When the diff legitimately needed the excluded scope (the architect's Not-Doing call was wrong), the canonical fix is a **plan amendment** — architect bounces with `task: plan-amend`, edits the Not-Doing bullet (removes it OR rewrites the rationale to acknowledge the inclusion), and the plan-amend commit closes the `SD-N` finding with a citation to the plan.md edit. Silently leaving the drift open and shipping anyway is exactly the rationalization this sub-check exists to catch. This closes the Not-Doing enforcement loop: plan-critic §6.5 gates that the section is authored; this sub-check gates that the build respects its exclusions.

## Common rationalizations

Cross-cutting rows for completion / verification / edit-discipline / commit-discipline / posture-bypass live in `.cclaw/lib/anti-rationalizations.md` — read once on dispatch; the three rows below are edit-discipline-axis-specific to this gate:

| rationalization | rebuttal |
| --- | --- |
| "But the new file was just a helper, doesn't count toward the slice's Surface." | New helper files DO count. The slice's `Surface` enumerates every file the slice's commits will edit, including new files. An undeclared new file is exactly the kind of architectural drift the axis exists to catch — surface fires regardless of helper-vs-feature framing. Critically under parallel dispatch: an undeclared helper file may overlap a sibling slice's intended surface and create a race. The builder either declares the new file via a plan amendment (request the orchestrator to bounce to architect for a one-line plan revision; architect also updates `dependsOn` if the file is shared) or moves the helper's contents inline into an already-declared file. |
| "But I had to touch the schema to fix a type error that surfaced during GREEN." | If the type error surfaced during GREEN and required touching a file outside the slice's `Surface`, the slice's plan declaration was incomplete and the discovery is itself a finding. The fix is a plan amendment, not a silent expansion. The builder stops, surfaces the incomplete declaration in the slim summary (`Notes: SL-N requires schema touch; plan amendment needed`), and the orchestrator routes back to architect for the one-line revision before builder re-takes the slice. Silently editing the schema is the contract violation the axis pins down — and under parallel dispatch, the silent edit could race a sibling sub-builder's edit on the same schema file. |
| "But the pre-edit probes were noise — the file is small." | Probes are mandatory regardless of file size; the gate exists because subjective "small enough" judgements were the most common failure mode in earlier builds. Cite the three probes (they are cheap — three shell commands and a read) or claim `new-file` explicitly. There is no `small-file` escape hatch; the axis fires until the citations land. |

## Red flags

- A `green(SL-N)` commit whose `git show --name-only` lists a file not in the slice's declared `Surface` — severity=iterate (escalates to required at 3+ open rows on a slug; severity=required immediately when the touched file lives exclusively in another slice's `Surface`).
- A `verify(AC-N): passing` commit whose `git show --stat` lists `src/**`, `lib/**`, or `app/**` files — severity=critical (axis=correctness). Verification commits never carry production behaviour.
- A non-fresh file in `build.md`'s Discovery cell with fewer than three probes cited (and no `new-file` token) — severity=iterate.
- A `new-file` token in build.md's Discovery cell on a file whose `git log --oneline -1 -- <path>` returns a non-empty SHA — severity=required. Fresh-file claims must be verifiable.
- Three or more open `edit-discipline` rows on a single slug — collapse the rows under a single umbrella finding "build is drifting from declared scope" (severity=required, axis=edit-discipline) until the architect re-authors the surface declarations.
- A `## Not Doing (and why)` bullet whose `<scope item>` matches the diff on three or more of the four signal categories (file path + symbol + AC text + commit message) — `SD-N`, severity=required immediately (strong signal); a dedicated new file for the excluded item is the strongest possible signal.
- An `SD-N` scope-drift signal present in the diff with NO `## Open questions` / `## Decisions` acknowledgement AND no plan-amend commit — the silent-reversal path; severity=required (axis=edit-discipline).

## Worked example

A reviewer iteration that fires Sub-check 1 might produce:

```markdown
F-12 edit-discipline/iterate — src/lib/permissions.ts:* — commit `7a91ab2 green(SL-2): tooltip permission helper` touches `src/lib/permissions.ts`, which is declared in SL-3's `Surface` (not SL-2's). Cross-slice touch — under parallel dispatch this would have raced SL-3's sub-builder.
→ Recommended fix: revert the `src/lib/permissions.ts` edit from SL-2's commit and re-take SL-3 with the actual helper; OR amend the plan (architect bounce) to move the file into SL-2's Surface and update `dependsOn` so SL-3 waits on SL-2.
```

A Sub-check 2 example:

```markdown
F-13 edit-discipline/iterate — src/components/Tooltip.tsx — build.md's Discovery cell for AC-1 cites zero probes despite the file having recent history (`git log --oneline -1 -- src/components/Tooltip.tsx` → `5a91ab2 docs(README): tooltip rewrite`).
→ Recommended fix: builder fix-only — run `git log --oneline -10 -- src/components/Tooltip.tsx`, `rg "Tooltip" --type tsx`, read the full file, append the three-probe citation to the Discovery cell.
```
