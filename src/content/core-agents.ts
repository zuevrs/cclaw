import type { InstallableAgentId, ResearchAgentId, SpecialistId } from "../types.js";
import { LEARNINGS_RESEARCH_PROMPT } from "./research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "./research-prompts/repo-research.js";
import { SPECIALIST_PROMPTS } from "./specialist-prompts/index.js";

/**
 * `activation` controls how the orchestrator invokes the agent:
 *
 * - `on-demand` — dispatched as a sub-agent with an envelope; returns a slim
 *   summary. The classic specialist contract.
 * - `main-context` — the orchestrator activates the prompt as a skill it
 *   follows itself, opening a multi-turn dialog with the user in the current
 *   conversation. Used only by `design` (v8.14+) so brainstorm + scope +
 *   architecture can run as one collaborative pass instead of two one-shot
 *   dispatches. Main-context agents still own a slot in `flow-state.json` and
 *   appear in `lastSpecialist` after sign-off.
 */
export type AgentActivation = "on-demand" | "main-context";

export interface CoreAgent {
  id: InstallableAgentId;
  kind: "specialist" | "research";
  title: string;
  activation: AgentActivation;
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
    id: "design",
    kind: "specialist",
    title: "Design",
    activation: "main-context",
    modes: ["guided", "deep"],
    description:
      "Multi-turn collaborative design: clarify, frame, approaches, decisions inline, optional pre-mortem, sign-off. Runs in the main orchestrator context, not as a one-shot sub-agent. Replaces brainstormer + architect from pre-v8.14.",
    prompt: SPECIALIST_PROMPTS.design
  },
  {
    id: "ac-author",
    kind: "specialist",
    title: "AC author",
    activation: "on-demand",
    modes: ["research", "work-breakdown", "topology"],
    description: "Targeted research, work breakdown into AC, execution topology recommendation.",
    prompt: SPECIALIST_PROMPTS["ac-author"]
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
    id: "critic",
    kind: "specialist",
    title: "Critic",
    activation: "on-demand",
    modes: ["gap", "adversarial"],
    description:
      "v8.42 adversarial critic. Runs at the critic step (after reviewer, before ship). Falsificationist stance: walks what's MISSING (gap analysis + pre-commitment predictions + goal-backward verification + AC self-audit + realist check). gap mode is default; adversarial mode (assumption violation / composition failures / cascade construction / abuse cases) auto-escalates on the §8 trigger set. acMode-gated: inline skip, soft gap, strict full + escalation. Writes single-shot critic.md (overwrites on re-dispatch).",
    prompt: SPECIALIST_PROMPTS.critic
  },
  {
    id: "slice-builder",
    kind: "specialist",
    title: "Slice builder",
    activation: "on-demand",
    modes: ["build", "fix-only"],
    description: "Implements AC slices and post-review scoped fixes. In strict mode every commit carries a posture-driven subject-line prefix (red(AC-N): / green(AC-N): / refactor(AC-N): / test(AC-N): / docs(AC-N):) the reviewer verifies via git log --grep.",
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
    description: "Read-only repo scan: stack, focus-surface patterns, test conventions, risk areas. Dispatched by ac-author or by the design phase (mostly on `deep` posture) before authoring on brownfield.",
    prompt: REPO_RESEARCH_PROMPT
  },
  {
    id: "learnings-research",
    kind: "research",
    title: "Learnings research",
    activation: "on-demand",
    modes: ["scan"],
    description: "Read-only knowledge.jsonl scan: surface 1-3 prior shipped lessons that overlap with the current task's surface and failure modes. Dispatched by ac-author before authoring.",
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
