/**
 * Loader + validator for `.cclaw/evals/rubrics/<stage>.yaml`.
 *
 * Each file maps to exactly one `RubricDoc` that drives the LLM judge.
 * Validation is strict: unknown top-level keys, missing required fields,
 * duplicate check ids, and malformed weights all surface as actionable
 * errors rather than turning into silent "judge had nothing to score"
 * passes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import { FLOW_STAGES } from "../types.js";
import type { FlowStage } from "../types.js";
import type { RubricCheck, RubricDoc } from "./types.js";

export function rubricsDir(projectRoot: string): string {
  return path.join(projectRoot, EVALS_ROOT, "rubrics");
}

export function rubricPath(projectRoot: string, stage: FlowStage): string {
  return path.join(rubricsDir(projectRoot), `${stage}.yaml`);
}

function rubricError(file: string, reason: string): Error {
  return new Error(
    `Invalid rubric at ${file}: ${reason}\n` +
      `See docs/evals.md for the rubric schema. Fields: stage (required), id (optional, defaults to stage), checks[] with id + prompt.`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCheck(raw: unknown, index: number, file: string): RubricCheck {
  if (!isRecord(raw)) {
    throw rubricError(file, `checks[${index}] must be a mapping`);
  }
  const id = raw.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw rubricError(file, `checks[${index}].id must be a non-empty string`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw rubricError(
      file,
      `checks[${index}].id "${id}" must be kebab-case (lowercase letters, digits, hyphen; starts with a letter)`
    );
  }
  const prompt = raw.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw rubricError(file, `checks[${index}].prompt must be a non-empty string`);
  }
  const check: RubricCheck = {
    id,
    prompt: prompt.trim()
  };
  if (raw.scale !== undefined) {
    if (typeof raw.scale !== "string" || raw.scale.trim().length === 0) {
      throw rubricError(file, `checks[${index}].scale must be a non-empty string when provided`);
    }
    check.scale = raw.scale.trim();
  }
  if (raw.weight !== undefined) {
    if (typeof raw.weight !== "number" || !Number.isFinite(raw.weight) || raw.weight < 0) {
      throw rubricError(file, `checks[${index}].weight must be a non-negative number when provided`);
    }
    check.weight = raw.weight;
  }
  if (raw.critical !== undefined) {
    if (typeof raw.critical !== "boolean") {
      throw rubricError(file, `checks[${index}].critical must be a boolean when provided`);
    }
    check.critical = raw.critical;
  }
  const known = new Set(["id", "prompt", "scale", "weight", "critical"]);
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw rubricError(file, `checks[${index}] has unknown key(s): ${unknown.join(", ")}`);
  }
  return check;
}

function validateRubric(raw: unknown, file: string): RubricDoc {
  if (!isRecord(raw)) {
    throw rubricError(file, "top-level value must be a mapping");
  }
  const stage = raw.stage;
  if (typeof stage !== "string" || !FLOW_STAGES.includes(stage as FlowStage)) {
    throw rubricError(
      file,
      `"stage" must be one of: ${FLOW_STAGES.join(", ")} (got: ${JSON.stringify(stage)})`
    );
  }
  const id = raw.id;
  let rubricId = stage as string;
  if (id !== undefined) {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw rubricError(file, `"id" must be a non-empty string when provided`);
    }
    rubricId = id.trim();
  }
  const checks = raw.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    throw rubricError(file, `"checks" must be a non-empty array`);
  }
  const parsed: RubricCheck[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < checks.length; i += 1) {
    const check = validateCheck(checks[i], i, file);
    if (seen.has(check.id)) {
      throw rubricError(file, `duplicate check id: "${check.id}"`);
    }
    seen.add(check.id);
    parsed.push(check);
  }
  const known = new Set(["stage", "id", "checks"]);
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw rubricError(file, `unknown top-level key(s): ${unknown.join(", ")}`);
  }
  return {
    stage: stage as FlowStage,
    id: rubricId,
    checks: parsed
  };
}

/**
 * Load the rubric for `stage`. Returns `undefined` when the file is
 * missing so callers can emit a "no rubric" verifier result rather than
 * crashing — authors are expected to grow rubrics incrementally.
 */
export async function loadRubric(
  projectRoot: string,
  stage: FlowStage
): Promise<RubricDoc | undefined> {
  const file = rubricPath(projectRoot, stage);
  if (!(await exists(file))) return undefined;
  let parsed: unknown;
  try {
    parsed = parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    throw rubricError(file, err instanceof Error ? err.message : String(err));
  }
  return validateRubric(parsed, file);
}

/** Load every rubric present in the given rubrics directory. */
export async function loadAllRubrics(
  projectRoot: string
): Promise<Map<FlowStage, RubricDoc>> {
  const out = new Map<FlowStage, RubricDoc>();
  for (const stage of FLOW_STAGES) {
    const doc = await loadRubric(projectRoot, stage);
    if (doc) out.set(stage, doc);
  }
  return out;
}

/** Exposed for tests. */
export const __internal = { validateRubric, validateCheck };
