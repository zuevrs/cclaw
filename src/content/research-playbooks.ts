export interface ResearchPlaybook {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

export const RESEARCH_PLAYBOOKS: ResearchPlaybook[] = [];

export const RESEARCH_PLAYBOOKS_INDEX = `# .cclaw/lib/research/

Research playbooks the ac-author or the \`design\` phase dispatch to before authoring \`plan.md\` (ac-author sections) or composing design's Phase 6 output.

> **v8.12 cleanup.** Earlier versions shipped 3 research playbooks (\`reading-codebase.md\`, \`time-boxing.md\`, \`prior-slugs.md\`). Audit found **zero explicit citations** in any specialist or orchestrator-prompt — they were "browse if relevant" optional reading that the spec never directed agents to consult by name.

cclaw v8.12 keeps the two **dispatched** research helpers (\`learnings-research\` and \`repo-research\`) — those are full sub-agent specialists, not browsable playbooks, and their contracts live in \`.cclaw/lib/agents/learnings-research.md\` + \`.cclaw/lib/agents/repo-research.md\`. The deleted playbooks duplicated guidance that already lives in those agent contracts.

Users who want the deleted playbooks back can opt into \`legacy-artifacts: true\` in \`.cclaw/config.yaml\`.
`;
