export const DECISION_PROTOCOL = `# Decision protocol (short form)

A decision exists only when there is a real choice between at least two options. The full schema, FMT, and pre-mortem rules live in \`lib/agents/architect.md\`. This page covers only the question "is this a decision at all?"

## What is not a decision

- "Use the library that is already in the project."
- "Match the existing pattern" (unless two competing patterns exist).
- "Pick what the user asked for."

If you find yourself writing one of these, do not open a \`D-N\`. Capture the choice as a one-line note in \`flows/<slug>/plan.md\` if it is worth remembering at all.

## What every D-N must carry

\`Context · Considered options (>= 2) · Selected · Rationale · Rejected because · Consequences · Refs\`. Add **Failure Mode Table** + **Pre-mortem** for every product-grade or ideal tier decision (see architect.md).

## Worked examples

See \`lib/examples/decision-bm25-search.md\`, \`lib/examples/decision-permission-cache.md\`, \`lib/examples/decision-forward-only-migration.md\`.

## Refactoring decisions

Decisions are immutable once shipped. To revisit:

- in the active run, edit the existing \`D-N\` and append a "Revised:" subsection;
- after ship, write a new \`D-N\` in the refining slug and reference the prior \`D-N\` in its Refs section.
`;
