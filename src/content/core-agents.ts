import type { InstallableAgentId, ResearchAgentId, SpecialistId } from "../types.js";
import { LEARNINGS_RESEARCH_PROMPT } from "./research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "./research-prompts/repo-research.js";
import { SPECIALIST_PROMPTS } from "./specialist-prompts/index.js";

export interface CoreAgent {
  id: InstallableAgentId;
  kind: "specialist" | "research";
  title: string;
  activation: "on-demand";
  modes: string[];
  description: string;
  prompt: string;
}

export interface SpecialistAgent extends CoreAgent {
  id: SpecialistId;
  kind: "specialist";
}

export interface ResearchAgent extends CoreAgent {
  id: ResearchAgentId;
  kind: "research";
}

export const SPECIALIST_AGENTS: SpecialistAgent[] = [
  {
    id: "brainstormer",
    kind: "specialist",
    title: "Brainstormer",
    activation: "on-demand",
    modes: ["frame", "scope", "alternatives"],
    description: "Frame what/why and scope. Optional alternatives sweep when the request is ambiguous.",
    prompt: SPECIALIST_PROMPTS.brainstormer
  },
  {
    id: "architect",
    kind: "specialist",
    title: "Architect",
    activation: "on-demand",
    modes: ["architecture", "feasibility"],
    description: "Architectural decisions plus feasibility against the current codebase.",
    prompt: SPECIALIST_PROMPTS.architect
  },
  {
    id: "planner",
    kind: "specialist",
    title: "Planner",
    activation: "on-demand",
    modes: ["research", "work-breakdown", "topology"],
    description: "Targeted research, work breakdown into AC, execution topology recommendation.",
    prompt: SPECIALIST_PROMPTS.planner
  },
  {
    id: "reviewer",
    kind: "specialist",
    title: "Reviewer",
    activation: "on-demand",
    modes: ["code", "text-review", "integration", "release", "adversarial"],
    description: "Multi-mode reviewer covering code, plan/spec text, integration, release readiness, and adversarial sweeps.",
    prompt: SPECIALIST_PROMPTS.reviewer
  },
  {
    id: "security-reviewer",
    kind: "specialist",
    title: "Security reviewer",
    activation: "on-demand",
    modes: ["threat-model", "sensitive-change"],
    description: "Threat-model + focused review of sensitive changes. Sets security_flag for compound learnings.",
    prompt: SPECIALIST_PROMPTS["security-reviewer"]
  },
  {
    id: "slice-builder",
    kind: "specialist",
    title: "Slice builder",
    activation: "on-demand",
    modes: ["build", "fix-only"],
    description: "Implements AC slices and post-review scoped fixes. Always commits per AC via commit-helper.",
    prompt: SPECIALIST_PROMPTS["slice-builder"]
  }
];

export const RESEARCH_AGENTS: ResearchAgent[] = [
  {
    id: "repo-research",
    kind: "research",
    title: "Repo research",
    activation: "on-demand",
    modes: ["scan"],
    description: "Read-only repo scan: stack, focus-surface patterns, test conventions, risk areas. Dispatched by planner/architect before authoring on brownfield.",
    prompt: REPO_RESEARCH_PROMPT
  },
  {
    id: "learnings-research",
    kind: "research",
    title: "Learnings research",
    activation: "on-demand",
    modes: ["scan"],
    description: "Read-only knowledge.jsonl scan: surface 1-3 prior shipped lessons that overlap with the current task's surface and failure modes. Dispatched by planner before authoring.",
    prompt: LEARNINGS_RESEARCH_PROMPT
  }
];

/**
 * Backward-compatible flat list of every installable agent. Install paths
 * (\`writeAgentFiles\`, harness asset writers, \`uninstall\`) iterate this
 * list. Specialist-only logic should use {@link SPECIALIST_AGENTS}.
 */
export const CORE_AGENTS: CoreAgent[] = [...SPECIALIST_AGENTS, ...RESEARCH_AGENTS];

export function renderAgentMarkdown(agent: CoreAgent): string {
  const modes = agent.modes.map((mode) => `- ${mode}`).join("\n");
  const kindLine = agent.kind === "research" ? "kind: research-helper\n" : "";
  return `---\nname: ${agent.id}\ntitle: ${agent.title}\nactivation: ${agent.activation}\n${kindLine}---\n\n# ${agent.title}\n\n${agent.description}\n\n## Modes\n\n${modes}\n\n## Prompt\n\n${agent.prompt}\n`;
}
