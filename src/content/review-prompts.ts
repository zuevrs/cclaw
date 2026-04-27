export const REVIEW_PROMPTS: Record<string, string> = {
  "brainstorm-self-review.md": `# Brainstorm Self-Review Prompt

Use this before asking the user to approve the brainstorm artifact.

## Calibration

Only flag issues that would cause a real downstream scope/design mistake:
wrong problem, no real alternative, hidden scope growth, missing user reaction,
or a recommendation that does not trace to the user's answer.

Do not flag prose style, wording preferences, section length, or missing detail
that would not change the scope/design decision.

## Checks

| Category | What to check |
|---|---|
| Premise | Is this the right problem and the direct path? |
| Alternatives | Are there 2-3 meaningfully different options, including exactly one challenger with high/higher upside? |
| User reaction | Does the selected direction trace to the user's reaction/concerns? |
| Scope protection | Does the Not Doing list prevent silent enlargement? |
| Handoff | Is the next-stage handoff explicit and track-aware? |

## Output

Write the result into \`## Self-Review Notes\`:

\`\`\`markdown
- Status: Approved | Issues Found
- Patches applied:
  - <specific patch or None>
- Remaining concerns:
  - <concern or None>
\`\`\`
`,
  "scope-ceo-review.md": `# Scope CEO Review Prompt

Use this after drafting scope boundaries and before user approval.

## Calibration

Think like a founder reviewing whether this is the right product slice. Flag
only issues that would materially change scope, sequencing, leverage, or user
value. Do not nitpick wording.

## Checks

| Category | What to check |
|---|---|
| Premise | Are we solving the right problem now? |
| Leverage | Are we using existing code, constraints, and platform strengths? |
| 10-star delta | Is there a better high-leverage scope move worth cherry-picking? |
| Boundary | Are accepted, deferred, and excluded items unambiguous? |
| Mode fit | Does the selected mode match the evidence: SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE, or SCOPE REDUCTION? |
| Downstream refs | Are R-IDs and LD#hash anchors ready for design/spec/plan? |

## Output

Record in \`## Outside Voice Findings\` or the stage-specific outside voice loop section:

\`\`\`markdown
| ID | Dimension | Finding | Disposition | Rationale |
|---|---|---|---|---|
| CEO-1 | <dimension> | <issue> | accept/reject/defer | <why> |
\`\`\`
`,
  "design-eng-review.md": `# Design Engineering Review Prompt

Use this after drafting design and before handing to spec.

## Calibration

Think like a senior engineer reviewing whether implementation can proceed
without hidden architecture risk. Flag only issues that would cause wrong code,
rework, missing failure behavior, or unverifiable acceptance criteria.

## Checks

| Category | What to check |
|---|---|
| Architecture | Are component boundaries concrete and aligned with scope? |
| Data flow | Are inputs, outputs, persistence, and async/sync edges explicit? |
| Failure modes | Does every meaningful failure have detection, rescue, and user-visible behavior? |
| Traceability | Do design decisions reference relevant R-IDs and LD#hash anchors? |
| Verification | Is each risky choice testable by spec/plan/TDD? |
| Overbuild | Is any architecture stronger than the locked scope actually needs? |

## Output

Record findings in the design artifact's review section:

\`\`\`markdown
## Engineering Review
**Status:** Approved | Issues Found

**Issues:**
- [R#/LD#hash]: <specific issue> — <why it matters>

**Recommendations:**
- <advisory item or None>
\`\`\`
`
};
