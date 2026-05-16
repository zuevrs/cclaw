import type { InstallableAgentId, ResearchAgentId, SpecialistId } from "../types.js";
import { LEARNINGS_RESEARCH_PROMPT } from "./research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "./research-prompts/repo-research.js";
import { SPECIALIST_PROMPTS } from "./specialist-prompts/index.js";

/**
 * `activation` controls how the orchestrator invokes the agent:
 *
 * - `on-demand` — dispatched as a sub-agent with an envelope; returns a slim
 *   summary. The classic specialist contract — and, post-v8.62, the ONLY
 *   activation used by any current specialist (v8.62 collapsed the
 *   `main-context` `design` specialist into the on-demand `architect`).
 * - `main-context` — historically the orchestrator activated the prompt
 *   as a skill it followed itself, opening a multi-turn dialog with the
 *   user in the current conversation. Used only by `design` (v8.14-v8.61)
 *   for collaborative brainstorm + scope + architecture. v8.61 removed
 *   the user-dialogue surface (always-auto, no pickers) and v8.62
 *   removed the `design` specialist entirely (absorbed into `architect`),
 *   so no current specialist activates this way. The value is preserved
 *   in the type for back-compat with any external code that pattern-
 *   matches on it.
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
    id: "triage",
    kind: "specialist",
    title: "Triage",
    activation: "on-demand",
    modes: ["heuristic", "override"],
    description:
      "v8.61 lightweight router moved to a sub-agent. Decides exactly five fields (complexity, ceremonyMode, path, runMode, mode) for every fresh `/cc <task>` (research-mode and extend-mode flows skip triage — the orchestrator's Detect hop forks before dispatch). Zero-question rule preserved verbatim from v8.58. Honours the three v8.58 override flags (--inline / --soft / --strict) and the v8.34 --mode=auto / --mode=step toggle (both now collapse to auto per v8.61 always-auto). Auto-downgrades strict to soft when .git/ is absent and stamps downgradeReason: \"no-git\". Returns a slim summary; the orchestrator persists the decision to flow-state.json.",
    prompt: SPECIALIST_PROMPTS.triage
  },
  {
    id: "architect",
    kind: "specialist",
    title: "Architect",
    activation: "on-demand",
    modes: ["task", "research"],
    description:
      "v8.62 unified plan-stage specialist. Absorbs the work that was split pre-v8.62 between `design` (Phase 0/2-6: Bootstrap, Frame, Approaches, Decisions, Pre-mortem, Compose) and `ac-author` (Plan, Spec, AC, Edge cases, Topology, Feasibility, Traceability). Runs as a single on-demand sub-agent — no mid-plan user dialogue (v8.61 always-auto removed all pickers); ambiguity is resolved silently using best judgment. Writes `plan.md` (intra-flow `mode: \"task\"`) or `research.md` (standalone `mode: \"research\"`, no AC table). Depth scales with ceremonyMode: inline skips, soft writes Plan + Spec + Testable conditions + Verification + Touch surface, strict adds Frame + Approaches + Selected Direction + Decisions + Pre-mortem + Topology + Feasibility + Traceability.",
    prompt: SPECIALIST_PROMPTS.architect
  },
  {
    id: "plan-critic",
    kind: "specialist",
    title: "Plan critic",
    activation: "on-demand",
    modes: ["pre-impl-review"],
    description:
      "pre-implementation plan-critic. Runs between architect and builder ONLY on the tight gate {ceremonyMode=strict, complexity=large-risky, problemType!=refines, AC count>=2}. Five-dimension protocol (goal coverage / granularity / dependency accuracy / parallelism feasibility / risk catalog) + §6 pre-commitment predictions before final review. Verdicts: pass (advance to builder), revise (bounce to architect once — max 1 revise loop), cancel (user picker: cancel-slug / re-architect). Read-only on the codebase; no Write/Edit/MultiEdit. Distinct from the post-impl critic (Hop 4.5); both ship together, catch different problem classes.",
    prompt: SPECIALIST_PROMPTS["plan-critic"]
  },
  {
    id: "builder",
    kind: "specialist",
    title: "Builder",
    activation: "on-demand",
    modes: ["build", "fix-only"],
    description:
      "Renamed from `slice-builder` in v8.62 (AC-as-unit-of-work semantics unchanged — slice/AC separation is v8.63 scope). Implements AC slices and post-review scoped fixes. In strict mode every commit carries a posture-driven subject-line prefix (red(AC-N): / green(AC-N): / refactor(AC-N): / test(AC-N): / docs(AC-N):) the reviewer verifies via git log --grep.",
    prompt: SPECIALIST_PROMPTS.builder
  },
  {
    id: "qa-runner",
    kind: "specialist",
    title: "QA runner",
    activation: "on-demand",
    modes: ["browser-verify"],
    description:
      "behavioural-QA specialist for UI surfaces. Runs at the qa stage (between build and review) ONLY when triage.surfaces includes ui or web AND ceremonyMode != inline. Browser tool hierarchy: Playwright MCP (Tier 1, CI-runnable) > browser-MCP (Tier 2, cursor-ide-browser / chrome-devtools / browser-use; session-bound screenshots) > manual steps (Tier 3, user confirms numbered procedure). Per-UI-AC evidence rubric, 3-5 pre-commitment predictions before verification, qa-runner-specific anti-rationalizations. Verdicts: pass (advance to review), iterate (bounce to builder once — max 1 loop), blocked (browser tools unavailable AND manual steps required; user picker). Read-only on production src; writes qa.md + optional tests/e2e/<slug>-<ac>.spec.ts + screenshots under flows/<slug>/qa-assets/. Reviewer cross-checks the artifact via the qa-evidence axis.",
    prompt: SPECIALIST_PROMPTS["qa-runner"]
  },
  {
    id: "reviewer",
    kind: "specialist",
    title: "Reviewer",
    activation: "on-demand",
    modes: ["code", "text-review", "integration", "release", "adversarial"],
    description:
      "Multi-mode reviewer covering code, plan/spec text, integration, release readiness, and adversarial sweeps. v8.62 absorbed the standalone `security-reviewer` specialist — the reviewer's `security` axis now carries the full threat-model + sensitive-change protocol (authn / authz / secrets / supply chain / data exposure). When `security_flag` is set on the dispatch envelope, the reviewer gives the security axis extra emphasis (walks every threat-model item even on small diffs).",
    prompt: SPECIALIST_PROMPTS.reviewer
  },
  {
    id: "critic",
    kind: "specialist",
    title: "Critic",
    activation: "on-demand",
    modes: ["gap", "adversarial"],
    description:
      "adversarial critic. Runs at the critic step (after reviewer, before ship). Falsificationist stance: walks what's MISSING (gap analysis + pre-commitment predictions + goal-backward verification + Criterion check + realist check). gap mode is default; adversarial mode (assumption violation / composition failures / cascade construction / abuse cases) auto-escalates on the §8 trigger set. ceremonyMode-gated: inline skip, soft gap, strict full + escalation. Writes single-shot critic.md (overwrites on re-dispatch).",
    prompt: SPECIALIST_PROMPTS.critic
  }
];

export const RESEARCH_AGENTS: ResearchAgent[] = [
  {
    id: "repo-research",
    kind: "research",
    title: "Repo research",
    activation: "on-demand",
    modes: ["scan"],
    description:
      "Read-only repo scan: stack, focus-surface patterns, test conventions, risk areas. Dispatched by the architect before authoring on brownfield (mostly during Frame / Decisions / Pre-mortem on strict mode).",
    prompt: REPO_RESEARCH_PROMPT
  },
  {
    id: "learnings-research",
    kind: "research",
    title: "Learnings research",
    activation: "on-demand",
    modes: ["scan"],
    description:
      "Read-only knowledge.jsonl scan: surface 1-3 prior shipped lessons that overlap with the current task's surface and failure modes. Dispatched by the architect before authoring.",
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
