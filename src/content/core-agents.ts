import { conversationLanguagePolicyBullets, conversationLanguagePolicyMarkdown } from "./language-policy.js";
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

function formattedAgentsForStages(stages: FlowStage[]): string {
  const summary = stageDelegationSummary("standard");
  const merged: string[] = [];
  for (const stage of stages) {
    const row = summary.find((item) => item.stage === stage);
    if (!row) continue;
    for (const agent of row.primaryAgents) {
      if (!merged.includes(agent)) {
        merged.push(agent);
      }
    }
  }
  return merged.length > 0 ? merged.join(", ") : "none";
}

function activationModeSummary(): {
  mandatory: string;
  proactive: string;
} {
  const summary = stageDelegationSummary("standard");
  const mandatory = new Set<string>();
  const proactive = new Set<string>();
  for (const row of summary) {
    for (const agent of row.mandatoryAgents) {
      mandatory.add(agent);
    }
    for (const agent of row.proactiveAgents) {
      proactive.add(agent);
    }
  }
  return {
    mandatory: [...mandatory].join(", "),
    proactive: [...proactive].join(", ")
  };
}

/**
 * Canonical specialist roster materialized under `.cclaw/agents/`.
 *
 * Declared with `satisfies` so the array retains literal `name` types for
 * downstream type-level consumers (e.g. `AgentName`), while still being
 * checked against the `AgentDefinition` shape at compile time. Do not add
 * an explicit `AgentDefinition[]` annotation here — it would widen `name`
 * to `string` and break the compile-time drift guard.
 */
export const CCLAW_AGENTS = [
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
      "1. Map upstream decisions, scope boundaries, and explicit drift before planning.",
      "2. Break the work into concrete sub-problems with dependencies and existing-module fit.",
      "3. Enforce one-question discipline: ask only decision-changing questions, one at a time.",
      "4. Produce an ordered execution plan with verification checks and handoff quality notes.",
      "5. Highlight risks and unknowns that need user decisions.",
      "",
      "**Role boundary:** planning only. Do NOT write production code."
    ].join("\n")
  },
  {
    name: "product-manager",
    description:
      "PROACTIVE during brainstorm/scope when product value, persona/JTBD, success metric, or why-now framing is unclear. Use for product discovery, not implementation.",
    tools: ["Read", "Grep", "Glob", "WebSearch"],
    model: "balanced",
    activation: "proactive",
    relatedStages: ["brainstorm", "scope"],
    body: [
      "You are a **product discovery specialist**.",
      "",
      "Produce concise evidence for:",
      "- persona / user and job to be done",
      "- pain or trigger",
      "- value hypothesis and success metric",
      "- evidence or signal strength",
      "- why now, do-nothing consequence, and non-goals",
      "",
      "For technical-maintenance work, translate this to operator/developer, failure mode, operational improvement, verification signal, do-nothing cost, and non-goals.",
      "",
      "**Role boundary:** frame value and problem fit. Do NOT choose implementation architecture."
    ].join("\n")
  },
  {
    name: "critic",
    description:
      "PROACTIVE during brainstorm/scope/design when premises, alternatives, cost, rollback, or hidden assumptions need adversarial pressure.",
    tools: ["Read", "Grep", "Glob", "WebSearch"],
    model: "balanced",
    activation: "proactive",
    relatedStages: ["brainstorm", "scope", "design"],
    body: [
      "You are an **adversarial critic** for product and engineering decisions.",
      "",
      "Your job:",
      "1. Attack the premise and name what could make the current direction wrong.",
      "2. Identify cheaper, smaller, or more reversible alternatives.",
      "3. Surface hidden assumptions, do-nothing viability, and scope creep.",
      "4. In design, require a shadow alternative, switch trigger, failure/rescue path, and verification evidence.",
      "",
      "Return confirmed risks, disproven concerns, and the smallest decision-changing recommendation."
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
      "- Location: `file:line`; if no line is possible, state the no-line reason",
      "- Problem and concrete recommendation",
      "",
      "Also report files inspected, changed-file coverage, diagnostics run, dependency/version audit when relevant, and a no-finding attestation when no issues are found.",
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
      "- concrete control-oriented fix",
      "- `NO_CHANGE_ATTESTATION` or `NO_SECURITY_IMPACT` with inspected surfaces when no security finding exists"
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
      "**Iron law:** no production code without a failing test first during RED. In design, focus on testability and verification evidence without editing production code.",
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
      "MANDATORY only at ship; PROACTIVE during tdd/review whenever behavior, config, or public API changes. Keep docs and runbooks in lockstep with shipped behavior.",
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
      "- migration, rollout, rollback, and operational notes",
      "- public-surface change notes tied to actual changed files",
      "",
      "Preserve existing tone and structure; avoid rewrites for style alone."
    ].join("\n")
  }
] as const satisfies readonly AgentDefinition[];

/**
 * Union of known agent names (compile-time). Use this in content that
 * references agents by name so the TypeScript compiler catches renames
 * and typos instead of letting them slip into generated artifacts.
 */
export type AgentName = (typeof CCLAW_AGENTS)[number]["name"];

import type { FlowStage } from "../types.js";
import { stageDelegationSummary } from "./stage-schema.js";
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

## Conversation Language Policy

${conversationLanguagePolicyBullets()}
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
  const brainstormPrimary = formattedAgentsForStages(["brainstorm"]);
  const scopeDesignPlanPrimary = formattedAgentsForStages(["scope", "design", "plan"]);
  const specPrimary = formattedAgentsForStages(["spec"]);
  const tddPrimary = formattedAgentsForStages(["tdd"]);
  const reviewPrimary = formattedAgentsForStages(["review"]);
  const shipPrimary = formattedAgentsForStages(["ship"]);

  return `| Stage Entry | Primary Agent(s) | Supporting guidance |
|---|---|---|
| Brainstorm (start with \`/cc <idea>\`) | ${brainstormPrimary} | Run in-thread research playbooks: \`research/repo-scan.md\`, \`research/learnings-lookup.md\` |
| Scope / Design / Plan (via \`/cc-next\`) | ${scopeDesignPlanPrimary} | Use \`research/git-history.md\` (scope) and \`research/framework-docs-lookup.md\` + \`research/best-practices-lookup.md\` (design) as needed |
| Spec (via \`/cc-next\`) | ${specPrimary} | planner (if ambiguity or conflicts remain) |
| TDD (via \`/cc-next\`) | ${tddPrimary} | doc-updater on public behavior/config changes |
| Review (via \`/cc-next\`) | ${reviewPrimary} | conditional second reviewer for high blast-radius diffs |
| Ship (via \`/cc-next\`) | ${shipPrimary} | security-reviewer when release risk is elevated |
`;
}

/**
 * Cost tier routing for the specialist agent roster.
 */
export function agentCostTierTable(): string {
  return `| Tier | Use for | Example agents |
|---|---|---|
| \`deep\` | one heavy planning pass per stage | planner |
| \`balanced\` | discovery, criticism, review, and TDD specialists with stronger reasoning depth | product-manager, critic, reviewer, security-reviewer, test-author |
| \`fast\` | bounded maintenance updates with limited blast radius | doc-updater |
`;
}

/**
 * AGENTS.md-ready section describing cclaw’s specialist delegation model.
 */
export function agentsAgentsMdBlock(): string {
  return `### Agent Specialists

cclaw materializes specialist agents under \`.cclaw/agents/\`, including planner, product-manager, critic, reviewer, security-reviewer, test-author, and doc-updater.

${agentRoutingTable()}

### Research Playbooks (in-thread)

Research work is no longer modeled as standalone personas. Use in-thread playbooks under \`.cclaw/skills/research/\`:

- \`repo-scan.md\`
- \`learnings-lookup.md\`
- \`framework-docs-lookup.md\`
- \`best-practices-lookup.md\`
- \`git-history.md\`

### Activation modes

${(() => {
  const mode = activationModeSummary();
  return `- **Mandatory:** ${mode.mandatory}.
- **Proactive:** ${mode.proactive}.
- **On-demand:** none in the specialist roster; research playbooks are in-thread procedures.`;
})()}

### Cost-aware routing

${agentCostTierTable()}

**Agent files:** \`.cclaw/agents/{name}.md\` — each contains YAML frontmatter with tools and model tier.
`;
}

