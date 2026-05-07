export const DECISION_PROTOCOL = `# Decision protocol

\`architect\` and (occasionally) \`reviewer\` mode=\`text-review\` write decisions. This protocol defines what a decision record must contain so it remains useful when re-read months later.

## Where decisions live

\`.cclaw/decisions/<slug>.md\` for the active run; moves to \`.cclaw/shipped/<slug>/decisions.md\` after ship. Each file holds one or more decisions identified as \`D-1\`, \`D-2\`, ...

## The minimum decision record

Every decision must include:

1. **Title** — \`## D-N — <one-line description>\`. Imperative voice. The title alone should let a future reader recognise the decision.
2. **Context** — what makes this a real decision instead of a default. If you cannot write the context, you do not have a decision.
3. **Considered options** — at least two. Each with a one-sentence trade-off. Single-option decisions are not decisions.
4. **Selected** — name the option you picked. No prose; just "Option B".
5. **Rationale** — why the selected option beats the others *right now*. Cite numbers, file:line refs, or prior shipped slugs.
6. **Rejected because** — one short reason per rejected option.
7. **Consequences** — what becomes easier; what becomes harder; what we will revisit.
8. **Refs** — file:line, AC-N, related decision id from another slug, external link.

If a decision is small enough that the seven sections fit in one paragraph, that is fine — but keep the \`D-N\` heading and the section labels in inline form.

## When a decision is not a decision

- "Use the library that is already in the project" — not a decision; it is a default.
- "Match the existing pattern" — not a decision unless there are two competing existing patterns.
- "Pick the one the user asked for" — not a decision; it is execution.

If you find yourself writing one of these, drop the decision record. Save real D-N entries for real choices.

## Refactoring decisions

Decisions are immutable once shipped. To revisit:

- in the active run, edit the existing \`D-N\` and append a "Revised:" subsection;
- after ship, write a new \`D-N\` in the refining slug and reference the prior \`D-N\` in its Refs section.

## Worked examples

### D-1 — Pick BM25 over plain TF for search ranking

- **Context:** plain TF favours short tickets, which our users complained about. We need a richer ranking but cannot afford to add an external service.
- **Considered options:**
  - Option A — keep TF; add field weighting. Cheap; doesn't address the length-bias root cause.
  - Option B — implement BM25 in-process. Costs ~1 week; addresses length bias.
  - Option C — switch to a vector store (e.g. pgvector). Costs ~3 weeks; far broader scope than this slug.
- **Selected:** Option B.
- **Rationale:** length-bias is the root cause per \`docs/research/2026-04-search-quality.md\`; in-process BM25 is well-trodden (see \`src/server/search/scoring.ts\`); the budget for this slug is one week.
- **Rejected because:** A — does not address root cause. C — out of scope; should be a separate slug if proven necessary.
- **Consequences:** writes a new \`scoring.ts\` module; index payload grows by ~12%; ranking parity test must be updated.
- **Refs:** \`src/server/search/scoring.ts:1\`, AC-2, \`docs/research/2026-04-search-quality.md\`.

### D-2 — Cache user permissions for 60 s instead of re-checking on render

- **Context:** the new tooltip wants to gate email visibility on a permission claim. Re-checking IAM on every render adds 8 ms p99.
- **Considered options:**
  - Option A — re-check on render. Always fresh; misses the budget.
  - Option B — cached claim with 60 s TTL. Already used by \`view-billing\`.
  - Option C — separate React context. Adds a provider; no real benefit.
- **Selected:** Option B.
- **Rationale:** consistent with \`view-billing\`; meets the render budget; 60 s staleness acceptable per the threat model.
- **Rejected because:** A — render budget. C — redundant.
- **Consequences:** future permission gates on the dashboard should reuse this path; \`view-billing\` and \`view-email\` should be tested together.
- **Refs:** \`src/lib/permissions.ts:14\`, AC-1, AC-3, \`reviews/<slug>.md\` security iteration 1.

### D-3 — Forward-only migration for the BM25 index payload change

- **Context:** the BM25 change requires a new column in the index payload. Reversing the change requires re-indexing.
- **Considered options:**
  - Option A — reversible migration with both columns. Doubles index size during transition.
  - Option B — forward-only migration with a re-index. Simpler; needs a re-index script.
- **Selected:** Option B.
- **Rationale:** index size is the binding constraint; re-index script is a 30-line addition; rollback is unlikely once the ranking parity test passes.
- **Rejected because:** A — index size cost outweighs the rollback risk.
- **Consequences:** re-indexing runs once during deploy; observability dashboard must include re-index progress.
- **Refs:** \`src/server/db/migrations/2026-05-07-bm25.sql\`, \`scripts/reindex.mjs\`, \`docs/runbooks/reindex.md\`.
`;
