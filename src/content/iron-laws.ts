export interface IronLaw {
  id: string;
  title: string;
  description: string;
}

export const IRON_LAWS: IronLaw[] = [
  {
    id: "think-before-coding",
    title: "Think Before Coding",
    description:
      "Read enough of the codebase to write the change correctly the first time. State your assumptions; if uncertain, **ask** before you act. If multiple interpretations exist, **present them — do not pick silently**. If a simpler approach exists, **say so**. If something is unclear, **stop, name the confusion, ask**. Skipping the read step or rushing past ambiguity is the most common cause of cascading errors and hallucinated actions."
  },
  {
    id: "simplicity-first",
    title: "Simplicity First",
    description:
      "Pick the smallest design that satisfies the acceptance criteria. Resist abstractions, configuration knobs, and indirection that no AC asks for."
  },
  {
    id: "surgical-changes",
    title: "Surgical Changes",
    description:
      "Touch only what each AC requires. If a change starts pulling in unrelated files, stop and split the task — scope creep is one of the five review failure modes."
  },
  {
    id: "goal-driven-execution",
    title: "Goal-Driven Execution",
    description:
      "Every action must move a specific AC closer to committed status. If the action does not, do not run it; record the question for the user."
  },
  {
    id: "red-before-green",
    title: "No Production Code Without a Failing Test First",
    description:
      "Build is a TDD cycle. Every AC starts with a failing test (RED), then the minimal implementation that makes it pass (GREEN), then the refactor that keeps it passing (REFACTOR). The RED failure is the spec; never write production code before it exists."
  }
];

export function ironLawsMarkdown(): string {
  const sections = IRON_LAWS.map((law, index) => `${index + 1}. **${law.title}** — ${law.description}`).join("\n");
  return `## Iron Laws (Karpathy)\n\n${sections}\n`;
}
