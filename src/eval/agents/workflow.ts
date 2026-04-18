/**
 * Tier C workflow agent.
 *
 * Runs the Tier B with-tools loop once per stage in a workflow case,
 * sharing a single sandbox across stages so every new stage can read
 * the earlier artifacts the model produced. The shape of the run is:
 *
 *   1. Create one sandbox seeded with `contextFiles`.
 *   2. For each stage in `workflow.stages`:
 *      a. Delete any leftover `artifact.md` so the resolver doesn't
 *         accidentally pick the previous stage's output.
 *      b. Invoke `runWithTools({ externalSandbox: sandbox, promptPreamble })`.
 *         The preamble tells the model which stage it is on and lists the
 *         `stages/*.md` files available for reading.
 *      c. Persist the returned artifact to `stages/<stage>.md` inside the
 *         sandbox (deterministic, regardless of whether the model wrote
 *         `artifact.md` itself).
 *      d. Record `WorkflowStageResult` with usage, duration, and tool use.
 *   3. Dispose the sandbox in a `finally` so temp directories never leak.
 *
 * Errors bubble up from `runWithTools`:
 *   - `MaxTurnsExceededError` stops the workflow at the current stage.
 *   - `DailyCostCapExceededError` (surfaced by the cost-guard wrapper in
 *     the runner) aborts immediately.
 *   - Generic `EvalLlmError` subclasses propagate as-is so the runner can
 *     record a workflow-level verifier failure.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { EvalLlmClient } from "../llm-client.js";
import { createSandbox, type Sandbox } from "../sandbox.js";
import type { SandboxTool } from "../tools/index.js";
import type {
  EvalCase,
  ResolvedEvalConfig,
  WorkflowCase,
  WorkflowStageName,
  WorkflowStageResult
} from "../types.js";
import { loadStageSkill } from "./single-shot.js";
import { runWithTools } from "./with-tools.js";

const STAGES_SUBDIR = "stages";
const ARTIFACT_CANDIDATES = ["artifact.md", "artifact.txt", "ARTIFACT.md"];

export interface WorkflowInput {
  workflow: WorkflowCase;
  config: Pick<
    ResolvedEvalConfig,
    | "model"
    | "agentTemperature"
    | "timeoutMs"
    | "tokenPricing"
    | "toolMaxTurns"
    | "toolMaxArgumentsBytes"
    | "toolMaxResultBytes"
    | "workflowMaxTotalTurns"
  >;
  projectRoot: string;
  client: EvalLlmClient;
  tools?: SandboxTool[];
  /** Override for the SKILL.md loader (test hook). */
  loadSkill?: (stage: WorkflowStageName) => Promise<string>;
  /** Override for the sandbox factory (test hook). */
  createSandboxFn?: typeof createSandbox;
}

export interface WorkflowOutput {
  caseId: string;
  stages: WorkflowStageResult[];
  /** Map from stage name to produced artifact (also persisted in sandbox). */
  artifacts: Map<WorkflowStageName, string>;
  totalUsageUsd: number;
  totalDurationMs: number;
}

export async function runWorkflow(input: WorkflowInput): Promise<WorkflowOutput> {
  const { workflow, config, projectRoot, client } = input;
  const sandboxFactory = input.createSandboxFn ?? createSandbox;
  const sandbox = await sandboxFactory({
    projectRoot,
    ...(workflow.contextFiles ? { contextFiles: workflow.contextFiles } : {})
  });

  const stageResults: WorkflowStageResult[] = [];
  const artifacts = new Map<WorkflowStageName, string>();
  let totalUsageUsd = 0;
  let totalDurationMs = 0;

  try {
    await fs.mkdir(
      await sandbox.resolve(STAGES_SUBDIR, { allowMissing: true }),
      { recursive: true }
    );

    for (const step of workflow.stages) {
      await clearArtifactFile(sandbox);
      const priorStages: WorkflowStageName[] = stageResults.map((r) => r.stage);
      const preamble = buildStagePreamble(
        workflow,
        step.name,
        priorStages
      );
      const caseEntry: EvalCase = {
        id: `${workflow.id}/${step.name}`,
        stage: step.name,
        inputPrompt: step.inputPrompt,
        ...(workflow.contextFiles ? { contextFiles: workflow.contextFiles } : {})
      };

      const result = await runWithTools({
        caseEntry,
        config,
        projectRoot,
        client,
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.loadSkill
          ? { loadSkill: input.loadSkill as (stage: EvalCase["stage"]) => Promise<string> }
          : {
              loadSkill: (stage: EvalCase["stage"]) =>
                loadStageSkill(projectRoot, stage)
            }),
        externalSandbox: sandbox,
        promptPreamble: preamble
      });

      await persistStageArtifact(sandbox, step.name, result.artifact);
      artifacts.set(step.name, result.artifact);

      const stageResult: WorkflowStageResult = {
        stage: step.name,
        artifact: result.artifact,
        durationMs: result.durationMs,
        usageUsd: result.usageUsd,
        toolUse: result.toolUse,
        attempts: result.attempts,
        model: result.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens
      };
      stageResults.push(stageResult);
      totalUsageUsd += result.usageUsd;
      totalDurationMs += result.durationMs;
    }

    return {
      caseId: workflow.id,
      stages: stageResults,
      artifacts,
      totalUsageUsd: Number(totalUsageUsd.toFixed(6)),
      totalDurationMs
    };
  } finally {
    await sandbox.dispose();
  }
}

async function clearArtifactFile(sandbox: Sandbox): Promise<void> {
  for (const candidate of ARTIFACT_CANDIDATES) {
    try {
      const abs = await sandbox.resolve(candidate);
      await fs.rm(abs, { force: true });
    } catch {
      // candidate did not exist — resolve threw SandboxEscapeError for
      // missing realpath; safe to ignore.
    }
  }
}

async function persistStageArtifact(
  sandbox: Sandbox,
  stage: WorkflowStageName,
  artifact: string
): Promise<void> {
  const rel = `${STAGES_SUBDIR}/${stage}.md`;
  const abs = await sandbox.resolve(rel, { allowMissing: true });
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, artifact.endsWith("\n") ? artifact : `${artifact}\n`, "utf8");
}

function buildStagePreamble(
  workflow: WorkflowCase,
  current: WorkflowStageName,
  priorStages: WorkflowStageName[]
): string {
  const lines: string[] = [];
  lines.push(
    `You are running stage "${current}" of the Tier C workflow "${workflow.id}".`
  );
  if (workflow.description) {
    lines.push(`Case description: ${workflow.description}`);
  }
  if (priorStages.length === 0) {
    lines.push(
      `This is the first stage. Any context_files have been seeded into the sandbox root.`
    );
  } else {
    lines.push(
      `Earlier stage artifacts are available via read_file:`,
      ...priorStages.map((name) => `  - ${STAGES_SUBDIR}/${name}.md`),
      `Read the prior artifacts before drafting your output so decisions and ` +
        `ids carry through.`
    );
  }
  return lines.join("\n");
}
