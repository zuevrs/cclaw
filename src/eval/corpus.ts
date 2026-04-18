import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import { FLOW_STAGES } from "../types.js";
import type { FlowStage } from "../types.js";
import type { EvalCase } from "./types.js";

const FLOW_STAGE_SET = new Set<string>(FLOW_STAGES);

function corpusError(filePath: string, reason: string): Error {
  return new Error(
    `Invalid eval case at ${filePath}: ${reason}\n` +
      `Supported stages: ${FLOW_STAGES.join(", ")}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCase(filePath: string, raw: unknown): EvalCase {
  if (!isRecord(raw)) {
    throw corpusError(filePath, "top-level value must be a mapping");
  }

  const id = raw.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw corpusError(filePath, `"id" must be a non-empty string`);
  }

  const stageRaw = raw.stage;
  if (typeof stageRaw !== "string" || !FLOW_STAGE_SET.has(stageRaw)) {
    throw corpusError(filePath, `"stage" must be one of: ${FLOW_STAGES.join(", ")}`);
  }

  const inputPrompt = raw.input_prompt ?? raw.inputPrompt;
  if (typeof inputPrompt !== "string" || inputPrompt.trim().length === 0) {
    throw corpusError(filePath, `"input_prompt" must be a non-empty string`);
  }

  const contextFilesRaw = raw.context_files ?? raw.contextFiles;
  let contextFiles: string[] | undefined;
  if (contextFilesRaw !== undefined) {
    if (!Array.isArray(contextFilesRaw) || contextFilesRaw.some((f) => typeof f !== "string")) {
      throw corpusError(filePath, `"context_files" must be an array of strings`);
    }
    contextFiles = contextFilesRaw as string[];
  }

  const expected =
    raw.expected !== undefined && isRecord(raw.expected)
      ? (raw.expected as Record<string, unknown>)
      : undefined;

  const fixture = typeof raw.fixture === "string" ? raw.fixture : undefined;

  return {
    id: id.trim(),
    stage: stageRaw as FlowStage,
    inputPrompt: inputPrompt.trim(),
    contextFiles,
    expected,
    fixture
  };
}

/**
 * Load all eval cases under `.cclaw/evals/corpus/**`. Optionally restrict to a
 * single stage. Returns an empty array for a fresh install (Wave 7.0 ships
 * without seed cases; corpus is authored in Wave 7.1+).
 */
export async function loadCorpus(
  projectRoot: string,
  stage?: FlowStage
): Promise<EvalCase[]> {
  const corpusRoot = path.join(projectRoot, EVALS_ROOT, "corpus");
  if (!(await exists(corpusRoot))) {
    return [];
  }

  const cases: EvalCase[] = [];
  const stageDirs = stage
    ? [path.join(corpusRoot, stage)]
    : (await fs.readdir(corpusRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .filter((entry) => FLOW_STAGE_SET.has(entry.name))
        .map((entry) => path.join(corpusRoot, entry.name));

  for (const stageDir of stageDirs) {
    if (!(await exists(stageDir))) continue;
    const entries = await fs.readdir(stageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
      const filePath = path.join(stageDir, entry.name);
      let parsed: unknown;
      try {
        parsed = parse(await fs.readFile(filePath, "utf8"));
      } catch (err) {
        throw corpusError(filePath, err instanceof Error ? err.message : String(err));
      }
      cases.push(validateCase(filePath, parsed));
    }
  }

  cases.sort((a, b) => a.stage.localeCompare(b.stage) || a.id.localeCompare(b.id));
  return cases;
}
