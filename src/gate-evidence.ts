import { lintArtifact, validateReviewArmy } from "./artifact-linter.js";
import { stageSchema } from "./content/stage-schema.js";
import type { FlowState } from "./flow-state.js";
import type { FlowStage } from "./types.js";

export interface GateEvidenceCheckResult {
  ok: boolean;
  stage: FlowStage;
  issues: string[];
  requiredCount: number;
  passedCount: number;
  blockedCount: number;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

  const shouldValidateArtifact = catalog.passed.length > 0 || flowState.completedStages.includes(stage);
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

  return {
    ok: issues.length === 0,
    stage,
    issues,
    requiredCount: required.length,
    passedCount: catalog.passed.length,
    blockedCount: catalog.blocked.length
  };
}
