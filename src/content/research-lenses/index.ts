import { RESEARCH_ENGINEER_PROMPT } from "./research-engineer.js";
import { RESEARCH_PRODUCT_PROMPT } from "./research-product.js";
import { RESEARCH_ARCHITECTURE_PROMPT } from "./research-architecture.js";
import { RESEARCH_HISTORY_PROMPT } from "./research-history.js";
import { RESEARCH_SKEPTIC_PROMPT } from "./research-skeptic.js";
import type { ResearchLensId } from "../../types.js";

/**
 * Research-only sub-agent prompts. Dispatched in parallel by the
 * research orchestrator (main-context flow that powers `/cc research
 * <topic>`) after the open-ended discovery dialogue completes. The
 * orchestrator pastes each lens's findings block verbatim into the
 * corresponding `## <Lens> lens` section of `research.md`, then runs a
 * cross-lens synthesis pass to author the `## Synthesis` and `##
 * Recommended next step` sections.
 *
 * Lenses are independent: no lens cites another lens, no lens chains
 * into another lens. They live in `RESEARCH_LENSES` (in `src/types.ts`),
 * which is intentionally NOT exposed under `SPECIALISTS`.
 */
export const RESEARCH_LENS_PROMPTS: Record<ResearchLensId, string> = {
  "research-engineer": RESEARCH_ENGINEER_PROMPT,
  "research-product": RESEARCH_PRODUCT_PROMPT,
  "research-architecture": RESEARCH_ARCHITECTURE_PROMPT,
  "research-history": RESEARCH_HISTORY_PROMPT,
  "research-skeptic": RESEARCH_SKEPTIC_PROMPT
};

/**
 * Display titles for each lens. Used by the install layer (when rendering
 * the lens markdown contracts under `.cclaw/lib/research-lenses/`) and by
 * any harness UI that surfaces the lens roster.
 */
export const RESEARCH_LENS_TITLES: Record<ResearchLensId, string> = {
  "research-engineer": "Research — Engineer lens",
  "research-product": "Research — Product lens",
  "research-architecture": "Research — Architecture lens",
  "research-history": "Research — History lens",
  "research-skeptic": "Research — Skeptic lens"
};

/**
 * One-line descriptions surfaced in the install summary, the research
 * orchestrator's dispatch announcement, and the README's "What you get"
 * block.
 */
export const RESEARCH_LENS_DESCRIPTIONS: Record<ResearchLensId, string> = {
  "research-engineer":
    "Technical feasibility lens — stack fit, implementation paths (2-3 candidates), blockers, risks during implementation, rough effort. May dispatch `repo-research` for brownfield context; may use a web-search MCP tool when available.",
  "research-product":
    "User / product value lens — who benefits (primary + secondary actors), alternatives considered (always including \"do nothing\"), market / domain context, open product questions. May use a web-search MCP tool when available.",
  "research-architecture":
    "System-fit lens — surface impact (per-module severity), coupling points, boundaries crossed, scalability considerations, reusable in-repo patterns. May dispatch `repo-research` on brownfield architecture topics.",
  "research-history":
    "Memory lens — prior attempts via `.cclaw/knowledge.jsonl` (cclaw's append-only ship log) + git log; outcome signals (reverted / manual-fix / follow-up-bug counts); lessons learned; directional drift. Read-only on the project's memory.",
  "research-skeptic":
    "Adversarial lens — failure modes (likelihood × impact); edge cases (accidental); abuse cases (intentional); hidden costs (post-ship); explicit don't-proceed triggers when severity is irreversible. May use a web-search MCP tool when available."
};

export {
  RESEARCH_ENGINEER_PROMPT,
  RESEARCH_PRODUCT_PROMPT,
  RESEARCH_ARCHITECTURE_PROMPT,
  RESEARCH_HISTORY_PROMPT,
  RESEARCH_SKEPTIC_PROMPT
};
