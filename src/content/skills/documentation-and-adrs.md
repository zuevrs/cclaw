---
name: documentation-and-adrs
trigger: when design (deep posture, Phase 6.5) AND a Phase 4 D-N introduces a public interface, persistence shape, security boundary, or new dependency; on ship, when an ADR with status=PROPOSED exists for the slug
---

# Skill: documentation-and-adrs

A repo-wide **Architecture Decision Record (ADR) catalogue** lives at `docs/decisions/`. ADRs outlive flows: D-N records are per-slug (inline in `plan.md` under `## Decisions` for v8.14+ flows; in legacy `decisions.md` for pre-v8.14 shipped slugs) and get archived to `shipped/<slug>/` after the finalize step, but ADRs are durable, repo-scoped, and indexed by sequential numbers. The catalogue is what new contributors and future agents read to understand **why** the codebase looks the way it does.

ADRs are NOT a replacement for per-slug D-N records — they are the **promoted subset** that has cross-flow durability. Design (Phase 4 + Phase 6.5) writes both: full D-N records in the slug's `plan.md` `## Decisions` section (rationale, alternatives, failure modes, refs); a thinner ADR pointing back to the slug for the long-term catalogue.

## When NOT to apply

- **Internal refactors** with no public-surface change. The D-N inline in `plan.md` is the only durable record needed.
- **Bug fixes** that preserve the public contract. No architectural decision was made.
- **Per-feature implementation choices** anyone could trivially redo ("which CSS classes to use for this badge", "what to name this helper"). Not durable enough for the catalogue.
- **One-off scripts, benchmarks, and migration glue.** Their decision context evaporates with the script; the ADR slot is wasted.
- **`triage.complexity != "large-risky"` and no `--adr` flag.** Soft / inline flows do not write ADRs; the catalogue is design-specialist territory.
- **Inside `shipped/<slug>/` after the finalize step.** ADRs are repo-durable; the slug artifact is archived. Writing new ADRs against a shipped slug means opening a fresh refinement slug.

## When to write an ADR (not every D-N becomes one)

Write an ADR when **any** of these hold:

| Trigger | Why this needs durable record |
| --- | --- |
| New public interface (exported function, REST endpoint, schema, queue contract) | Future maintainers need to know why the shape was chosen |
| Persistence shape change (column type, index strategy, NoSQL doc layout) | Migrations and forks depend on this being explicit |
| Security boundary (authn/authz model, data classification, secret rotation) | Audits will ask "why" and the per-slug doc is gone in 6 months |
| New runtime dependency (npm/pip/go module added beyond test/build tooling) | Cost/maintenance trade-off was made; record it |
| Architectural pattern adopted or rejected (CQRS, event sourcing, monolith vs split) | Repeats every two years if not pinned |
| User-explicit `/cc <task> --adr` flag | The user wants a durable record |

Do **not** write an ADR for:

- Internal refactors with no public surface change.
- Bug fixes that preserve the public contract.
- Per-feature implementation choices that any other team could trivially redo (e.g. "which CSS class names to use for this badge").
- One-off scripts and benchmarks.

If in doubt: per-slug D-N (inline in `plan.md`) is enough.

## File layout

```
docs/
  decisions/
    README.md                        ← optional index; auto-generated or hand-curated
    ADR-0001-bm25-search-ranking.md
    ADR-0002-feature-flag-rollout-strategy.md
    ADR-0003-postgres-jsonb-vs-separate-table.md
    ...
```

Numbering is **sequential**, zero-padded to 4 digits, and starts at 1. Numbers are never reused (even if an ADR is superseded). The slug in the filename mirrors the cclaw flow slug when there is one — that is how ADR ↔ slug ↔ `decisions.md` cross-reference each other.

## Lifecycle

```
PROPOSED  ──→  ACCEPTED  ──→  (sometimes)  SUPERSEDED
   │                                          ▲
   │                                          │
   └─→ REJECTED (closed without action) ──────┘ (rarely)
```

| Status | Who sets it | When |
| --- | --- | --- |
| `PROPOSED` | design (Phase 6.5) | At decision time, when a Phase 4 D-N triggers an ADR. The ADR ships with `status: PROPOSED` so reviewers can see the proposed-not-yet-accepted state. |
| `ACCEPTED` | orchestrator (finalize step) | After the slug ships successfully (`flows/<slug>/ship.md` had `status: shipped`). The ADR is updated in place: `status: ACCEPTED`, plus an `accepted_at: <iso>` and the shipping `commit:` SHA. |
| `SUPERSEDED` | a future design pass | When a later slug introduces a new ADR that replaces this one. The new ADR's `Supersedes` field cites the old ADR id; the old ADR is updated in place to `SUPERSEDED` with a `superseded_by: ADR-NNNN` line. |
| `REJECTED` | design pass or user | When the slug is cancelled with `/cc-cancel` after the ADR was already proposed, or when the user explicitly says "we're not doing this". The ADR is kept (numbers don't get reused) with `status: REJECTED` and a one-line `rejected_because`. |

ADRs are never **deleted**. The whole point of the catalogue is that even abandoned decisions remain searchable.

## ADR template (design Phase 6.5 writes this)

```markdown
---
adr: ADR-NNNN
title: <short title in present tense, e.g. "Use BM25 for in-process search ranking">
status: PROPOSED
proposed_at: <iso-timestamp>
proposed_by_slug: <cclaw-slug-or-empty>
supersedes: <ADR-XXXX or empty>
superseded_by: <empty until superseded>
tags: [search, ranking, performance]
---

# ADR-NNNN — <title>

## Status

PROPOSED — proposed by cclaw slug `<slug>` on <date>. Will be promoted to ACCEPTED on successful ship; otherwise REJECTED.

## Context

<2-4 sentences. What forced this decision? Cite the slug's plan.md (`## Decisions` section) for the long form. Do not duplicate the rationale here.>

## Decision

<One paragraph. The chosen option, in present tense ("We use BM25..."). No rationale; the rationale lives in the slug's plan.md D-N record.>

## Consequences

- **What becomes easier**: <one bullet>
- **What becomes harder**: <one bullet>
- **What we will revisit**: <one bullet, with a trigger condition>

## References

- cclaw slug: `flows/<slug>/plan.md` `## Decisions` D-N (full rationale)
- Code: `src/server/search/scoring.ts` (primary touch site)
- External: <official docs URL if the decision rests on framework behaviour>
```

The ADR is **deliberately thinner** than the D-N record. It is the executive summary — Status, Context, Decision, Consequences, References. Anyone who needs more reads the linked D-N inline in `plan.md` (which lives in `flows/shipped/<slug>/` after the finalize step).

## Design's ADR contract (Phase 6.5)

When design's posture is `deep` (or user passed `--adr`) AND any Phase 4 `D-N` matches a "When to write an ADR" trigger:

1. Pick the next sequential ADR number. Read `docs/decisions/` to find the highest existing number.
2. Write `docs/decisions/ADR-NNNN-<slug>.md` from the template, status `PROPOSED`.
3. Add a line to the `D-N` Refs inline in `plan.md`: `ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)`.
4. Mention the ADR id in the Phase 7 sign-off summary.

Design does **not** mark the ADR `ACCEPTED` itself — that is the orchestrator's job after a successful ship.

## Orchestrator's contract — promotion at the finalize step

After the compound step and before / during the finalize step:

1. Scan `flows/<slug>/plan.md` (and legacy `flows/<slug>/decisions.md` if present from a pre-v8.14 flow) for any `ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)` line.
2. For each found ADR file, edit in place:
   - `status: PROPOSED` → `status: ACCEPTED`
   - Add `accepted_at: <iso-timestamp>` after `proposed_at`
   - Add `accepted_in_slug: <slug>` (same as proposed_by_slug; explicit for grep)
   - Add `accepted_at_commit: <ship-commit-sha>` (the merge SHA the orchestrator just produced)
3. Commit the ADR promotion with message `docs(adr-NNNN): promote to ACCEPTED via <slug>`. This commit is **part of the finalize step**, alongside the `git mv` of flow artifacts to `shipped/`.

If the slug is cancelled (`/cc-cancel`) instead of shipped:

1. For each PROPOSED ADR tied to the slug, edit `status: PROPOSED` → `status: REJECTED`, add `rejected_at: <iso>`, add `rejected_because: cancelled (no ship)`.
2. Commit the ADR rejection with `docs(adr-NNNN): mark REJECTED — slug <slug> cancelled`.

## Supersession

When a later design pass's decision **replaces** an earlier ADR's choice:

1. The new ADR is written normally, with `supersedes: ADR-XXXX` in its frontmatter.
2. After the new ADR's slug ships, the finalize step also edits the **old** ADR in place: `status: ACCEPTED` → `status: SUPERSEDED`, add `superseded_by: ADR-NNNN`, add `superseded_at: <iso>`. The old ADR's body is **not** rewritten; the catalogue keeps history.

The reviewer (in `text-review` mode) flags any new ADR that proposes a decision contradicting an active ACCEPTED ADR but does not declare `supersedes:` — that is a logic gap, not an oversight.

## Reviewer's contract

In `text-review` mode (when ship.md is being reviewed pre-finalize), the reviewer:

- Verifies that every D-N in the slug's `plan.md` `## Decisions` section (or legacy `decisions.md`) that matches an "ADR trigger" has a corresponding `docs/decisions/ADR-NNNN-<slug>.md` file with status `PROPOSED`.
- Verifies that no ADR status was set to `ACCEPTED` by design (only orchestrator may do that).
- Flags missing ADRs as axis=architecture, severity=`required` in strict mode (`consider` in soft).

## Worked example

Slug `bm25-ranking` (large-risky, strict, tier=product-grade) ships with one D-N about BM25.

Design's Phase 4 emits D-1 inline in `flows/bm25-ranking/plan.md`:

```markdown
## Decisions

### D-1 — Pick BM25 over plain TF for search ranking
- ...
- **Refs:** src/server/search/scoring.ts:1, AC-2, ADR: docs/decisions/ADR-0017-bm25-search-ranking.md (PROPOSED)
```

Design's Phase 6.5 writes `docs/decisions/ADR-0017-bm25-search-ranking.md` with `status: PROPOSED`.

Slug ships successfully. The finalize step runs:

1. `git mv flows/bm25-ranking/* flows/shipped/bm25-ranking/`.
2. Edit `docs/decisions/ADR-0017-bm25-search-ranking.md`: `status: ACCEPTED`, add `accepted_at`, `accepted_at_commit`.
3. `git commit -m "docs(adr-0017): promote to ACCEPTED via bm25-ranking"`.

Six months later, slug `vector-search` has its design phase introduce ADR-0042 with `supersedes: ADR-0017`. After `vector-search` ships, the finalize step also edits ADR-0017: `status: ACCEPTED` → `status: SUPERSEDED`, `superseded_by: ADR-0042`.

## Common pitfalls

- Writing an ADR for every `D-N`. The catalogue swamps the `decisions/` folder with internal trade-offs nobody else will care about. Use the trigger table.
- Putting full rationale in the ADR. The rationale lives in `decisions.md` (which is archived). The ADR is the executive summary.
- Architect setting `status: ACCEPTED` directly. Only the orchestrator does that, and only after a successful ship. Architect always proposes.
- Renumbering ADRs. Numbers are forever; even REJECTED ADRs keep their number (the gap is a feature: it tells you a decision was considered and dropped).
- Writing one ADR per file in the change. One ADR captures **the decision**, not the changes the decision implies.
- Forgetting to cite the slug. The ADR's `References` block must point to the slug's archived `decisions.md`. Without that link, the ADR is decontextualised in three months.

## Catalogue index (optional, useful)

If `docs/decisions/README.md` exists, the orchestrator appends one row per promoted/superseded ADR after the finalize step:

```markdown
| ADR | Title | Status | Slug | Last update |
| --- | --- | --- | --- | --- |
| 0017 | Use BM25 for in-process search ranking | SUPERSEDED | bm25-ranking | 2026-11-12 |
| 0042 | Switch to vector search via pgvector | ACCEPTED | vector-search | 2026-11-12 |
```

If the index does not exist, do not create it. The catalogue works fine as a flat folder; an index is a courtesy, not a requirement.
