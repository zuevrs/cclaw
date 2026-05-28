import type {
  InstallableAgentId,
  ResearchAgentId,
  ResearchLensId,
  SpecialistId
} from "../types.js";
import { LEARNINGS_RESEARCH_PROMPT } from "./research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "./research-prompts/repo-research.js";
import {
  RESEARCH_LENS_DESCRIPTIONS,
  RESEARCH_LENS_PROMPTS,
  RESEARCH_LENS_TITLES
} from "./research-lenses/index.js";
import { SPECIALIST_PROMPTS } from "./specialist-prompts/index.js";
import { RESEARCH_LENSES } from "../types.js";

/**
 * `activation` controls how the orchestrator invokes the agent:
 *
 * - `on-demand` — dispatched as a sub-agent with an envelope; returns a slim
 *   summary. The classic specialist contract — and the ONLY
 *   activation used by any current specialist (collapsed the
 *   `main-context` `design` specialist into the on-demand `architect`).
 * - `main-context` — historically the orchestrator activated the prompt
 *   as a skill it followed itself, opening a multi-turn dialog with the
 *   user in the current conversation. Used only by the former `design`
 *   specialist for collaborative brainstorm + scope + architecture. The
 *   user-dialogue surface was later removed (always-auto, no pickers) and
 *   the `design` specialist was absorbed into `architect`, so no current
 *   specialist activates this way. The value is preserved
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

/**
 * Research-only sub-agent metadata. Dispatched in parallel by
 * the research orchestrator (main-context flow that powers `/cc research
 * <topic>`). Installed to `.cclaw/lib/research-lenses/<id>.md` (separate
 * from `.cclaw/lib/agents/`, which is reserved for flow specialists and
 * the two read-only research helpers `repo-research` /
 * `learnings-research`).
 *
 * The kind discriminator is `"research-lens"` so the install layer
 * (`writeAgentFiles`, harness asset writers) can write lenses to their
 * dedicated subdir without polluting the agents/ namespace.
 */
export interface ResearchLensAgent {
  id: ResearchLensId;
  kind: "research-lens";
  title: string;
  activation: "on-demand";
  description: string;
  prompt: string;
}

export const SPECIALIST_AGENTS: SpecialistAgent[] = [
  {
    id: "triage",
    kind: "specialist",
    title: "Triage",
    activation: "on-demand",
    modes: ["heuristic", "override"],
    description:
      "Lightweight router that runs as a sub-agent. Decides exactly five fields (complexity, ceremonyMode, path, runMode, mode) for every fresh `/cc <task>` (research-mode and extend-mode flows skip triage — the orchestrator's Detect hop forks before dispatch). Zero-question rule preserved. There are no per-flow ceremony override flags or back-compat run-mode toggles; the heuristic is the sole source of truth at this hop. Auto-downgrades strict to soft when .git/ is absent and stamps downgradeReason: \"no-git\". Returns a slim summary; the orchestrator persists the decision to flow-state.json.",
    prompt: SPECIALIST_PROMPTS.triage
  },
  {
    id: "investigator",
    kind: "specialist",
    title: "Investigator",
    activation: "on-demand",
    modes: ["debug"],
    description:
      "Debug-branch specialist. Runs read-only diagnostic before architect on bug-shaped flows (triage.taskShape == \"debug\"). Dispatches three parallel hypothesis lanes (cause-code / cause-config / cause-measurement) — each lane returns hypothesis + evidence (file:line refs / log excerpts / command output) + confidence 0-10 + recommended next probe. Synthesises a working root-cause hypothesis and emits a next-step recommendation (direct-fix → builder skip-architect; needs-plan → architect with priorInvestigation; more-investigation → re-dispatch investigator with sharper probe; not-a-bug → reframe to user). Writes investigation.md. No code edits, no plan writing, no commits — strictly read-only. Capped at 2 investigator dispatches per slug (second more-investigation triggers stop-and-report).",
    prompt: SPECIALIST_PROMPTS.investigator
  },
  {
    id: "architect",
    kind: "specialist",
    title: "Architect",
    activation: "on-demand",
    modes: ["task"],
    description:
      "Unified plan-stage specialist, scoped to intra-flow plan authoring only. Absorbs the work formerly split between `design` (Phase 0/2-6: Bootstrap, Frame, Approaches, Decisions, Pre-mortem, Compose) and `ac-author` (Plan, Spec, AC, Edge cases, Topology, Feasibility, Traceability). Runs as a single on-demand sub-agent — no mid-plan user dialogue (always-auto removed all pickers); ambiguity is resolved silently using best judgment. Writes `plan.md` (intra-flow `mode: \"task\"`). Depth scales with ceremonyMode: inline skips, soft writes Plan + Spec + Testable conditions + Verification + Touch surface, strict adds Frame + Approaches + Selected Direction + Decisions + Pre-mortem + Topology + Feasibility + Traceability. Research mode (`/cc research <topic>`) is handled by the main-context multi-lens research orchestrator (six parallel lenses: engineer / product / architecture / history / skeptic / design) — the architect is no longer dispatched for research.",
    prompt: SPECIALIST_PROMPTS.architect
  },
  {
    id: "plan-critic",
    kind: "specialist",
    title: "Plan critic",
    activation: "on-demand",
    modes: ["pre-impl-review"],
    description:
      "pre-implementation plan-critic. Unifies three pre-impl lenses (plan-critic / plan-design / plan-devex) into a single specialist with a `rubricMode: \"generic\" | \"design\" | \"devex\"` envelope fan-out. Three rubric modes share one prompt body: (1) `generic` (default) — adversarial structural pass on the tight gate {ceremonyMode=strict, complexity!=trivial, problemType!=refines, AC count>=2}: goal coverage / granularity / dependency accuracy / parallelism feasibility / risk catalog + decision-integrity + bets-and-exclusions; (2) `design` — walks plan.md against the seven-dimension design-quality rubric (visual hierarchy / type system / color / spacing / interaction affordances / accessibility WCAG AA / responsive) on the design-surface gate {triage.designSurface OR triage.surfaces ∩ {ui, design, frontend, ux}; ceremonyMode ∈ {soft, strict}}, emits PD-N findings appended to plan.md's ## Plan-design findings; (3) `devex` — walks the six-dimension DevEx rubric (Getting Started / API ergonomics / Error messages / Docs / Upgrade path / Measurement) on the devex-surface gate {triage.devexSurface OR triage.surfaces ∩ {cli, library, api}; ceremonyMode ∈ {soft, strict}}, emits DX-N findings appended to plan.md's ## Plan-devex findings. Orchestrator may dispatch up to three times sequentially per slug (generic first, then design, then devex; each independently gated). Verdicts: pass (advance), revise (bounce to architect once — max 1 revise loop per mode), cancel (generic mode only; structural plan defect) or block (design / devex modes; stop-and-report). Read-only on the codebase; no Write/Edit/MultiEdit. Distinct from the post-impl critic (Hop 4.5); both ship together, catch different problem classes.",
    prompt: SPECIALIST_PROMPTS["plan-critic"]
  },
  {
    id: "builder",
    kind: "specialist",
    title: "Builder",
    activation: "on-demand",
    modes: ["build", "fix-only"],
    description:
      "Renamed from `slice-builder` (AC-as-unit-of-work semantics unchanged). Implements AC slices and post-review scoped fixes. In strict mode every per-slice work commit carries the posture-driven subject-line prefix (red(SL-N): / green(SL-N): / refactor(SL-N):) the reviewer verifies via git log --grep; after slices land the builder writes one verify(AC-N): passing commit per AC (empty diff when slice tests already cover the AC; test-files-only diff when the AC needs broader verification — perf budget, integration, contract).",
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
      "Multi-mode reviewer covering code, plan/spec text, integration, release readiness, and adversarial sweeps. Absorbed the standalone `security-reviewer` specialist — the reviewer's `security` axis now carries the full threat-model + sensitive-change protocol (authn / authz / secrets / supply chain / data exposure). When `security_flag` is set on the dispatch envelope, the reviewer gives the security axis extra emphasis (walks every threat-model item even on small diffs).",
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
 *
 * Research lenses are intentionally NOT included here — they
 * install to a separate `.cclaw/lib/research-lenses/` subdirectory via
 * {@link RESEARCH_LENS_AGENTS}. Lenses are not flow specialists; mixing
 * them into `CORE_AGENTS` would pollute the agents/ namespace and risk
 * the install layer treating them as flow specialists.
 */
export const CORE_AGENTS: CoreAgent[] = [...SPECIALIST_AGENTS, ...RESEARCH_AGENTS];

/**
 * Research lenses install to `.cclaw/lib/research-lenses/`.
 * Build the array from {@link RESEARCH_LENSES} so the source of truth
 * for the lens roster is `src/types.ts`; lens metadata (title +
 * description) lives in `src/content/research-lenses/index.ts`.
 */
export const RESEARCH_LENS_AGENTS: ResearchLensAgent[] = RESEARCH_LENSES.map(
  (id) => ({
    id,
    kind: "research-lens" as const,
    title: RESEARCH_LENS_TITLES[id],
    activation: "on-demand" as const,
    description: RESEARCH_LENS_DESCRIPTIONS[id],
    prompt: RESEARCH_LENS_PROMPTS[id]
  })
);

export function renderAgentMarkdown(agent: CoreAgent): string {
  const modes = agent.modes.map((mode) => `- ${mode}`).join("\n");
  const kindLine = agent.kind === "research" ? "kind: research-helper\n" : "";
  return `---\nname: ${agent.id}\ntitle: ${agent.title}\nactivation: ${agent.activation}\n${kindLine}---\n\n# ${agent.title}\n\n${agent.description}\n\n## Modes\n\n${modes}\n\n## Prompt\n\n${agent.prompt}\n`;
}

/**
 * Renders a research-lens contract. Lenses install to
 * `.cclaw/lib/research-lenses/<id>.md` with a `kind: research-lens`
 * frontmatter field so harness UIs / readers can distinguish them from
 * flow specialists (`.cclaw/lib/agents/`) and from the read-only
 * research helpers `repo-research` / `learnings-research` (also in
 * `.cclaw/lib/agents/`, marked `kind: research-helper`).
 */
export function renderResearchLensMarkdown(agent: ResearchLensAgent): string {
  return `---\nname: ${agent.id}\ntitle: ${agent.title}\nactivation: ${agent.activation}\nkind: research-lens\n---\n\n# ${agent.title}\n\n${agent.description}\n\n## Prompt\n\n${agent.prompt}\n`;
}
