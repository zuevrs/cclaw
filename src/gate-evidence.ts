import fs from "node:fs/promises";
import path from "node:path";
import { checkReviewVerdictConsistency, lintArtifact, validateReviewArmy } from "./artifact-linter.js";
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
  recommendedCount: number;
  conditionalCount: number;
  triggeredConditionalCount: number;
  passedCount: number;
  blockedCount: number;
  /** True only when required + triggered conditional gates are passed and unblocked. */
  complete: boolean;
  /** Required gate ids that are neither passed nor blocked. */
  missingRequired: string[];
  /** Recommended gates not yet passed (does not block). */
  missingRecommended: string[];
  /** Triggered conditional gates that are not yet passed. */
  missingTriggeredConditional: string[];
}

export interface CompletedStagesClosureResult {
  ok: boolean;
  issues: string[];
  openStages: Array<{
    stage: FlowStage;
    missingRequired: string[];
    missingTriggeredConditional: string[];
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
  const required = schema.requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const recommended = schema.requiredGates
    .filter((gate) => gate.tier === "recommended")
    .map((gate) => gate.id);
  const conditional = schema.requiredGates
    .filter((gate) => gate.tier === "conditional")
    .map((gate) => gate.id);
  const requiredSet = new Set(required);
  const recommendedSet = new Set(recommended);
  const conditionalSet = new Set(conditional);
  const allowedSet = new Set([...required, ...recommended, ...conditional]);
  const issues: string[] = [];

  const catalogRequired = unique(catalog.required);
  const catalogRecommended = unique(catalog.recommended ?? []);
  const catalogConditional = unique(catalog.conditional ?? []);
  const catalogTriggered = unique(catalog.triggered ?? []);
  const missingInCatalog = required.filter((gateId) => !catalogRequired.includes(gateId));
  const unexpectedInCatalog = catalogRequired.filter((gateId) => !requiredSet.has(gateId));
  const missingRecommendedInCatalog = recommended.filter((gateId) => !catalogRecommended.includes(gateId));
  const unexpectedRecommendedInCatalog = catalogRecommended.filter((gateId) => !recommendedSet.has(gateId));
  const missingConditionalInCatalog = conditional.filter((gateId) => !catalogConditional.includes(gateId));
  const unexpectedConditionalInCatalog = catalogConditional.filter((gateId) => !conditionalSet.has(gateId));
  for (const gateId of missingInCatalog) {
    issues.push(`gate "${gateId}" missing from stageGateCatalog.required for stage "${stage}".`);
  }
  for (const gateId of unexpectedInCatalog) {
    issues.push(`unexpected gate "${gateId}" found in stageGateCatalog.required for stage "${stage}".`);
  }
  for (const gateId of missingRecommendedInCatalog) {
    issues.push(`gate "${gateId}" missing from stageGateCatalog.recommended for stage "${stage}".`);
  }
  for (const gateId of unexpectedRecommendedInCatalog) {
    issues.push(`unexpected gate "${gateId}" found in stageGateCatalog.recommended for stage "${stage}".`);
  }
  for (const gateId of missingConditionalInCatalog) {
    issues.push(`gate "${gateId}" missing from stageGateCatalog.conditional for stage "${stage}".`);
  }
  for (const gateId of unexpectedConditionalInCatalog) {
    issues.push(`unexpected gate "${gateId}" found in stageGateCatalog.conditional for stage "${stage}".`);
  }
  for (const gateId of catalogTriggered) {
    if (!conditionalSet.has(gateId)) {
      issues.push(`triggered gate "${gateId}" is not defined as conditional for stage "${stage}".`);
    }
  }

  const blockedSet = new Set(catalog.blocked);
  for (const gateId of catalog.passed) {
    if (!allowedSet.has(gateId)) {
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
    if (!allowedSet.has(gateId)) {
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
      const verdictConsistency = await checkReviewVerdictConsistency(projectRoot);
      if (!verdictConsistency.ok) {
        issues.push(`review verdict inconsistency: ${verdictConsistency.errors.join("; ")}`);
      }
    }
  }

  const passedSet = new Set(catalog.passed);
  const triggeredConditionalSet = new Set([
    ...catalogTriggered.filter((gateId) => conditionalSet.has(gateId)),
    ...catalog.passed.filter((gateId) => conditionalSet.has(gateId)),
    ...catalog.blocked.filter((gateId) => conditionalSet.has(gateId))
  ]);
  const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
  const missingRecommended = recommended.filter((gateId) => !passedSet.has(gateId));
  const missingTriggeredConditional = [...triggeredConditionalSet].filter((gateId) => !passedSet.has(gateId));
  const blockingBlocked = catalog.blocked.filter(
    (gateId) => requiredSet.has(gateId) || triggeredConditionalSet.has(gateId)
  );
  const complete = missingRequired.length === 0 && missingTriggeredConditional.length === 0 && blockingBlocked.length === 0;

  if (flowState.completedStages.includes(stage) && !complete) {
    if (missingRequired.length > 0) {
      issues.push(
        `stage "${stage}" is marked completed but required gates are not passed: ${missingRequired.join(", ")}.`
      );
    }
    if (missingTriggeredConditional.length > 0) {
      issues.push(
        `stage "${stage}" is marked completed but triggered conditional gates are not passed: ${missingTriggeredConditional.join(", ")}.`
      );
    }
    if (blockingBlocked.length > 0) {
      issues.push(
        `stage "${stage}" is marked completed but has blocking blocked gates: ${blockingBlocked.join(", ")}.`
      );
    }
  }

  return {
    ok: issues.length === 0,
    stage,
    issues,
    requiredCount: required.length,
    recommendedCount: recommended.length,
    conditionalCount: conditional.length,
    triggeredConditionalCount: triggeredConditionalSet.size,
    passedCount: catalog.passed.length,
    blockedCount: catalog.blocked.length,
    complete,
    missingRequired,
    missingRecommended,
    missingTriggeredConditional
  };
}

export function verifyCompletedStagesGateClosure(flowState: FlowState): CompletedStagesClosureResult {
  const issues: string[] = [];
  const openStages: CompletedStagesClosureResult["openStages"] = [];
  for (const stage of flowState.completedStages) {
    const schema = stageSchema(stage);
    const catalog = flowState.stageGateCatalog[stage];
    const required = schema.requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const conditional = schema.requiredGates
      .filter((gate) => gate.tier === "conditional")
      .map((gate) => gate.id);
    const conditionalSet = new Set(conditional);
    const passedSet = new Set(catalog.passed);
    const triggeredSet = new Set([
      ...(catalog.triggered ?? []).filter((gateId) => conditionalSet.has(gateId)),
      ...catalog.passed.filter((gateId) => conditionalSet.has(gateId)),
      ...catalog.blocked.filter((gateId) => conditionalSet.has(gateId))
    ]);
    const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
    const missingTriggeredConditional = [...triggeredSet].filter((gateId) => !passedSet.has(gateId));
    const blockingBlocked = catalog.blocked.filter(
      (gateId) => required.includes(gateId) || triggeredSet.has(gateId)
    );
    if (missingRequired.length > 0 || missingTriggeredConditional.length > 0 || blockingBlocked.length > 0) {
      openStages.push({
        stage,
        missingRequired,
        missingTriggeredConditional,
        blocked: [...blockingBlocked]
      });
      if (missingRequired.length > 0) {
        issues.push(
          `completed stage "${stage}" has unpassed required gates: ${missingRequired.join(", ")}.`
        );
      }
      if (missingTriggeredConditional.length > 0) {
        issues.push(
          `completed stage "${stage}" has unpassed triggered conditional gates: ${missingTriggeredConditional.join(", ")}.`
        );
      }
      if (blockingBlocked.length > 0) {
        issues.push(
          `completed stage "${stage}" still has blocking blocked gates: ${blockingBlocked.join(", ")}.`
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
  const required = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const recommended = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "recommended")
    .map((gate) => gate.id);
  const conditional = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "conditional")
    .map((gate) => gate.id);
  const requiredSet = new Set(required);
  const recommendedSet = new Set(recommended);
  const conditionalSet = new Set(conditional);
  const allowedSet = new Set([...required, ...recommended, ...conditional]);
  const catalog = flowState.stageGateCatalog[stage];
  const notes: string[] = [];

  const before: StageGateState = {
    required: [...catalog.required],
    recommended: [...catalog.recommended],
    conditional: [...catalog.conditional],
    triggered: [...catalog.triggered],
    passed: [...catalog.passed],
    blocked: [...catalog.blocked]
  };

  const passedSet = new Set(
    unique(catalog.passed).filter((gateId) => {
      const keep = allowedSet.has(gateId);
      if (!keep) {
        notes.push(`removed unknown passed gate "${gateId}"`);
      }
      return keep;
    })
  );
  const blockedSet = new Set(
    unique(catalog.blocked).filter((gateId) => {
      const keep = allowedSet.has(gateId);
      if (!keep) {
        notes.push(`removed unknown blocked gate "${gateId}"`);
      }
      return keep;
    })
  );
  const triggeredSet = new Set(
    unique(catalog.triggered).filter((gateId) => {
      const keep = conditionalSet.has(gateId);
      if (!keep) {
        notes.push(`removed unknown triggered gate "${gateId}"`);
      }
      return keep;
    })
  );
  for (const gateId of [...passedSet, ...blockedSet]) {
    if (conditionalSet.has(gateId)) {
      triggeredSet.add(gateId);
    }
  }

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
    recommended: [...recommended],
    conditional: [...conditional],
    triggered: conditional.filter((gateId) => triggeredSet.has(gateId)),
    passed: [...required, ...recommended, ...conditional].filter((gateId) => passedSet.has(gateId)),
    blocked: [...required, ...recommended, ...conditional].filter(
      (gateId) => blockedSet.has(gateId) && !passedSet.has(gateId)
    )
  };

  const changed =
    !sameStringArray(before.required, after.required) ||
    !sameStringArray(before.recommended, after.recommended) ||
    !sameStringArray(before.conditional, after.conditional) ||
    !sameStringArray(before.triggered, after.triggered) ||
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
