import { DESIGN_PROMPT } from "./design.js";
import { PLANNER_PROMPT } from "./planner.js";
import { REVIEWER_PROMPT } from "./reviewer.js";
import { SECURITY_REVIEWER_PROMPT } from "./security-reviewer.js";
import { SLICE_BUILDER_PROMPT } from "./slice-builder.js";
import { LEARNINGS_RESEARCH_PROMPT } from "../research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "../research-prompts/repo-research.js";
import type { SpecialistId } from "../../types.js";

export const SPECIALIST_PROMPTS: Record<SpecialistId, string> = {
  design: DESIGN_PROMPT,
  planner: PLANNER_PROMPT,
  reviewer: REVIEWER_PROMPT,
  "security-reviewer": SECURITY_REVIEWER_PROMPT,
  "slice-builder": SLICE_BUILDER_PROMPT
};

export {
  DESIGN_PROMPT,
  PLANNER_PROMPT,
  REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  SLICE_BUILDER_PROMPT
};

export const RESEARCH_PROMPTS = [
  { id: "learnings-research", body: LEARNINGS_RESEARCH_PROMPT },
  { id: "repo-research", body: REPO_RESEARCH_PROMPT }
] as const;
