import { ARCHITECT_PROMPT } from "./architect.js";
import { BRAINSTORMER_PROMPT } from "./brainstormer.js";
import { PLANNER_PROMPT } from "./planner.js";
import { REVIEWER_PROMPT } from "./reviewer.js";
import { SECURITY_REVIEWER_PROMPT } from "./security-reviewer.js";
import { SLICE_BUILDER_PROMPT } from "./slice-builder.js";
import type { SpecialistId } from "../../types.js";

export const SPECIALIST_PROMPTS: Record<SpecialistId, string> = {
  brainstormer: BRAINSTORMER_PROMPT,
  architect: ARCHITECT_PROMPT,
  planner: PLANNER_PROMPT,
  reviewer: REVIEWER_PROMPT,
  "security-reviewer": SECURITY_REVIEWER_PROMPT,
  "slice-builder": SLICE_BUILDER_PROMPT
};
