/**
 * Workflow corpus loader for Tier C.
 *
 * Tier C cases live under `.cclaw/evals/corpus/workflows/<id>.yaml` and
 * describe a multi-stage run that chains the with-tools agent across
 * `brainstorm → scope → design → spec → plan`. Unlike single-stage
 * cases (which are keyed by stage folder), workflow cases ship as a
 * single YAML that embeds each stage's prompt + expectations.
 *
 * The loader is intentionally separate from `loadCorpus` so the
 * structural / rules CI paths never walk the workflow directory — those
 * paths are single-stage only.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import type {
  WorkflowCase,
  WorkflowConsistencyExpected,
  WorkflowStageName,
  WorkflowStageStep
} from "./types.js";
import { WORKFLOW_STAGES } from "./types.js";

const WORKFLOW_STAGE_SET = new Set<string>(WORKFLOW_STAGES);

function workflowCorpusError(filePath: string, reason: string): Error {
  return new Error(
    `Invalid workflow case at ${filePath}: ${reason}\n` +
      `Supported workflow stages: ${WORKFLOW_STAGES.join(", ")}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(
  filePath: string,
  context: string,
  value: unknown
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw workflowCorpusError(filePath, `"${context}" must be an array of strings`);
  }
  return value as string[];
}

function parseStageName(
  filePath: string,
  context: string,
  value: unknown
): WorkflowStageName {
  if (typeof value !== "string" || !WORKFLOW_STAGE_SET.has(value)) {
    throw workflowCorpusError(
      filePath,
      `"${context}" must be one of: ${WORKFLOW_STAGES.join(", ")}`
    );
  }
  return value as WorkflowStageName;
}

function parseStageArray(
  filePath: string,
  context: string,
  value: unknown
): WorkflowStageName[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw workflowCorpusError(filePath, `"${context}" must be a non-empty array of stage names`);
  }
  return value.map((entry, index) =>
    parseStageName(filePath, `${context}[${index}]`, entry)
  );
}

function parseStageStep(
  filePath: string,
  index: number,
  raw: unknown
): WorkflowStageStep {
  if (!isRecord(raw)) {
    throw workflowCorpusError(filePath, `stages[${index}] must be a mapping`);
  }
  const name = parseStageName(filePath, `stages[${index}].name`, raw.name);
  const inputPrompt = raw.input_prompt ?? raw.inputPrompt;
  if (typeof inputPrompt !== "string" || inputPrompt.trim().length === 0) {
    throw workflowCorpusError(
      filePath,
      `stages[${index}].input_prompt must be a non-empty string`
    );
  }
  const step: WorkflowStageStep = { name, inputPrompt: inputPrompt.trim() };
  if (raw.rubric !== undefined) {
    if (typeof raw.rubric !== "string" || raw.rubric.trim().length === 0) {
      throw workflowCorpusError(
        filePath,
        `stages[${index}].rubric must be a non-empty string`
      );
    }
    step.rubric = raw.rubric.trim();
  }
  const requiredChecks = readStringArray(
    filePath,
    `stages[${index}].required_checks`,
    raw.required_checks ?? raw.requiredChecks
  );
  if (requiredChecks) step.requiredChecks = requiredChecks;
  const minScoresRaw = raw.minimum_scores ?? raw.minimumScores;
  if (minScoresRaw !== undefined) {
    if (!isRecord(minScoresRaw)) {
      throw workflowCorpusError(
        filePath,
        `stages[${index}].minimum_scores must be a mapping of check id → number`
      );
    }
    const minimumScores: Record<string, number> = {};
    for (const [key, val] of Object.entries(minScoresRaw)) {
      if (typeof val !== "number" || !Number.isFinite(val) || val < 1 || val > 5) {
        throw workflowCorpusError(
          filePath,
          `stages[${index}].minimum_scores.${key} must be a number in [1,5]`
        );
      }
      minimumScores[key] = val;
    }
    step.minimumScores = minimumScores;
  }
  return step;
}

function parseConsistency(
  filePath: string,
  raw: unknown
): WorkflowConsistencyExpected | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw workflowCorpusError(filePath, `"consistency" must be a mapping`);
  }
  const out: WorkflowConsistencyExpected = {};

  const idsFlowRaw = raw.ids_flow ?? raw.idsFlow;
  if (idsFlowRaw !== undefined) {
    if (!Array.isArray(idsFlowRaw)) {
      throw workflowCorpusError(filePath, `"consistency.ids_flow" must be an array`);
    }
    out.idsFlow = idsFlowRaw.map((entry, index) => {
      if (!isRecord(entry)) {
        throw workflowCorpusError(
          filePath,
          `consistency.ids_flow[${index}] must be a mapping`
        );
      }
      const idPattern = entry.id_pattern ?? entry.idPattern;
      if (typeof idPattern !== "string" || idPattern.length === 0) {
        throw workflowCorpusError(
          filePath,
          `consistency.ids_flow[${index}].id_pattern must be a non-empty regex source`
        );
      }
      const idFlags = entry.id_flags ?? entry.idFlags;
      if (idFlags !== undefined && typeof idFlags !== "string") {
        throw workflowCorpusError(
          filePath,
          `consistency.ids_flow[${index}].id_flags must be a string`
        );
      }
      const from = parseStageName(
        filePath,
        `consistency.ids_flow[${index}].from`,
        entry.from
      );
      const to = parseStageArray(
        filePath,
        `consistency.ids_flow[${index}].to`,
        entry.to
      );
      const result: {
        idPattern: string;
        idFlags?: string;
        from: WorkflowStageName;
        to: WorkflowStageName[];
      } = { idPattern, from, to };
      if (idFlags !== undefined) result.idFlags = idFlags;
      return result;
    });
  }

  const placeholderRaw = raw.placeholder_free ?? raw.placeholderFree;
  if (placeholderRaw !== undefined) {
    if (!isRecord(placeholderRaw)) {
      throw workflowCorpusError(
        filePath,
        `"consistency.placeholder_free" must be a mapping`
      );
    }
    const stages = parseStageArray(
      filePath,
      "consistency.placeholder_free.stages",
      placeholderRaw.stages
    );
    const phrases = readStringArray(
      filePath,
      "consistency.placeholder_free.phrases",
      placeholderRaw.phrases
    );
    const block: { stages: WorkflowStageName[]; phrases?: string[] } = { stages };
    if (phrases) block.phrases = phrases;
    out.placeholderFree = block;
  }

  const noContradictionsRaw = raw.no_contradictions ?? raw.noContradictions;
  if (noContradictionsRaw !== undefined) {
    if (!Array.isArray(noContradictionsRaw)) {
      throw workflowCorpusError(
        filePath,
        `"consistency.no_contradictions" must be an array`
      );
    }
    out.noContradictions = noContradictionsRaw.map((entry, index) => {
      if (!isRecord(entry)) {
        throw workflowCorpusError(
          filePath,
          `consistency.no_contradictions[${index}] must be a mapping`
        );
      }
      const stage = parseStageName(
        filePath,
        `consistency.no_contradictions[${index}].stage`,
        entry.stage
      );
      if (typeof entry.must !== "string" || entry.must.length === 0) {
        throw workflowCorpusError(
          filePath,
          `consistency.no_contradictions[${index}].must must be a non-empty string`
        );
      }
      if (typeof entry.forbid !== "string" || entry.forbid.length === 0) {
        throw workflowCorpusError(
          filePath,
          `consistency.no_contradictions[${index}].forbid must be a non-empty string`
        );
      }
      const stages = parseStageArray(
        filePath,
        `consistency.no_contradictions[${index}].stages`,
        entry.stages
      );
      return {
        stage,
        must: entry.must,
        forbid: entry.forbid,
        stages
      };
    });
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function validateWorkflowCase(filePath: string, raw: unknown): WorkflowCase {
  if (!isRecord(raw)) {
    throw workflowCorpusError(filePath, `top-level value must be a mapping`);
  }
  const id = raw.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw workflowCorpusError(filePath, `"id" must be a non-empty string`);
  }
  const stagesRaw = raw.stages;
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    throw workflowCorpusError(filePath, `"stages" must be a non-empty array`);
  }
  const stages = stagesRaw.map((entry, index) =>
    parseStageStep(filePath, index, entry)
  );
  const contextFiles = readStringArray(
    filePath,
    "context_files",
    raw.context_files ?? raw.contextFiles
  );
  const consistency = parseConsistency(filePath, raw.consistency);
  const description =
    typeof raw.description === "string" ? raw.description.trim() : undefined;

  const out: WorkflowCase = { id: id.trim(), stages };
  if (description) out.description = description;
  if (contextFiles) out.contextFiles = contextFiles;
  if (consistency) out.consistency = consistency;
  return out;
}

/**
 * Load every Tier C workflow case under
 * `.cclaw/evals/corpus/workflows/*.yaml`. Returns an empty array when the
 * directory is missing — a fresh `cclaw init` has no Tier C corpus yet.
 */
export async function loadWorkflowCorpus(projectRoot: string): Promise<WorkflowCase[]> {
  const dir = path.join(projectRoot, EVALS_ROOT, "corpus", "workflows");
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: WorkflowCase[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
    const filePath = path.join(dir, entry.name);
    let parsed: unknown;
    try {
      parsed = parse(await fs.readFile(filePath, "utf8"));
    } catch (err) {
      throw workflowCorpusError(
        filePath,
        err instanceof Error ? err.message : String(err)
      );
    }
    out.push(validateWorkflowCase(filePath, parsed));
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
