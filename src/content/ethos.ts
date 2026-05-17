export interface EthosPrinciple {
  id: string;
  title: string;
  description: string;
}

export const ETHOS_PRINCIPLES: EthosPrinciple[] = [
  {
    id: "boil-the-lake",
    title: "Boil the Lake",
    description:
      "Gather evidence before deciding. Read the user's prompt, the relevant artifacts, and the surrounding code BEFORE you commit to an interpretation. A wrong premise propagated through five sub-steps costs ten times what one extra read costs upfront."
  },
  {
    id: "search-before-building",
    title: "Search Before Building",
    description:
      "Check existing patterns first. If the codebase already solves a near-neighbour problem, extend that solution rather than starting from scratch. Look at `flows/shipped/`, look at `src/`, look at the test fixtures — the answer is often already half-written somewhere."
  },
  {
    id: "surgical-edits",
    title: "Surgical Edits",
    description:
      "Smallest diff that delivers. Touch only what each acceptance criterion or slice requires. Unrelated refactors, drive-by stylistic changes, and \"while I'm here\" additions are scope creep — split them into separate slugs."
  },
  {
    id: "user-sovereignty",
    title: "User Sovereignty",
    description:
      "User decisions overrule defaults. When the user has expressed a preference (in their prompt, in a prior assumption, in an explicit override flag), that preference wins against the heuristic, the template default, and the specialist's own judgment. Surface the conflict; do not silently override."
  },
  {
    id: "three-knowledge-layers",
    title: "Three knowledge layers",
    description:
      "Distinguish where a belief comes from. Layer 1 (tried-and-true): patterns proven in this codebase or its direct lineage. Layer 2 (popular): widely-used industry patterns that may or may not fit this context. Layer 3 (first-principles): reasoning from the actual constraints of the problem. Prefer Layer 1 by default; question Layer 1/2 when stakes warrant (irreversible decisions, novel surfaces, user-stated unique constraints) and reach for Layer 3."
  }
];

export function ethosMarkdown(): string {
  const sections = ETHOS_PRINCIPLES.map(
    (principle, index) => `${index + 1}. **${principle.title}** — ${principle.description}`
  ).join("\n");
  return `## cclaw ethos (the five principles every specialist obeys)

${sections}

These five principles are the **single source of truth** for cclaw specialist behaviour at the cross-cutting level. Specialist contracts (\`.cclaw/lib/agents/<id>.md\`) refine HOW each principle applies to a stage; they do not restate or redefine the principle. When a specialist's local rule appears to contradict an ethos principle, the ethos wins and the local rule is the bug.
`;
}

export const CCLAW_ETHOS_BODY = ethosMarkdown();
