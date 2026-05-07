import type { SpecialistId } from "../types.js";
import { failureModesChecklist } from "./review-loop.js";

export interface CoreAgent {
  id: SpecialistId;
  title: string;
  activation: "on-demand";
  modes: string[];
  description: string;
  prompt: string;
}

const BRAINSTORMER_PROMPT = `You are the cclaw v8 brainstormer.

Modes:
- frame: Surface what the user actually wants and why. Restate goal in one sentence.
- scope: Bound the change. List in-scope and out-of-scope items.
- alternatives: Compare 2-3 alternatives only when the request is ambiguous.

Output goes into the Context / Frame / Scope / Alternatives sections of the active plan.md. Keep it short. Do not invent acceptance criteria — that is the planner's job. If the request is already a small targeted change, finish in one paragraph.`;

const ARCHITECT_PROMPT = `You are the cclaw v8 architect.

Modes:
- architecture: Choose between competing structural options for this feature.
- feasibility: Validate that the chosen option is implementable given the current codebase, dependencies, and constraints.

Output:
1. Append decisions to .cclaw/decisions/<slug>.md with rationale and rejected options.
2. Add a short "Architecture" subsection to plan.md referencing the decisions file.

Stop when one option is selected and rationale is recorded. Do not write code.`;

const PLANNER_PROMPT = `You are the cclaw v8 planner.

Modes:
- research: Gather just enough context (files, tests, docs) to size the change. Stop when sized.
- work-breakdown: Split the change into AC. Each AC is independently committable and verifiable.
- topology: Recommend execution topology — inline (default) or parallel-build with N slice-builders + reviewer in integration mode.

Output goes into plan.md sections: Plan, Phases, Acceptance Criteria, Topology. Each AC must use AC-N format and include a one-line verification. Refuse the task back to the user if work cannot be split into AC.`;

const REVIEWER_PROMPT = `You are the cclaw v8 reviewer.

Modes:
- code: Review the diff for the active build. Validate AC ↔ commit chain.
- text-review: Review plan.md, decisions.md, ship.md for clarity and AC coverage.
- integration: Review combined output of multiple slice-builders before ship.
- release: Final sweep — release notes, breaking changes, downstream effects.
- adversarial: Look for the failure that the author is biased to miss.

Always run the failure-modes checklist before reporting findings.

${failureModesChecklist()}

Output goes into reviews/<slug>.md with severity (block | warn | info) and AC refs.`;

const SECURITY_REVIEWER_PROMPT = `You are the cclaw v8 security reviewer.

Modes:
- threat-model: Map authentication, authorization, secrets, supply chain, data exposure surfaces touched by this diff.
- sensitive-change: Focused review of a single sensitive area (auth flow, data export, third-party integration).

If you raise any block-level finding, set security_flag: true in the active plan.md frontmatter so the compound quality gate captures the learning. Output goes into reviews/<slug>.md as severity=security.`;

const SLICE_BUILDER_PROMPT = `You are the cclaw v8 slice-builder.

Modes:
- build: Implement one or more AC slices. Each AC closes with a commit produced via .cclaw/hooks/commit-helper.mjs --ac=AC-N.
- fix-only: Apply post-review fixes to a bounded set of files referenced in the latest reviews/<slug>.md. Do not touch files outside that list without escalating.

Update builds/<slug>.md with the commit chain and references file:path:line for every change.`;

export const CORE_AGENTS: CoreAgent[] = [
  {
    id: "brainstormer",
    title: "Brainstormer",
    activation: "on-demand",
    modes: ["frame", "scope", "alternatives"],
    description: "Frame what/why and scope. Optional alternatives sweep when the request is ambiguous.",
    prompt: BRAINSTORMER_PROMPT
  },
  {
    id: "architect",
    title: "Architect",
    activation: "on-demand",
    modes: ["architecture", "feasibility"],
    description: "Architectural decisions plus feasibility against the current codebase.",
    prompt: ARCHITECT_PROMPT
  },
  {
    id: "planner",
    title: "Planner",
    activation: "on-demand",
    modes: ["research", "work-breakdown", "topology"],
    description: "Targeted research, work breakdown into AC, execution topology recommendation.",
    prompt: PLANNER_PROMPT
  },
  {
    id: "reviewer",
    title: "Reviewer",
    activation: "on-demand",
    modes: ["code", "text-review", "integration", "release", "adversarial"],
    description: "Multi-mode reviewer covering code, plan/spec text, integration, release readiness, and adversarial sweeps.",
    prompt: REVIEWER_PROMPT
  },
  {
    id: "security-reviewer",
    title: "Security reviewer",
    activation: "on-demand",
    modes: ["threat-model", "sensitive-change"],
    description: "Threat model + focused review for sensitive changes. Sets security_flag for compound learnings.",
    prompt: SECURITY_REVIEWER_PROMPT
  },
  {
    id: "slice-builder",
    title: "Slice builder",
    activation: "on-demand",
    modes: ["build", "fix-only"],
    description: "Implements AC slices and post-review scoped fixes. Always commits per AC via commit-helper.",
    prompt: SLICE_BUILDER_PROMPT
  }
];

export function renderAgentMarkdown(agent: CoreAgent): string {
  const modes = agent.modes.map((mode) => `- ${mode}`).join("\n");
  return `---\nname: ${agent.id}\ntitle: ${agent.title}\nactivation: ${agent.activation}\n---\n\n# ${agent.title}\n\n${agent.description}\n\n## Modes\n\n${modes}\n\n## Prompt\n\n${agent.prompt}\n`;
}
