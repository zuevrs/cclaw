/**
 * Cross-artifact consistency verifier for Tier C.
 *
 * Operates over a `{ stage → artifact }` map produced by the workflow
 * agent and emits deterministic verifier results for:
 *
 *  - `ids_flow`: every id extracted from `from` must appear in every
 *    `to` stage. Typical use — `D-\d+` from scope must all land in plan.
 *  - `placeholder_free`: none of the listed phrases
 *    (default `TBD`/`TODO`/`placeholder`) appear in any of the named
 *    stages.
 *  - `no_contradictions`: for each entry, if `must` is present in the
 *    declaring stage, `forbid` must not appear in any of the listed
 *    `stages`.
 *
 * Each sub-check contributes zero or more `VerifierResult`s with
 * `kind: "consistency"`. An empty `WorkflowConsistencyExpected` produces
 * zero results so authors can opt in incrementally.
 */
import type {
  VerifierResult,
  WorkflowConsistencyExpected,
  WorkflowStageName
} from "../types.js";

const DEFAULT_PLACEHOLDERS = ["TBD", "TODO", "placeholder"];

export function verifyWorkflowConsistency(
  artifacts: Map<WorkflowStageName, string>,
  expected: WorkflowConsistencyExpected | undefined
): VerifierResult[] {
  if (!expected) return [];
  const out: VerifierResult[] = [];
  if (expected.idsFlow) {
    for (const rule of expected.idsFlow) {
      out.push(...checkIdsFlow(artifacts, rule));
    }
  }
  if (expected.placeholderFree) {
    out.push(
      ...checkPlaceholderFree(
        artifacts,
        expected.placeholderFree.stages,
        expected.placeholderFree.phrases && expected.placeholderFree.phrases.length > 0
          ? expected.placeholderFree.phrases
          : DEFAULT_PLACEHOLDERS
      )
    );
  }
  if (expected.noContradictions) {
    for (const rule of expected.noContradictions) {
      out.push(...checkNoContradiction(artifacts, rule));
    }
  }
  return out;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function missingStage(
  artifacts: Map<WorkflowStageName, string>,
  stage: WorkflowStageName,
  verifierId: string,
  label: string
): VerifierResult | undefined {
  if (artifacts.has(stage)) return undefined;
  return {
    kind: "consistency",
    id: verifierId,
    ok: false,
    score: 0,
    message: `Workflow artifact for stage "${stage}" is missing (${label}).`,
    details: { stage, missing: true }
  };
}

function extractIds(text: string, pattern: string, flags: string): string[] {
  const normalized = flags.includes("g") ? flags : `${flags}g`;
  const regex = new RegExp(pattern, normalized);
  const hits = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    hits.add(match[0]);
    if (regex.lastIndex === match.index) regex.lastIndex += 1;
  }
  return [...hits].sort((a, b) => a.localeCompare(b));
}

function checkIdsFlow(
  artifacts: Map<WorkflowStageName, string>,
  rule: {
    idPattern: string;
    idFlags?: string;
    from: WorkflowStageName;
    to: WorkflowStageName[];
  }
): VerifierResult[] {
  const idTag = slug(rule.idPattern);
  const baseId = `consistency:ids-flow:${rule.from}:${idTag}`;

  const results: VerifierResult[] = [];
  const missingFrom = missingStage(artifacts, rule.from, `${baseId}:source-missing`, "ids-flow source");
  if (missingFrom) {
    results.push(missingFrom);
    return results;
  }
  const source = artifacts.get(rule.from) as string;
  let sourceIds: string[];
  try {
    sourceIds = extractIds(source, rule.idPattern, rule.idFlags ?? "g");
  } catch (err) {
    results.push({
      kind: "consistency",
      id: `${baseId}:regex`,
      ok: false,
      score: 0,
      message: `Invalid id regex "${rule.idPattern}": ${err instanceof Error ? err.message : String(err)}`,
      details: { from: rule.from }
    });
    return results;
  }
  if (sourceIds.length === 0) {
    results.push({
      kind: "consistency",
      id: `${baseId}:source-empty`,
      ok: false,
      score: 0,
      message: `No ids matched "${rule.idPattern}" in stage "${rule.from}".`,
      details: { from: rule.from, pattern: rule.idPattern }
    });
    return results;
  }

  for (const target of rule.to) {
    const missingTarget = missingStage(
      artifacts,
      target,
      `${baseId}:${target}:target-missing`,
      "ids-flow target"
    );
    if (missingTarget) {
      results.push(missingTarget);
      continue;
    }
    const body = artifacts.get(target) as string;
    const missing = sourceIds.filter((id) => !body.includes(id));
    const verifierId = `${baseId}:${target}`;
    if (missing.length === 0) {
      results.push({
        kind: "consistency",
        id: verifierId,
        ok: true,
        score: 1,
        message: `All ${sourceIds.length} id(s) from "${rule.from}" appear in "${target}".`,
        details: { from: rule.from, to: target, ids: sourceIds }
      });
    } else {
      results.push({
        kind: "consistency",
        id: verifierId,
        ok: false,
        score: 0,
        message:
          `Missing in "${target}": ${missing.slice(0, 5).join(", ")}` +
          (missing.length > 5 ? ` (+${missing.length - 5} more)` : ""),
        details: {
          from: rule.from,
          to: target,
          ids: sourceIds,
          missing
        }
      });
    }
  }
  return results;
}

function checkPlaceholderFree(
  artifacts: Map<WorkflowStageName, string>,
  stages: WorkflowStageName[],
  phrases: string[]
): VerifierResult[] {
  const results: VerifierResult[] = [];
  for (const stage of stages) {
    const verifierId = `consistency:placeholder-free:${stage}`;
    const missing = missingStage(artifacts, stage, verifierId, "placeholder-free");
    if (missing) {
      results.push(missing);
      continue;
    }
    const body = artifacts.get(stage) as string;
    const lower = body.toLowerCase();
    const hits = phrases.filter((p) => lower.includes(p.toLowerCase()));
    if (hits.length === 0) {
      results.push({
        kind: "consistency",
        id: verifierId,
        ok: true,
        score: 1,
        message: `No placeholder phrases found in "${stage}".`,
        details: { stage, phrases }
      });
    } else {
      results.push({
        kind: "consistency",
        id: verifierId,
        ok: false,
        score: 0,
        message: `Placeholder phrases in "${stage}": ${hits.join(", ")}.`,
        details: { stage, phrases, hits }
      });
    }
  }
  return results;
}

function checkNoContradiction(
  artifacts: Map<WorkflowStageName, string>,
  rule: {
    stage: WorkflowStageName;
    must: string;
    forbid: string;
    stages: WorkflowStageName[];
  }
): VerifierResult[] {
  const tag = `${slug(rule.must)}-vs-${slug(rule.forbid)}`;
  const baseId = `consistency:no-contradiction:${rule.stage}:${tag}`;
  const results: VerifierResult[] = [];

  const missingAnchor = missingStage(
    artifacts,
    rule.stage,
    `${baseId}:anchor-missing`,
    "no-contradiction anchor"
  );
  if (missingAnchor) {
    results.push(missingAnchor);
    return results;
  }
  const anchorText = artifacts.get(rule.stage) as string;
  if (!anchorText.toLowerCase().includes(rule.must.toLowerCase())) {
    // The declaring stage doesn't actually assert `must`, so the rule is vacuously satisfied.
    results.push({
      kind: "consistency",
      id: `${baseId}:anchor-inactive`,
      ok: true,
      score: 1,
      message: `Anchor "${rule.must}" not present in "${rule.stage}"; contradiction check skipped.`,
      details: { stage: rule.stage, anchor: rule.must, skipped: true }
    });
    return results;
  }

  for (const target of rule.stages) {
    const verifierId = `${baseId}:${target}`;
    const missingTarget = missingStage(artifacts, target, `${verifierId}:target-missing`, "no-contradiction target");
    if (missingTarget) {
      results.push(missingTarget);
      continue;
    }
    const body = artifacts.get(target) as string;
    if (body.toLowerCase().includes(rule.forbid.toLowerCase())) {
      results.push({
        kind: "consistency",
        id: verifierId,
        ok: false,
        score: 0,
        message:
          `"${rule.stage}" asserts "${rule.must}" but "${target}" contains "${rule.forbid}".`,
        details: {
          stage: rule.stage,
          anchor: rule.must,
          forbid: rule.forbid,
          target
        }
      });
    } else {
      results.push({
        kind: "consistency",
        id: verifierId,
        ok: true,
        score: 1,
        message: `"${target}" does not contradict "${rule.stage}" on "${rule.must}".`,
        details: {
          stage: rule.stage,
          anchor: rule.must,
          forbid: rule.forbid,
          target
        }
      });
    }
  }
  return results;
}
