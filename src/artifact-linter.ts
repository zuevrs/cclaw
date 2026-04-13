import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { exists } from "./fs-utils.js";
import { orderedStageSchemas, stageSchema } from "./content/stage-schema.js";
import { readFlowState } from "./runs.js";
import type { FlowStage } from "./types.js";

export interface LintFinding {
  section: string;
  required: boolean;
  rule: string;
  found: boolean;
  details: string;
}

export interface LintResult {
  stage: string;
  file: string;
  passed: boolean;
  findings: LintFinding[];
}

interface ResolvedArtifactPath {
  absPath: string;
  relPath: string;
}

async function resolveArtifactPath(projectRoot: string, fileName: string): Promise<ResolvedArtifactPath> {
  const fallbackRelPath = path.join(RUNTIME_ROOT, "artifacts", fileName);
  const fallbackAbsPath = path.join(projectRoot, fallbackRelPath);
  const { activeRunId } = await readFlowState(projectRoot);
  const runId = activeRunId.trim();

  if (runId.length > 0) {
    const canonicalRelPath = path.join(RUNTIME_ROOT, "runs", runId, "artifacts", fileName);
    const canonicalAbsPath = path.join(projectRoot, canonicalRelPath);
    if (await exists(canonicalAbsPath)) {
      return { absPath: canonicalAbsPath, relPath: canonicalRelPath };
    }
  }

  return { absPath: fallbackAbsPath, relPath: fallbackRelPath };
}

function normalizeHeadingTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

/** Collect H2 titles from markdown (`## Section Name`). */
function extractH2Headings(markdown: string): Set<string> {
  const set = new Set<string>();
  const re = /^##\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    set.add(normalizeHeadingTitle(m[1] ?? ""));
  }
  return set;
}

function headingPresent(headings: Set<string>, section: string): boolean {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const h of headings) {
    if (h.toLowerCase() === want) {
      return true;
    }
  }
  return false;
}

export async function lintArtifact(projectRoot: string, stage: FlowStage): Promise<LintResult> {
  const schema = stageSchema(stage);
  const { absPath: absFile, relPath: relFile } = await resolveArtifactPath(projectRoot, schema.artifactFile);
  const findings: LintFinding[] = [];

  if (!(await exists(absFile))) {
    for (const v of schema.artifactValidation) {
      findings.push({
        section: v.section,
        required: v.required,
        rule: v.validationRule,
        found: false,
        details: `Artifact file missing: ${relFile}`
      });
    }
    return {
      stage,
      file: relFile,
      passed: schema.artifactValidation.every((v) => !v.required),
      findings
    };
  }

  const raw = await fs.readFile(absFile, "utf8");
  const headings = extractH2Headings(raw);

  for (const v of schema.artifactValidation) {
    const found = headingPresent(headings, v.section);
    findings.push({
      section: v.section,
      required: v.required,
      rule: v.validationRule,
      found,
      details: found
        ? `H2 heading found matching "${v.section}".`
        : `No ## heading matching required section "${v.section}".`
    });
  }

  const passed = findings.every((f) => !f.required || f.found);
  return { stage, file: relFile, passed, findings };
}

export async function lintAllArtifacts(projectRoot: string): Promise<LintResult[]> {
  const out: LintResult[] = [];
  for (const schema of orderedStageSchemas()) {
    out.push(await lintArtifact(projectRoot, schema.stage));
  }
  return out;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function validateReviewArmy(
  projectRoot: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const { absPath, relPath } = await resolveArtifactPath(projectRoot, "07-review-army.json");

  if (!(await exists(absPath))) {
    return { valid: false, errors: [`Missing file: ${relPath}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(absPath, "utf8")) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, errors: [`Invalid JSON: ${msg}`] };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, errors: ["Root value must be a JSON object."] };
  }

  const root = parsed as Record<string, unknown>;

  if (!("version" in root) || !isFiniteNumber(root.version)) {
    errors.push('Field "version" must be a finite number.');
  }

  if (!Array.isArray(root.findings)) {
    errors.push('Field "findings" must be an array.');
  } else {
    root.findings.forEach((f, i) => {
      if (f === null || typeof f !== "object" || Array.isArray(f)) {
        errors.push(`findings[${i}] must be an object.`);
        return;
      }
      const o = f as Record<string, unknown>;
      if (!isNonEmptyString(o.id)) {
        errors.push(`findings[${i}].id must be a non-empty string.`);
      }
      if (!isNonEmptyString(o.severity)) {
        errors.push(`findings[${i}].severity must be a non-empty string.`);
      }
      if (!isNonEmptyString(o.status)) {
        errors.push(`findings[${i}].status must be a non-empty string.`);
      }
      if (!isNonEmptyString(o.fingerprint)) {
        errors.push(`findings[${i}].fingerprint must be a non-empty string.`);
      }
    });
  }

  if (!("reconciliation" in root) || root.reconciliation === null || typeof root.reconciliation !== "object") {
    errors.push('Field "reconciliation" must be an object.');
  } else {
    const rec = root.reconciliation as Record<string, unknown>;
    if (!Array.isArray(rec.shipBlockers)) {
      errors.push('reconciliation.shipBlockers must be an array.');
    }
  }

  return { valid: errors.length === 0, errors };
}
