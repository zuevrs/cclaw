import fs from "node:fs/promises";
import path from "node:path";
import { lintArtifact, validateReviewArmy } from "./artifact-linter.js";
import { RUNTIME_ROOT } from "./constants.js";
import { stageSchema } from "./content/stage-schema.js";
import type { FlowState, StageGateState } from "./flow-state.js";
import { exists } from "./fs-utils.js";
import { readFlowState, writeFlowState } from "./runs.js";
import type { FlowStage } from "./types.js";

async function currentStageArtifactExists(projectRoot: string, stage: FlowStage): Promise<boolean> {
  const artifactFile = stageSchema(stage).artifactFile;
  const candidates = [
    path.join(projectRoot, RUNTIME_ROOT, "artifacts", artifactFile),
    path.join(projectRoot, artifactFile)
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return true;
  }
  // Artifact-linter also accepts the file under current working directory fallback; stat once more.
  try {
    await fs.access(path.join(projectRoot, artifactFile));
    return true;
  } catch {
    return false;
  }
}

export interface GateEvidenceCheckResult {
  ok: boolean;
  stage: FlowStage;
  issues: string[];
  requiredCount: number;
  passedCount: number;
  blockedCount: number;
  /** True only when every required gate for the stage is in `passed` and none are `blocked`. */
  complete: boolean;
  /** Required gate ids that are neither passed nor blocked. */
  missingRequired: string[];
}

export interface CompletedStagesClosureResult {
  ok: boolean;
  issues: string[];
  openStages: Array<{
    stage: FlowStage;
    missingRequired: string[];
    blocked: string[];
  }>;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export async function verifyCurrentStageGateEvidence(
  projectRoot: string,
  flowState: FlowState
): Promise<GateEvidenceCheckResult> {
  const stage = flowState.currentStage;
  const schema = stageSchema(stage);
  const catalog = flowState.stageGateCatalog[stage];
  const required = schema.requiredGates.map((gate) => gate.id);
  const requiredSet = new Set(required);
  const issues: string[] = [];

  const catalogRequired = unique(catalog.required);
  const missingInCatalog = required.filter((gateId) => !catalogRequired.includes(gateId));
  const unexpectedInCatalog = catalogRequired.filter((gateId) => !requiredSet.has(gateId));
  for (const gateId of missingInCatalog) {
    issues.push(`gate "${gateId}" missing from stageGateCatalog.required for stage "${stage}".`);
  }
  for (const gateId of unexpectedInCatalog) {
    issues.push(`unexpected gate "${gateId}" found in stageGateCatalog.required for stage "${stage}".`);
  }

  const blockedSet = new Set(catalog.blocked);
  for (const gateId of catalog.passed) {
    if (!requiredSet.has(gateId)) {
      issues.push(`passed gate "${gateId}" is not defined for stage "${stage}".`);
      continue;
    }
    if (blockedSet.has(gateId)) {
      issues.push(`gate "${gateId}" cannot be both passed and blocked.`);
    }
    const evidence = flowState.guardEvidence[gateId];
    if (typeof evidence !== "string" || evidence.trim().length === 0) {
      issues.push(`passed gate "${gateId}" is missing guardEvidence entry.`);
    }
  }
  for (const gateId of catalog.blocked) {
    if (!requiredSet.has(gateId)) {
      issues.push(`blocked gate "${gateId}" is not defined for stage "${stage}".`);
    }
  }

  const artifactPresent = await currentStageArtifactExists(projectRoot, stage);
  const shouldValidateArtifact =
    artifactPresent || catalog.passed.length > 0 || flowState.completedStages.includes(stage);
  if (shouldValidateArtifact) {
    const lint = await lintArtifact(projectRoot, stage);
    if (!lint.passed) {
      const failedRequired = lint.findings
        .filter((finding) => finding.required && !finding.found)
        .map((finding) => finding.section);
      if (failedRequired.length > 0) {
        issues.push(`artifact validation failed for required sections: ${failedRequired.join(", ")}.`);
      }
    }
    if (stage === "review") {
      const reviewArmy = await validateReviewArmy(projectRoot);
      if (!reviewArmy.valid) {
        issues.push(`review-army validation failed: ${reviewArmy.errors.join("; ")}`);
      }
    }
  }

  const passedSet = new Set(catalog.passed);
  const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
  const complete = missingRequired.length === 0 && catalog.blocked.length === 0;

  if (flowState.completedStages.includes(stage) && !complete) {
    if (missingRequired.length > 0) {
      issues.push(
        `stage "${stage}" is marked completed but required gates are not passed: ${missingRequired.join(", ")}.`
      );
    }
    if (catalog.blocked.length > 0) {
      issues.push(
        `stage "${stage}" is marked completed but has blocked gates: ${catalog.blocked.join(", ")}.`
      );
    }
  }

  return {
    ok: issues.length === 0,
    stage,
    issues,
    requiredCount: required.length,
    passedCount: catalog.passed.length,
    blockedCount: catalog.blocked.length,
    complete,
    missingRequired
  };
}

export function verifyCompletedStagesGateClosure(flowState: FlowState): CompletedStagesClosureResult {
  const issues: string[] = [];
  const openStages: CompletedStagesClosureResult["openStages"] = [];
  for (const stage of flowState.completedStages) {
    const schema = stageSchema(stage);
    const catalog = flowState.stageGateCatalog[stage];
    const required = schema.requiredGates.map((gate) => gate.id);
    const passedSet = new Set(catalog.passed);
    const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
    if (missingRequired.length > 0 || catalog.blocked.length > 0) {
      openStages.push({ stage, missingRequired, blocked: [...catalog.blocked] });
      if (missingRequired.length > 0) {
        issues.push(
          `completed stage "${stage}" has unpassed required gates: ${missingRequired.join(", ")}.`
        );
      }
      if (catalog.blocked.length > 0) {
        issues.push(
          `completed stage "${stage}" still has blocked gates: ${catalog.blocked.join(", ")}.`
        );
      }
    }
  }
  return { ok: openStages.length === 0, issues, openStages };
}

export interface GateReconciliationResult {
  stage: FlowStage;
  changed: boolean;
  before: StageGateState;
  after: StageGateState;
  notes: string[];
}

export interface GateReconciliationWritebackResult extends GateReconciliationResult {
  wrote: boolean;
}

export function reconcileCurrentStageGateCatalog(flowState: FlowState): {
  nextState: FlowState;
  reconciliation: GateReconciliationResult;
} {
  const stage = flowState.currentStage;
  const required = stageSchema(stage).requiredGates.map((gate) => gate.id);
  const requiredSet = new Set(required);
  const catalog = flowState.stageGateCatalog[stage];
  const notes: string[] = [];

  const before: StageGateState = {
    required: [...catalog.required],
    passed: [...catalog.passed],
    blocked: [...catalog.blocked]
  };

  const passedSet = new Set(
    unique(catalog.passed).filter((gateId) => {
      const keep = requiredSet.has(gateId);
      if (!keep) {
        notes.push(`removed unknown passed gate "${gateId}"`);
      }
      return keep;
    })
  );
  const blockedSet = new Set(
    unique(catalog.blocked).filter((gateId) => {
      const keep = requiredSet.has(gateId);
      if (!keep) {
        notes.push(`removed unknown blocked gate "${gateId}"`);
      }
      return keep;
    })
  );

  for (const gateId of [...passedSet]) {
    if (!blockedSet.has(gateId)) continue;
    const evidence = flowState.guardEvidence[gateId];
    if (typeof evidence === "string" && evidence.trim().length > 0) {
      blockedSet.delete(gateId);
      notes.push(`resolved overlap for "${gateId}" in favor of passed (evidence present)`);
      continue;
    }
    passedSet.delete(gateId);
    notes.push(`resolved overlap for "${gateId}" in favor of blocked (missing evidence)`);
  }

  for (const gateId of [...passedSet]) {
    const evidence = flowState.guardEvidence[gateId];
    if (typeof evidence === "string" && evidence.trim().length > 0) continue;
    passedSet.delete(gateId);
    blockedSet.add(gateId);
    notes.push(`moved "${gateId}" from passed to blocked (missing evidence)`);
  }

  const after: StageGateState = {
    required: [...required],
    passed: required.filter((gateId) => passedSet.has(gateId)),
    blocked: required.filter((gateId) => blockedSet.has(gateId) && !passedSet.has(gateId))
  };

  const changed =
    !sameStringArray(before.required, after.required) ||
    !sameStringArray(before.passed, after.passed) ||
    !sameStringArray(before.blocked, after.blocked);

  const nextState: FlowState = changed
    ? {
        ...flowState,
        stageGateCatalog: {
          ...flowState.stageGateCatalog,
          [stage]: after
        }
      }
    : flowState;

  return {
    nextState,
    reconciliation: {
      stage,
      changed,
      before,
      after,
      notes
    }
  };
}

export async function reconcileAndWriteCurrentStageGateCatalog(
  projectRoot: string
): Promise<GateReconciliationWritebackResult> {
  const state = await readFlowState(projectRoot);
  const { nextState, reconciliation } = reconcileCurrentStageGateCatalog(state);
  if (reconciliation.changed) {
    await writeFlowState(projectRoot, nextState);
  }
  return {
    ...reconciliation,
    wrote: reconciliation.changed
  };
}
