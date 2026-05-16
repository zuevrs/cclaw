import { DESIGN_PROMPT } from "./design.js";
import { AC_AUTHOR_PROMPT } from "./ac-author.js";
import { REVIEWER_PROMPT } from "./reviewer.js";
import { SECURITY_REVIEWER_PROMPT } from "./security-reviewer.js";
import { CRITIC_PROMPT } from "./critic.js";
import { PLAN_CRITIC_PROMPT } from "./plan-critic.js";
import { QA_RUNNER_PROMPT } from "./qa-runner.js";
import { SLICE_BUILDER_PROMPT } from "./slice-builder.js";
import { TRIAGE_PROMPT } from "./triage.js";
import { LEARNINGS_RESEARCH_PROMPT } from "../research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "../research-prompts/repo-research.js";
import type { SpecialistId } from "../../types.js";

export const SPECIALIST_PROMPTS: Record<SpecialistId, string> = {
  design: DESIGN_PROMPT,
  "ac-author": AC_AUTHOR_PROMPT,
  reviewer: REVIEWER_PROMPT,
  "security-reviewer": SECURITY_REVIEWER_PROMPT,
  critic: CRITIC_PROMPT,
  "plan-critic": PLAN_CRITIC_PROMPT,
  "qa-runner": QA_RUNNER_PROMPT,
  "slice-builder": SLICE_BUILDER_PROMPT,
  triage: TRIAGE_PROMPT
};

export {
  DESIGN_PROMPT,
  AC_AUTHOR_PROMPT,
  REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  CRITIC_PROMPT,
  PLAN_CRITIC_PROMPT,
  QA_RUNNER_PROMPT,
  SLICE_BUILDER_PROMPT,
  TRIAGE_PROMPT
};

export const RESEARCH_PROMPTS = [
  { id: "learnings-research", body: LEARNINGS_RESEARCH_PROMPT },
  { id: "repo-research", body: REPO_RESEARCH_PROMPT }
] as const;
