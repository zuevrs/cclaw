# On-demand runbook — patch-mode entry point

The orchestrator opens this runbook **on every `/cc` whose raw argument starts with the literal token `patch ` (case-insensitive, exactly one space)**. The Detect hop fires before the extend-mode and research-mode forks — `patch` always wins. This runbook covers the full patch-mode contract: argument parsing, parent validation, the inline-only ceremony force, the one-commit builder dispatch, and the `patch-N.md` append into the parent's shipped flow dir.

## Why patch-mode exists (dogfood-driven)

Post-ship "tiny tweak" tasks (rename a label, polish error copy, tighten a copy edit on the same surface the parent slug already shipped) routinely cost more ceremony than they deserve under the existing pipeline. The full `/cc <task>` chain dispatches triage → architect → plan-critic (up to three sequential rubric modes: generic / design / devex) → builder → qa? → reviewer → critic → ship — six to ten sub-agent dispatches — even when the change is a 2-line edit to a single file the parent already touched. The `/cc extend <slug>` fork reduces the context-loading cost (parent artifacts ride on the envelope) but keeps every ceremony stage; the trivial-shape downgrade in triage (§1.6) helps when the task signals are clean, but the user still pays the dispatch tax.

`/cc patch <slug> <task>` is the **micro-edit fast path**: a slug that has already shipped gets a follow-up edit with NO triage, NO architect, NO plan-critic (every rubric mode — generic / design / devex), NO qa, NO critic, NO ship gate. The builder dispatches directly with the parent context envelope, writes ONE commit prefixed `patch(<slug>): <message>`, appends a `patch-N.md` artifact next to the parent's shipped `plan.md` / `build.md` (no separate flow dir), and ends. Optional `--review` enables a lite reviewer pass (correctness + readability + edit-discipline axes only) for the user who wants a second pair of eyes on a security-adjacent micro-edit.

## Trigger evaluation order (Detect hop)

1. **Git-check sub-step** — `.git/` presence; force `ceremonyMode: soft` if absent (does not apply here — patch mode is inline; no git check is run).
2. **patch-mode fork** — argument starts with `patch `.
3. **extend-mode fork** — argument starts with `extend `.
4. **research-mode fork** — argument starts with `research `.
5. **Default routes** — fresh / resume / collision / legacy state per the Detect table.

The order matters: `/cc patch <slug> extend <task>` enters patch mode (the trailing `extend` is part of the task text). `/cc extend <slug> patch <task>` enters extend mode (the trailing `patch` is part of the task text). The two forks are mutually exclusive at the Detect layer; the first-matched-wins rule is deterministic.

## Argument parsing

When the fork fires, parse the argument into two parts:

- `<slug>` — the **first whitespace-separated token** after `patch `. Cases:
  - Empty (argument is exactly `patch` with no remainder) → sub-case "no slug".
  - Present but no follow-up text → sub-case "no task".
  - Present + remainder → continue to validation.

- `<task>` — the **remainder of the argument string** after the slug, trimmed. Must be non-empty for the fork to proceed.

The slug token is matched verbatim; no fuzzy resolution at this layer (a typo surfaces as `reason: "missing"` from `loadParentContext` and the orchestrator's error message lists the available shipped slugs from `.cclaw/flows/shipped/` directly — first 10 inline; pointer to `ls .cclaw/flows/shipped/` when more).

## Parent validation via `loadParentContext`

Call `loadParentContext(projectRoot, slug)` from `src/parent-context.ts` — **the SAME helper that backs the `/cc extend` fork**. The contract is identical: the slug MUST resolve to a shipped flow with a non-empty `plan.md`. Patch mode reuses every error sub-case verbatim:

| `reason` | meaning | message template |
| --- | --- | --- |
| `"in-flight"` | slug is still active under `flows/<slug>/` | `Slug '<slug>' is still in-flight (active under flows/<slug>/). Ship it first, then run /cc patch.` |
| `"cancelled"` | slug was cancelled (under `flows/cancelled/<slug>/`) | `Slug '<slug>' was cancelled (under flows/cancelled/<slug>/, never shipped). Pass a shipped slug.` |
| `"corrupted"` | shipped dir exists but `plan.md` is missing | `Shipped slug '<slug>' is corrupted (plan.md missing under flows/shipped/<slug>/). Cannot use as parent for patch-mode.` |
| `"missing"` | slug not found under `flows/` or `flows/shipped/` or `flows/cancelled/` | `Unknown slug '<slug>'. Available shipped slugs: <slug1>, <slug2>, ....` (or `No shipped slugs found in .cclaw/flows/shipped/.` when empty; truncated to 10 + `Full list: 'ls .cclaw/flows/shipped/'.` when >10) |

The error message is plain prose, ends the turn, and does NOT consume any of the user's quota of clarifying questions. The fork does not allow patching an in-flight slug — that's what `/cc` (no args) on an active flow already does. Patch is for **post-ship** micro-edits only.

## What the orchestrator does on `ok: true`

The slug resolves to a shipped flow with a non-empty `plan.md`. Continue with patch-mode initialisation:

1. **Skip the slug-creation step.** Patch mode does NOT create a new `YYYYMMDD-<task>` slug under `.cclaw/flows/<slug>/` — the artifact lives in the parent's shipped flow dir as `patch-N.md` (see below). `flow-state.json > currentSlug` stays `null`; `lastSpecialist` stays `null`. The patch is logged as a separate artifact alongside the parent's `plan.md`, NOT as a new active flow.
2. **Skip the triage dispatch entirely.** The slug already shipped — its triage decision is in the parent's `plan.md` frontmatter; there is no fresh triage to make. The patch-mode dispatch carries a synthesised sentinel triage envelope: `ceremonyMode: "inline"` (always; the architect-skip-builder-only path), `path: ["build"]`, `runMode: null`, `mode: "task"`, `complexity: "trivial"`, `rationale: "patch-mode post-ship micro-edit"`. Stamp `triage-audit.jsonl` with one entry recording `autoExecuted: true` + `userOverrode: false` + `patchMode: true` for telemetry parity.
3. **Skip the architect dispatch entirely.** No `plan.md` is authored — the parent's `plan.md` IS the contract. The builder reads the parent's `plan.md` (via `parentContext.artifactPaths.plan`) + the patch task description as its envelope inputs. No `## Acceptance Criteria (verification)` table is added; the patch is verified by the suite running green after the edit.
4. **Skip plan-critic (every rubric mode — generic / design / devex) / qa / critic.** All gated specialists structurally skip the inline path; patch mode IS an inline path. The ceremony reduction is the entire point of the fork.
5. **Dispatch `builder` directly with the patch envelope** (see "Builder envelope" below). The builder writes ONE commit prefixed `patch(<slug>): <message>` and appends `patch-N.md` to the parent's shipped dir.
6. **Skip the ship-gate structured ask.** Patch mode auto-commits the single commit; pushing / PR-opening / merging are user-driven via plain `git` commands. There is no `finalization_mode` ask — the commit IS the finalize step.
7. **Optional `--review` flag.** When the user invokes `/cc patch <slug> --review <task>`, the orchestrator dispatches a lite reviewer pass AFTER the builder commits, scoped to **three axes only**: `correctness` / `readability` / `edit-discipline`. No other axes fire. A `block` finding from the lite reviewer routes the patch back to the builder for a fix-only commit (capped at 2 iterations; third failure stops and reports). The lite review surfaces inline in the same `patch-N.md` (no separate `review.md`).

## Patch artifact shape — `patch-N.md` (in parent's shipped dir)

Patch mode does NOT create a new flow dir. The artifact lives at `.cclaw/flows/shipped/<parent-slug>/patch-1.md`, `patch-2.md`, etc. — numbered monotonically (the next `patch-N` is N = max(existing) + 1; on a parent with no prior patches the first patch is `patch-1.md`). The shape:

```markdown
---
patch_index: 1
parent_slug: 20260514-auth-flow
task: <verbatim copy of the user's task description>
shipped_at: <iso-now>
commit: <short-sha>
patch_mode: inline
review_mode: <none | lite>
---

# patch-1 — <one-line task summary>

## Why

<2-3 sentences explaining the post-ship motivation; cite the parent's `plan.md` section the patch touches when applicable>

## Change

- **Files touched**: <list of file:line refs the patch modified>
- **Diff summary**: <one-paragraph summary; no full diff — that's in `git show <sha>`>
- **Commit**: `patch(<slug>): <message>` (`<short-sha>`)
- **Suite run**: `<verification command>` → `<n> passed, 0 failed`

## Lite review (when --review flag was set)

<one-bullet per axis; absent when --review was not set>

- correctness: <pass | block: <verbatim gap>>
- readability: <pass | block: <verbatim gap>>
- edit-discipline: <pass | block: <verbatim gap>>
```

The patch artifact is single-shot — no iterations, no append-only log. If the lite review bounces the patch back, the builder amends the file in place (re-runs the suite, re-writes the commit's SHA in the `commit` frontmatter, re-emits the lite review block). Patch-mode does NOT support multi-step revisions; if the post-ship edit grows beyond a 1-2 file tweak, the user should `/cc-cancel` the patch attempt and re-invoke `/cc extend <slug> <task>` for the full ceremony.

## Builder envelope (patchMode: true)

The orchestrator dispatches the builder with an envelope that carries `patchMode: true` plus the parent context:

```
Dispatch builder
─ Stage: build (patch-mode; post-ship micro-edit)
─ Slug: <parent-slug> (NOTE: no new slug created; artifact lands in parent's shipped dir)
─ Mode: patch
─ patchMode: true
─ Patch task: <verbatim user task text>
─ Patch artifact: .cclaw/flows/shipped/<parent-slug>/patch-<N>.md
─ Parent plan: <parentContext.artifactPaths.plan>
─ Parent build (when present): <parentContext.artifactPaths.build>
─ Parent learnings (when present): <parentContext.artifactPaths.learnings>
─ Required ethos read: .cclaw/lib/cclaw-ethos.md
─ Required first read: .cclaw/lib/agents/builder.md (Patch-mode flow section)
─ Required second read: .cclaw/lib/runbooks/patch-mode.md (this file)
```

The builder's contract carries a dedicated **Patch-mode flow** section (see `agents/builder.md`) that walks the protocol:

- Read parent's `plan.md` + the patch task description as builder context (the parent plan IS the contract; you DO NOT re-author it).
- Skip slice topology / parallel dispatch entirely (patch mode is single-edit-single-commit).
- Skip the per-slice review loop (the lite reviewer pass, if requested, runs at the orchestrator level after commit — not in the builder's context).
- Skip the per-criterion `verify(AC-N): passing` discipline (no new AC is added; the parent's AC are unchanged).
- Skip flow-state assumption row flipping (no `triage.assumptions` field is touched; the parent's assumptions stay frozen).
- Write ONE commit prefixed `patch(<slug>): <message>` after the suite passes.
- Append `patch-N.md` to the parent's shipped dir per the artifact shape above.

The builder's slim summary is the standard six-line shape but the `What changed:` line names the patch artifact path verbatim (`patch-1.md added to flows/shipped/<parent-slug>/`).

## Builder protocol (lifted from `agents/builder.md` to free in-prompt budget)

The builder's full patch-mode flow lives here so the in-prompt anchor in `agents/builder.md` stays short. The contract:

### Six-step protocol

1. **Read the parent's `plan.md` end-to-end** as the contract. The parent's `## Spec` / `## Plan` / `## Acceptance Criteria` sections are FROZEN — you do NOT amend them. The patch task is a follow-up edit that respects the parent's existing scope; if the task description reads as "add a new AC" or "redesign the X table" you are on the wrong fork — **stop** and surface (`Confidence: low`, `Notes: "patch task adds new AC / changes scope; should be /cc extend not /cc patch"`).
2. **Read the patch task description** as the change request. The task is typically a 1-2 sentence imperative ("rename the `Submit` button label to `Send`", "polish the error copy on the rate-limit toast", "extract the magic number in `src/lib/foo.ts:42` to a constant"). The task IS the spec.
3. **Make the edit** bounded to the file:line refs the task implies. Patch-mode's `When NOT to use` rule (below) names ≥3 files as the disqualifier — if your edit grows to a third file, **stop** and surface; the task should run under `/cc extend` for the full ceremony.
4. **Run the project's standard verification command** (the same suite the parent slug used — read `build.md` if present for the canonical command; fall back to `npm test` / `pytest` / `go test ./...` etc.). The suite MUST pass before the commit lands. A failing suite is a fix-only attempt: re-read the parent's plan / build artifacts, adjust, re-run. Cap: 2 attempts before stop-and-report.
5. **Write ONE commit** with the prefix `patch(<slug>): <one-line message>` where `<slug>` is the PARENT slug (not a new slug — patch-mode does not mint slugs). Use plain `git commit` (no `--amend`, no `--no-verify`). The single commit IS the deliverable; the standard slice / AC commit chain does not apply.
6. **Append `patch-N.md`** to the parent's shipped flow dir per the artifact shape above (`## Patch artifact shape`). The frontmatter carries `patch_index: <N>`, `parent_slug: <slug>`, `task: <verbatim>`, `shipped_at: <iso>`, `commit: <short-sha>`, `patch_mode: inline`, `review_mode: <none | lite>`. The body has `## Why` (2-3 sentences), `## Change` (files touched + commit + suite output), and optional `## Lite review` (when the envelope carries `review_mode: lite`).

### What you DO NOT do in patch-mode

- **No slice topology / parallel dispatch.** Patch-mode is single-edit-single-commit. The slice graph in the parent's plan.md is FROZEN; you do not add or modify slices.
- **No per-slice review loop.** The two-stage spec / quality review fires for the parent's slices, not for the patch. The optional `--review` flag enables a lite reviewer pass at the orchestrator level (after your commit lands) — it does NOT run inside your context.
- **No `verify(AC-N): passing` discipline.** The parent's AC are FROZEN; you do not add new AC, you do not re-verify existing AC. The suite passing IS the patch's verification.
- **No flow-state assumption row flipping.** `flow-state.json > triage.assumptions` is FROZEN — the parent's assumptions are the contract. Patch-mode does NOT add new assumptions to the row; if the patch surfaces a new assumption the user should escalate to `/cc extend` (which DOES dispatch architect with a fresh Bootstrap that can amend the row).
- **No `build.md` write.** The parent's `build.md` is FROZEN. The patch artifact is `patch-N.md` in the parent's shipped dir — it carries the build-log equivalent for the single commit.
- **No `refines:` frontmatter mutation.** The parent's `plan.md` frontmatter is FROZEN. Patch-mode does not stamp a new `refines:` chain (the patch is not a fork; it's a follow-up edit on the same slug).

### Hard rules on the patch-mode path

- **No commits without the `patch(<slug>):` prefix.** The reviewer's commit-hygiene axis flags drift; the prefix lets later `git log --grep="patch("` audits surface post-ship patches cleanly.
- **One commit only.** Multiple commits in a patch-mode dispatch is a contract violation — the patch is single-edit-single-commit. If your edit needs to be broken into multiple commits (test + production code separated, helper extraction + use-site update), you are on the wrong fork; the change is non-trivial and warrants `/cc extend`.
- **No production code changes outside the cited file:line refs.** Drive-by edits during a patch are the canonical regression source (the same discipline as the debug-branch `direct-fix` rule). If you find yourself touching a file the task did not cite, **stop** and surface — the task should be re-framed or re-routed to `/cc extend`.
- **Skip ship-gate's structured ask.** Patch-mode does NOT surface the `merge / open-PR / push-only / discard-local / no-vcs` finalization ask. The commit IS the finalize step; the user runs `git push` / `gh pr create` manually if they want to share the patch. The orchestrator-level lite reviewer pass (when `--review` is set) runs after your commit lands but BEFORE the slim summary returns to the user.

### Slim summary (patch-mode shape)

The slim summary is the standard six-line shape with two field adjustments:

```text
Stage: build (patch-mode)  ✅ complete
Status: DONE
Artifact: .cclaw/flows/shipped/<parent-slug>/patch-<N>.md
What changed: patch-<N>.md added; <one-line summary of the edit> (commit <short-sha>)
AC verified: n/a (patch-mode does not add new AC)
Open findings: 0
Confidence: <high | medium | low>
Recommended next: continue
Notes: <optional; required when Confidence != high>
```

The `What changed:` line cites the patch artifact path verbatim plus a one-line summary; the orchestrator parses it for the user-facing slim summary echo.

## Sub-cases — argument shapes the parser must handle

- **Argument is `patch` alone (no slug, no task)** — surface `patch mode needs a parent slug and task; try '/cc patch <slug> <task>'`, end the turn.
- **Argument is `patch <slug>` (slug but no task)** — surface `patch mode needs a follow-up task description; try '/cc patch <slug> <task>'`, end the turn.
- **Argument is `patch <slug> <task>` AND a flow is active (`currentSlug != null`)** — collision case. Surface `Active flow: <slug> (stage: <stage>). Continue with /cc or cancel with /cc-cancel before running /cc patch.` Patch mode does NOT auto-cancel; it lives outside the active-flow lifecycle.
- **Argument is `patch <slug> --review <task>`** — sets `review_mode: "lite"`; the lite reviewer pass runs after the builder commits (three axes: correctness / readability / edit-discipline).
- **Argument is `patch <slug> <task>` AND `<slug>` resolves to a shipped slug with `outcome_signal: "reverted"` in `knowledge.jsonl`** — proceed with the patch, but emit a one-line informational note: `parent slug '<slug>' was later reverted — patching a reverted slug is unusual; verify intent.` The user can still ship the patch; the note exists so a reverted parent does not become invisible context.
- **Argument starts with `patch ` AND `<slug>` matches an active in-flight flow (under `flows/<slug>/`, not `flows/shipped/`)** — surface the `"in-flight"` error: `Slug '<slug>' is still in-flight. Ship it first, then run /cc patch.` Patch is post-ship-only.

## When NOT to use patch-mode

Patch-mode is the **micro-edit** fast path. The user should reach for `/cc extend <slug> <task>` (or a fresh `/cc <task>`) instead when ANY of:

- the change touches ≥3 files (the patch artifact's `Files touched` line is intentionally short — bigger surfaces warrant the full ceremony);
- the change adds a new AC (the parent's AC table is frozen; new behavioural assertions need an architect pass to add D-N + AC-N);
- the change carries schema / migration / public-API / payment / auth wording (security-adjacent edges always escalate; patch-mode has no plan-critic / critic / adversarial pass to catch the regression);
- the user wants a full reviewer pass (patch-mode's lite reviewer covers three axes only; the full fourteen-axis pass requires `/cc extend`).

The orchestrator does NOT auto-detect these escape conditions — that's the user's call. Patch-mode trusts the user's framing; the runbook documents the guardrails.

## Multi-level chaining

A patch on a patched slug works: `/cc patch <slug> <task>` against a slug that already carries `patch-1.md` / `patch-2.md` writes `patch-3.md` next to them. The parent's plan.md still anchors the contract; the prior patches ride alongside as informational context but the builder does NOT have to re-read them (the patch task is independent of prior patches by construction — if the new task touches the same surface as a prior patch, the user should re-verify the suite passes against the cumulative state, but the builder's discipline is single-edit-single-commit regardless).

A patch on an `/cc extend`-ed slug also works: the patch targets the EXTENSION slug (the child of the original parent), not the grandparent. `refines:` chains are NOT walked at the patch layer — the patch trusts the immediate slug as the contract.

## Backwards compatibility

- **Legacy state files** never carry `patchMode` in any envelope. Readers default to `false`/absent meaning "standard build flow". Migration is a no-op; the field is opt-in on the builder envelope.
- **Legacy shipped slugs** are valid patch targets. The parent does not need any `patch_*` frontmatter field to be patch-able; the artifact lands in the shipped dir without modifying the parent's existing artifacts.
- **Legacy knowledge-store entries** are not touched by patch mode (the patch is not a separate slug; no new knowledge entry is appended). A patch that materially changes the parent's behaviour SHOULD also be captured via `/cc extend` rather than `/cc patch` — the knowledge-store gate is the user's compass.
