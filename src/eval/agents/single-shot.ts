/**
 * Tier A single-shot agent.
 *
 * Simplest realistic AUT: one LLM call with the stage's SKILL.md as the
 * system prompt and the case's `inputPrompt` as the user message. Output
 * is the raw assistant content, returned as the artifact for the judge
 * pipeline.
 *
 * Design notes:
 *
 * - No tools. No multi-turn. No reads of the project beyond the one
 *   SKILL.md. Tier B/C layer complexity on top in later steps.
 * - Errors are propagated as-is (`EvalLlmError` subclasses) so the
 *   runner can surface them as verifier failures without swallowing the
 *   cause.
 * - Usage and USD cost are surfaced so the runner can commit them to
 *   the cost guard + case-level `costUsd`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "../../constants.js";
import { stageSkillFolder } from "../../content/skills.js";
import { exists } from "../../fs-utils.js";
import type { FlowStage } from "../../types.js";
import { computeUsageUsd } from "../cost-guard.js";
import type { ChatMessage, ChatUsage, EvalLlmClient } from "../llm-client.js";
import type { EvalCase, ResolvedEvalConfig } from "../types.js";

export interface SingleShotInput {
  caseEntry: EvalCase;
  config: Pick<
    ResolvedEvalConfig,
    "model" | "agentTemperature" | "timeoutMs" | "tokenPricing"
  >;
  projectRoot: string;
  client: EvalLlmClient;
  /**
   * Override the SKILL.md loader. Primarily a test hook so unit tests
   * can swap a canned system prompt without creating fixtures on disk.
   */
  loadSkill?: (stage: FlowStage) => Promise<string>;
}

export interface SingleShotOutput {
  artifact: string;
  usage: ChatUsage;
  usageUsd: number;
  model: string;
  durationMs: number;
  attempts: number;
  systemPrompt: string;
  userPrompt: string;
}

export async function loadStageSkill(
  projectRoot: string,
  stage: FlowStage
): Promise<string> {
  const folder = stageSkillFolder(stage);
  const file = path.join(projectRoot, RUNTIME_ROOT, "skills", folder, "SKILL.md");
  if (!(await exists(file))) {
    throw new Error(
      `Stage skill not found: ${path.relative(projectRoot, file)}. ` +
        `Run \`cclaw init\` (or \`cclaw sync\`) before \`cclaw eval --tier=A --judge\`.`
    );
  }
  return fs.readFile(file, "utf8");
}

function buildMessages(systemPrompt: string, userPrompt: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
}

function buildUserPrompt(caseEntry: EvalCase): string {
  const lines: string[] = [];
  lines.push(`Stage: ${caseEntry.stage}`);
  lines.push(`Case id: ${caseEntry.id}`);
  lines.push(``);
  lines.push(`Task:`);
  lines.push(caseEntry.inputPrompt.trim());
  lines.push(``);
  lines.push(
    `Produce the artifact required by this stage using the SKILL.md above. ` +
      `Output the artifact directly (markdown with optional YAML frontmatter). ` +
      `Do not wrap in code fences, do not add commentary before or after.`
  );
  return lines.join("\n");
}

/** Run the Tier A single-shot AUT and return the produced artifact. */
export async function runSingleShot(input: SingleShotInput): Promise<SingleShotOutput> {
  const { caseEntry, config, projectRoot, client } = input;
  const started = Date.now();
  const loader = input.loadSkill ?? ((stage: FlowStage) => loadStageSkill(projectRoot, stage));
  const systemPrompt = await loader(caseEntry.stage);
  const userPrompt = buildUserPrompt(caseEntry);
  const response = await client.chat({
    model: config.model,
    messages: buildMessages(systemPrompt, userPrompt),
    temperature: config.agentTemperature ?? 0.2,
    timeoutMs: config.timeoutMs
  });
  const usageUsd = computeUsageUsd(response.model, response.usage, {
    tokenPricing: config.tokenPricing
  });
  return {
    artifact: response.content.trim(),
    usage: response.usage,
    usageUsd,
    model: response.model,
    attempts: response.attempts,
    durationMs: Date.now() - started,
    systemPrompt,
    userPrompt
  };
}
