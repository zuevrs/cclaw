export interface ExampleArtifact {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

export const EXAMPLES: ExampleArtifact[] = [];

export const EXAMPLES_INDEX = `# .cclaw/lib/examples/

Worked examples of cclaw artefacts (plan / build / review / ship / decision / learning / commit-helper sessions).

> **v8.12 cleanup.** Earlier versions shipped 8 worked examples. Audit found **zero explicit per-file citations** in any specialist or orchestrator-prompt — only a directory-level pointer in the retired \`architect.md\` (now folded into \`design.md\`) that said "see \`.cclaw/lib/examples/\` for prior decisions". The 8 example files were never named in any spec line; agents could grep for them but the spec never said "read \`plan-small.md\` before X".

The examples were intended as scaffolding for early adopters of cclaw to study; they have served that purpose. v8.12 removes them from the install bundle to reduce surface and avoid stale-example drift (the prior batch was written against v8.5 templates and partially diverged from current artefact-templates.ts).

Users who want the deleted examples back can opt into \`legacy-artifacts: true\` in \`.cclaw/config.yaml\`. The shipped flows in \`.cclaw/flows/shipped/\` (a project's actual history) are themselves the most up-to-date examples, and the orchestrator already directs the planner to read them when refining or learning from prior work.
`;
