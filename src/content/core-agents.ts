import type { SpecialistId } from "../types.js";
import { SPECIALIST_PROMPTS } from "./specialist-prompts/index.js";

export interface CoreAgent {
  id: SpecialistId;
  title: string;
  activation: "on-demand";
  modes: string[];
  description: string;
  prompt: string;
}

export const CORE_AGENTS: CoreAgent[] = [
  {
    id: "brainstormer",
    title: "Brainstormer",
    activation: "on-demand",
    modes: ["frame", "scope", "alternatives"],
    description: "Frame what/why and scope. Optional alternatives sweep when the request is ambiguous.",
    prompt: SPECIALIST_PROMPTS.brainstormer
  },
  {
    id: "architect",
    title: "Architect",
    activation: "on-demand",
    modes: ["architecture", "feasibility"],
    description: "Architectural decisions plus feasibility against the current codebase.",
    prompt: SPECIALIST_PROMPTS.architect
  },
  {
    id: "planner",
    title: "Planner",
    activation: "on-demand",
    modes: ["research", "work-breakdown", "topology"],
    description: "Targeted research, work breakdown into AC, execution topology recommendation.",
    prompt: SPECIALIST_PROMPTS.planner
  },
  {
    id: "reviewer",
    title: "Reviewer",
    activation: "on-demand",
    modes: ["code", "text-review", "integration", "release", "adversarial"],
    description: "Multi-mode reviewer covering code, plan/spec text, integration, release readiness, and adversarial sweeps.",
    prompt: SPECIALIST_PROMPTS.reviewer
  },
  {
    id: "security-reviewer",
    title: "Security reviewer",
    activation: "on-demand",
    modes: ["threat-model", "sensitive-change"],
    description: "Threat-model + focused review of sensitive changes. Sets security_flag for compound learnings.",
    prompt: SPECIALIST_PROMPTS["security-reviewer"]
  },
  {
    id: "slice-builder",
    title: "Slice builder",
    activation: "on-demand",
    modes: ["build", "fix-only"],
    description: "Implements AC slices and post-review scoped fixes. Always commits per AC via commit-helper.",
    prompt: SPECIALIST_PROMPTS["slice-builder"]
  }
];

export function renderAgentMarkdown(agent: CoreAgent): string {
  const modes = agent.modes.map((mode) => `- ${mode}`).join("\n");
  return `---\nname: ${agent.id}\ntitle: ${agent.title}\nactivation: ${agent.activation}\n---\n\n# ${agent.title}\n\n${agent.description}\n\n## Modes\n\n${modes}\n\n## Prompt\n\n${agent.prompt}\n`;
}
