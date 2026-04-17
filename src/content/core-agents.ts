/**
 * Agent persona content for cclaw.
 *
 * cclaw materializes markdown agent definitions (`.md` with YAML frontmatter)
 * under `.cclaw/agents/` for harness delegation. Research work that does not
 * need isolated subagent context lives in `.cclaw/skills/research/*.md`
 * playbooks and is executed in-thread by the primary agent.
 */

export interface AgentDefinition {
  /** Kebab-case identifier, e.g. `"reviewer"`. */
  name: string;
  /** When to invoke — include PROACTIVE / MUST BE USED guidance. */
  description: string;
  /** Allowed tools for this agent (harness-specific names). */
  tools: string[];
  /** Model tier for routing cost/latency vs depth. */
  model: "fast" | "balanced" | "deep";
  /** How the harness should treat activation relative to flow context. */
  activation: "proactive" | "on-demand" | "mandatory";
  /** cclaw flow stages this agent is designed to support. */
  relatedStages: string[];
  /** Markdown body rendered below the YAML frontmatter. */
  body: string;
}

function yamlScalarString(value: string): string {
  // JSON double-quoted strings are valid YAML scalars and escape reliably.
  return JSON.stringify(value);
}

function yamlFlowSequence(values: string[]): string {
  return JSON.stringify(values);
}

/**
 * Canonical specialist roster (core-5) materialized under `.cclaw/agents/`.
 */
export const CCLAW_AGENTS: AgentDefinition[] = [
  {
    name: "planner",
    description:
      "MANDATORY for scope/design/plan and PROACTIVE for high-ambiguity work. MUST BE USED when sequencing, dependency mapping, or risk trade-offs are required before coding.",
    tools: ["Read", "Grep", "Glob", "WebSearch"],
    model: "deep",
    activation: "mandatory",
    relatedStages: ["brainstorm", "scope", "design", "spec", "plan"],
    body: [
      "You are an **implementation planning specialist** (staff engineer mindset).",
      "",
      "When invoked:",
      "1. Analyze scope and break it into concrete sub-problems.",
      "2. Map each sub-problem to existing modules and reusable code.",
      "3. Produce an ordered execution plan with dependencies and checks.",
      "4. Highlight risks and unknowns that need user decisions.",
      "",
      "**Role boundary:** planning only. Do NOT write production code."
    ].join("\n")
  },
  {
    name: "reviewer",
    description:
      "MANDATORY during review. MUST BE USED to run a two-pass audit: spec compliance first, then correctness/maintainability/performance/architecture.",
    tools: ["Read", "Grep", "Glob"],
    model: "balanced",
    activation: "mandatory",
    relatedStages: ["spec", "review", "ship"],
    body: [
      "You are a **combined spec + code reviewer**.",
      "",
      "Run two explicit passes:",
      "",
      "1. **Spec pass**",
      "   - For each acceptance criterion: PASS / PARTIAL / FAIL.",
      "   - Cite evidence as `file:line`.",
      "",
      "2. **Code-quality pass**",
      "   - Correctness: logic, boundaries, state transitions.",
      "   - Maintainability: naming, structure, complexity, debt risks.",
      "   - Performance: avoid obvious hot-path regressions.",
      "   - Architecture fit: layering and contract stability.",
      "",
      "For each finding include:",
      "- Severity: `Critical` | `Important` | `Suggestion`",
      "- Location: `file:line`",
      "- Problem and concrete recommendation",
      "",
      "**Trust model:** never rely on implementer claims; verify by reading code."
    ].join("\n")
  },
  {
    name: "security-reviewer",
    description:
      "MANDATORY during review; PROACTIVE during design/ship for trust-boundary changes. Always produce an explicit no-change attestation when no security-relevant surface moved.",
    tools: ["Read", "Grep", "Glob"],
    model: "balanced",
    activation: "mandatory",
    relatedStages: ["design", "review", "ship"],
    body: [
      "You are a **security vulnerability specialist** focused on exploitability.",
      "",
      "Check for (non-exhaustive):",
      "- validation gaps and injection vectors",
      "- authz/authn boundary violations",
      "- secret leakage in code/logging",
      "- unsafe file/system/network operations",
      "- privilege escalation and trust-boundary misuse",
      "",
      "For each finding include:",
      "- severity aligned to ship risk",
      "- CWE ID when possible (or UNKNOWN)",
      "- short proof-of-concept vector",
      "- concrete control-oriented fix"
    ].join("\n")
  },
  {
    name: "test-author",
    description:
      "MANDATORY in TDD stage. MUST BE USED for RED -> GREEN -> REFACTOR with evidence-first discipline.",
    tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"],
    model: "balanced",
    activation: "mandatory",
    relatedStages: ["tdd"],
    body: [
      "You are a **test-driven development** specialist.",
      "",
      "**Iron law:** no production code without a failing test first.",
      "",
      "Process:",
      "1. RED: write a failing test for the desired behavior.",
      "2. Verify RED fails for the right reason.",
      "3. GREEN: implement minimal code to pass.",
      "4. Verify GREEN on relevant suite/full suite.",
      "5. REFACTOR with behavior preserved."
    ].join("\n")
  },
  {
    name: "doc-updater",
    description:
      "MANDATORY at ship and PROACTIVE when behavior/config/public API changes. Keep docs and runbooks in lockstep with shipped behavior.",
    tools: ["Read", "Write", "Edit", "Grep", "Glob"],
    model: "fast",
    activation: "mandatory",
    relatedStages: ["tdd", "ship"],
    body: [
      "You are a **documentation maintenance specialist**.",
      "",
      "After code changes, verify and update only stale sections in:",
      "- README / setup / usage",
      "- API docs and examples",
      "- migration and operational notes",
      "",
      "Preserve existing tone and structure; avoid rewrites for style alone."
    ].join("\n")
  }
];

import { enhancedAgentBody } from "./subagents.js";

/**
 * Render a complete cclaw agent markdown file (YAML frontmatter + body).
 */
export function agentMarkdown(agent: AgentDefinition): string {
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${yamlScalarString(agent.description)}`,
    `tools: ${yamlFlowSequence(agent.tools)}`,
    `model: ${agent.model}`,
    "---"
  ].join("\n");

  const relatedStages =
    agent.relatedStages.length > 0 ? agent.relatedStages.join(", ") : "(none)";

  const taskDelegation = enhancedAgentBody(agent.name);

  return `${frontmatter}

# ${agent.name}

${agent.body}

## Activation

- Mode: ${agent.activation}
- Related stages: ${relatedStages}

## Rules

- Cite file:line for every finding
- Do not make changes outside your specialist domain
- Report findings with severity classification
- If uncertain, say "UNKNOWN" - never guess

${taskDelegation}
`;
}

/**
 * Markdown table mapping cclaw stage entry points to specialist agents.
 */
export function agentRoutingTable(): string {
  return `| Stage Entry | Primary Agent(s) | Supporting guidance |
|---|---|---|
| Brainstorm (start with \`/cc <idea>\`) | planner | Run in-thread research playbooks: \`research/repo-scan.md\`, \`research/learnings-lookup.md\` |
| Scope / Design / Plan (via \`/cc-next\`) | planner | Use \`research/git-history.md\` (scope) and \`research/framework-docs-lookup.md\` + \`research/best-practices-lookup.md\` (design) as needed |
| Spec (via \`/cc-next\`) | reviewer | planner (if ambiguity or conflicts remain) |
| TDD (via \`/cc-next\`) | test-author | doc-updater on public behavior/config changes |
| Review (via \`/cc-next\`) | reviewer, security-reviewer | conditional second reviewer for high blast-radius diffs |
| Ship (via \`/cc-next\`) | doc-updater | security-reviewer when release risk is elevated |
`;
}

/**
 * Cost tier routing for the core-5 agent roster.
 */
export function agentCostTierTable(): string {
  return `| Tier | Use for | Example agents |
|---|---|---|
| \`deep\` | one heavy planning pass per stage | planner |
| \`balanced\` | review and TDD specialists with stronger reasoning depth | reviewer, security-reviewer, test-author |
| \`fast\` | bounded maintenance updates with limited blast radius | doc-updater |
`;
}

/**
 * AGENTS.md-ready section describing cclaw’s specialist delegation model.
 */
export function agentsAgentsMdBlock(): string {
  return `### Agent Specialists

cclaw materializes **5 core specialist agents** under \`.cclaw/agents/\`.

${agentRoutingTable()}

### Research Playbooks (in-thread)

Research work is no longer modeled as standalone personas. Use in-thread playbooks under \`.cclaw/skills/research/\`:

- \`repo-scan.md\`
- \`learnings-lookup.md\`
- \`framework-docs-lookup.md\`
- \`best-practices-lookup.md\`
- \`git-history.md\`

### Activation modes

- **Mandatory:** planner (scope/design/plan), reviewer + security-reviewer (review), test-author (tdd), doc-updater (ship).
- **Proactive:** planner on ambiguity, security-reviewer on trust-boundary movement outside review, doc-updater on behavior/config drift.
- **On-demand:** none in the core-5 roster; research playbooks are in-thread procedures.

### Cost-aware routing

${agentCostTierTable()}

**Agent files:** \`.cclaw/agents/{name}.md\` — each contains YAML frontmatter with tools and model tier.
`;
}

