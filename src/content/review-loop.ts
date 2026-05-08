export interface FailureMode {
  id: string;
  name: string;
  description: string;
}

export const FIVE_FAILURE_MODES: FailureMode[] = [
  {
    id: "hallucinated-actions",
    name: "Hallucinated actions",
    description:
      "File paths, env vars, ids, or function names that do not exist in the repository. Cross-check every reference before reporting it as done."
  },
  {
    id: "scope-creep",
    name: "Scope creep",
    description: "Changes outside the declared AC. If the diff touches files no AC mentions, surface the question instead of proceeding."
  },
  {
    id: "cascading-errors",
    name: "Cascading errors",
    description:
      "One fix introduces new failures (typecheck, runtime, tests). Verify build/typecheck/test is green for the affected files after each change."
  },
  {
    id: "context-loss",
    name: "Context loss",
    description:
      "Earlier decisions, constraints, or AC text are forgotten. Re-read plan.md frontmatter and AC list before each iteration."
  },
  {
    id: "tool-misuse",
    name: "Tool misuse",
    description:
      "Tool used in the wrong mode or without understanding effects (force pushes, destructive deletes, ambiguous patches). Pause and ask."
  }
];

export const REVIEW_ITERATION_HARD_CAP = 5;

export function failureModesChecklist(): string {
  const items = FIVE_FAILURE_MODES.map(
    (mode, index) => `${index + 1}. **${mode.name}** — ${mode.description}`
  ).join("\n");
  return `### Review checklist — Five Failure Modes\n\n${items}\n\nHard cap: stop after ${REVIEW_ITERATION_HARD_CAP} review/fix iterations and report what remains.`;
}
