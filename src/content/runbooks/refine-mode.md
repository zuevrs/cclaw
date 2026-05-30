# On-demand runbook — refine-mode entry point (refine a shipped slug; triage picks ceremony)

The orchestrator opens this runbook **on every `/cc <task>` whose first whitespace-separated token is a shipped slug** (canonical `YYYYMMDD-<kebab>` shape that resolves under `.cclaw/flows/shipped/`). There is no `extend`/`patch` keyword: a leading shipped-slug token IS the refine signal. The orchestrator stamps `parentContext`, dispatches `triage` with the parent attached, and **triage picks the ceremony**:

- `ceremonyMode: "inline"` → the **micro-edit path** (post-ship patch): one commit, `patch-N.md` next to the parent in `flows/shipped/`, no new slug.
- `ceremonyMode: "soft" | "strict"` → the **refine path** (full follow-up arc): a new slug that `refines:` the parent, `## Extends` section, the standard plan → build → review → critic → ship pipeline.

This single fork replaces the former `/cc patch` and `/cc extend` keyword forks. Both reused `loadParentContext`; the difference (skip-everything vs full-ceremony) is now a triage decision, not a user keyword.

## Trigger evaluation order (Detect hop)

1. **Git-check sub-step** — `.git/` presence; force `ceremonyMode: soft` if absent. (On the inline micro-edit path the terminal commit is gracefully suppressed when `.git/` is absent.)
2. **refine-mode fork** — first token is a shipped slug (this runbook).
3. **research-mode fork** — argument starts with `research ` (case-insensitive, exactly one space).
4. **Default routes** — fresh `/cc <task>` (dispatch `triage`) / resume / collision / legacy state per the Detect table.

The order matters: a leading shipped-slug token wins over the research fork. A user who wants a fresh research flow that happens to mention a slug runs `/cc research <topic>` (the `research ` prefix is checked only after the slug check fails to resolve).

## Slug detection + argument parsing

The fork fires when the **first whitespace-separated token** of the raw `/cc` argument matches the canonical slug shape `^\d{8}-[a-z0-9]+(-[a-z0-9]+)*$` AND `loadParentContext(projectRoot, <token>)` returns `ok: true`. Parse:

- `<slug>` — the first token (matched verbatim; no fuzzy resolution).
- `<task>` — the remainder of the argument string after the slug, trimmed. Must be non-empty.

Sub-cases:

- **Token is slug-shaped but `loadParentContext` returns `ok: false`** — surface the resolution `message` verbatim (it lists the available shipped slugs) and end the turn. This is the typo path; it does NOT silently fall through to a fresh flow. If the user genuinely meant a fresh task that happens to start with a `YYYYMMDD-` token, the message hint invites them to rephrase so the task does not lead with a slug-shaped token.
- **Token is slug-shaped + resolves but no remainder** (argument is just the slug) — surface `refine needs a follow-up task; try '/cc <slug> <task>'`, end the turn.
- **First token is NOT slug-shaped** — the fork does not fire; fall through to the research-mode / fresh-`/cc` routes.
- **A flow is already active (`currentSlug != null`)** — collision case. Surface `Active flow: <slug> (stage: <stage>). Continue with /cc. Cancel with /cc-cancel.` Refine-mode does NOT auto-cancel; it lives outside the active-flow lifecycle.

## Parent validation via `loadParentContext`

Call `loadParentContext(projectRoot, slug)` from `src/parent-context.ts`. The helper returns a discriminated union:

```typescript
type ParentContextResolution =
  | { ok: true; context: ParentContext }
  | { ok: false; reason: ParentContextErrorReason; slug: string; message: string };

type ParentContextErrorReason = "in-flight" | "cancelled" | "missing" | "corrupted";
```

On `ok: false`, surface `message` verbatim and end the turn. The four failure modes:

| `reason` | meaning | message template |
| --- | --- | --- |
| `"in-flight"` | slug is still active under `flows/<slug>/` | `Slug '<slug>' is still in-flight (active under flows/<slug>/). Ship it first, then refine it.` |
| `"cancelled"` | slug was cancelled (under `flows/cancelled/<slug>/`) | `Slug '<slug>' was cancelled (under flows/cancelled/<slug>/, never shipped). Pass a shipped slug.` |
| `"corrupted"` | shipped dir exists but `plan.md` is missing | `Shipped slug '<slug>' is corrupted (plan.md missing under flows/shipped/<slug>/). Cannot use as parent context.` |
| `"missing"` | slug not found under `flows/` or `flows/shipped/` or `flows/cancelled/` | `Unknown slug '<slug>'. Available shipped slugs: <slug1>, <slug2>, ....` (or `No shipped slugs found in .cclaw/flows/shipped/.` when empty; truncated to 10 + `Full list: 'ls .cclaw/flows/shipped/'.` when >10) |

The error message is plain prose, ends the turn, and does NOT consume any clarifying-question quota.

## On `ok: true` — stamp parent context, then dispatch triage

The slug resolves to a shipped flow with a non-empty `plan.md`. Before any specialist runs:

1. **Stamp `flow-state.json > parentContext`** — the resolved `ParentContext` (slug + status: "shipped" + optional shippedAt + artifactPaths). This is the single source of truth for the parent linkage; specialists read this field. On the inline micro-edit path it is transient (cleared after the patch lands); on the refine path it persists until ship.
2. **Dispatch the `triage` sub-agent WITH the resolved `parentContext` in the envelope.** Triage runs its inheritance sub-step (read parent's `ceremony_mode` / `surfaces`; apply escalation/inheritance/router precedence) and its §1.6 trivial-shape downgrade, then returns the ceremony decision. The full inheritance + downgrade contract lives in the `triage` agent (`.cclaw/lib/agents/triage.md`).
3. **Branch on `triage.ceremonyMode`:**
   - `inline` → run the **micro-edit (patch) path** below.
   - `soft` / `strict` → run the **refine path** below.

The differentiator between the two paths is the ceremony decision, NOT a user keyword. Triage's §1.6 downgrade fires for a 1-2 file copy-edit on the same surface the parent already shipped (≤2 file refs, no schema words, no AC additions, single concrete verb) regardless of the parent's own mode; everything else keeps the inherited/heuristic ceremony.

## Micro-edit (patch) path — `triage.ceremonyMode == "inline"`

A post-ship tiny tweak on an already-shipped slug. NO architect, NO plan-critic, NO qa, NO critic, NO ship-gate. The builder dispatches directly with the parent context, writes ONE commit prefixed `patch(<slug>): <message>`, and appends a `patch-N.md` artifact next to the parent's shipped `plan.md`. No new flow dir is created (`currentSlug` stays `null`).

### What the orchestrator does

1. **Do NOT mint a new slug.** The artifact lives in the parent's shipped flow dir as `patch-N.md` (numbered monotonically: next `patch-N` is `N = max(existing) + 1`; first patch is `patch-1.md`). `flow-state.json > currentSlug` stays `null`; `lastSpecialist` stays `null` for the dispatch.
2. **Dispatch `builder` directly** with the `patchMode: true` envelope (below). No other specialist runs.
3. **Skip the ship-gate structured ask.** The single commit IS the finalize step; pushing / PR-opening / merging are user-driven via plain `git`.
4. **Optional `--review` flag.** When the argument carries `--review` (`/cc <slug> --review <task>`), dispatch a lite reviewer pass AFTER the builder commits, scoped to **three axes only**: `correctness` / `readability` / `edit-discipline`. A `block` finding routes the patch back to the builder for a fix-only commit (capped at 2 iterations; third failure stops and reports). The lite review surfaces inline in the same `patch-N.md`.
5. **Clear `parentContext`** after the patch lands (the flow returns to no-active-flow).

### Builder envelope (patchMode: true)

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
─ Required second read: .cclaw/lib/runbooks/refine-mode.md (this file)
```

### `patch-N.md` artifact shape (in parent's shipped dir)

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

- correctness: <pass | block: <verbatim gap>>
- readability: <pass | block: <verbatim gap>>
- edit-discipline: <pass | block: <verbatim gap>>
```

### Builder protocol (lifted from `agents/builder.md` to free in-prompt budget)

1. **Read the parent's `plan.md` end-to-end** as the contract. The parent's `## Spec` / `## Plan` / `## Acceptance Criteria` sections are FROZEN — you do NOT amend them. If the task reads as "add a new AC" or "redesign the X table", you are on the wrong path — **stop** and surface (`Confidence: low`, `Notes: "task adds new AC / changes scope; needs soft/strict refine, not an inline patch"`).
2. **Read the patch task description** as the change request (typically a 1-2 sentence imperative). The task IS the spec.
3. **Make the edit** bounded to the file:line refs the task implies. If your edit grows to a third file, **stop** and surface; the task should run as a soft/strict refine.
4. **Run the project's standard verification command** (the same suite the parent used — read parent `build.md` if present; fall back to `npm test` / `pytest` / `go test ./...`). The suite MUST pass before the commit lands. A failing suite is a fix-only attempt; cap 2 attempts before stop-and-report.
5. **Write ONE commit** with prefix `patch(<slug>): <one-line message>` where `<slug>` is the PARENT slug. Plain `git commit` (no `--amend`, no `--no-verify`).
6. **Append `patch-N.md`** to the parent's shipped flow dir per the shape above.

### What the builder does NOT do in patch-mode

- **No slice topology / parallel dispatch.** Single-edit-single-commit.
- **No per-slice review loop.** The optional `--review` lite pass runs at the orchestrator level after the commit.
- **No `verify(AC-N): passing` discipline.** The parent's AC are FROZEN; the suite passing IS the verification.
- **No flow-state assumption row flipping.** The parent's assumptions are the contract.
- **No `build.md` write.** `patch-N.md` carries the build-log equivalent for the single commit.
- **No `refines:` frontmatter mutation.** The patch is a follow-up edit on the same slug, not a fork.

### Slim summary (patch-mode shape)

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

### When the inline path is the wrong fit

If the change touches ≥3 files, adds a new AC, or carries schema / migration / public-API / payment / auth wording, triage will NOT downgrade to inline — it lands soft/strict and the refine path runs instead (which has the architect / plan-critic / critic passes to catch the regression). The builder's stop-and-surface rule (step 1/3 above) is the backstop if a scope-creep task slips through as inline.

## Refine path — `triage.ceremonyMode == "soft" | "strict"`

A full follow-up arc on a shipped parent. The new flow runs the same pipeline as a standard `/cc <task>` (plan → build → qa? → review → critic → ship); only the parent-context loading at init is new.

1. **Mint a slug for the follow-up flow** — canonical `YYYYMMDD-<semantic-kebab>` from the `<task>` text (same naming + collision rules as a standard `/cc <task>`). Stamp `currentSlug`.
2. **`parentContext` is already stamped** (above) and persists for the flow's lifetime; specialists read it.
3. **Seed `refines: <parent-slug>` in plan.md frontmatter** so the legacy knowledge-store chain, qa-runner skip rule, plan-critic refines gate, and the architect's brownfield path keep working unchanged. `parent_slug:` mirrors the pointer (native field; wins on drift). The two writes (`parentContext` + `refines`) are kept in sync by the same init code path.
4. **Proceed to the first dispatch.** The architect's Phase 0.5 (Parent-context linkage) authors the mandatory `## Extends` section and confirms the `refines:` frontmatter; reviewer adds a parent-contradictions cross-check; critic §3 adds a skeptic question on parent decisions; qa-runner skips when `problemType == "refines"` and the parent qa passed with no UI diff. Per-specialist read patterns live in each specialist's contract.

### Triage inheritance (orchestrator-attached, triage-owned)

The triage sub-agent reads the parent's `ship.md` / `plan.md` frontmatter and seeds the new flow's `ceremonyMode` / `surfaces` before its heuristic, with precedence: (1) escalation heuristic (`security` / `auth` / `migration` / `schema` / `payment` / `gdpr` / `pci` keyword + parent was soft/inline → escalate to strict), (2) parent inheritance, (3) router default. The §1.6 trivial-shape downgrade (→ inline → the micro-edit path) is the one exception. The inheritance is one-way; the new flow's triage values are immutable for its lifetime.

### Multi-level chaining

Refine-mode loads the **immediate** parent only. If `parentContext.slug` itself has `refines:` (a grandparent), the orchestrator does NOT auto-load the grandparent's artifacts. Specialists may walk the chain on demand when transitive context is needed; multi-level auto-loading at orchestrator level is future scope. A patch on an already-patched slug writes the next `patch-N.md` next to the prior ones; a patch on a refined slug targets the child slug, not the grandparent.

## Backwards compatibility

- **Legacy state files** never carry `parentContext` or `patchMode`. Readers default to absent meaning "cold-start flow, no parent" / "standard build flow". Migration is a no-op; both fields are opt-in.
- **Legacy shipped slugs** are valid refine targets. Their plan.md may lack a `parent_slug:` field; the orchestrator does not write one retroactively. A legacy parent does not need any `patch_*` frontmatter to be patch-able; the `patch-N.md` artifact lands in the shipped dir without modifying the parent's existing artifacts.
- **`priorResearch` co-existence.** A refine flow that also follows a `/cc research` ship reads BOTH context sources (the two fields are orthogonal on the FlowState type). `priorResearch` is the bigger / fuzzier context; `parentContext` is the tighter / structured one.
- **A patch that materially changes the parent's behaviour** SHOULD run as a soft/strict refine rather than an inline patch — the knowledge-store gate is the user's compass.
