import { appendDelegation, readDelegationLedger } from "../../delegation.js";
import { stageAutoSubagentDispatch, type StageAutoSubagentDispatch } from "../../content/stage-schema.js";
import type { DiscoveryMode, FlowStage } from "../../types.js";
import type { RepoSignals } from "../../flow-state.js";

export interface ProactiveDelegationTraceResult {
  missingRules: StageAutoSubagentDispatch[];
}

function isEarlyElicitationStage(stage: FlowStage): boolean {
  return stage === "brainstorm" || stage === "scope" || stage === "design";
}

function isSparseRepoForResearcherSkip(repoSignals: RepoSignals | undefined): boolean {
  if (!repoSignals) return false;
  return repoSignals.fileCount < 5 && !repoSignals.hasReadme && !repoSignals.hasPackageManifest;
}

function skipRepoDependentProactiveRule(
  rule: StageAutoSubagentDispatch,
  stage: FlowStage,
  discoveryMode: DiscoveryMode,
  repoSignals: RepoSignals | undefined
): boolean {
  if (discoveryMode !== "deep") return false;
  if (stage !== "brainstorm" && stage !== "scope") return false;
  if (!rule.dependsOnInternalRepoSignals) return false;
  return isSparseRepoForResearcherSkip(repoSignals);
}

/**
 * Ensure every proactive dispatch rule for the stage has a ledger row for the
 * active run, or an explicit user-flag waiver.
 *
 * Lean/guided discovery on early elicitation stages intentionally does not
 * require a full proactive trace: specialists run only when triggers warrant
 * them. Deep discovery keeps the blanket trace so mandatory + proactive
 * coverage stays auditably complete before advance.
 */
export async function ensureProactiveDelegationTrace(
  projectRoot: string,
  stage: FlowStage,
  options: {
    acceptWaiver: boolean;
    waiverReason?: string;
    discoveryMode: DiscoveryMode;
    repoSignals?: RepoSignals;
  }
): Promise<ProactiveDelegationTraceResult> {
  if (isEarlyElicitationStage(stage) && (options.discoveryMode === "lean" || options.discoveryMode === "guided")) {
    return { missingRules: [] };
  }

  const proactiveRules = stageAutoSubagentDispatch(stage)
    .filter((rule) => rule.mode === "proactive")
    .filter((rule) => !skipRepoDependentProactiveRule(rule, stage, options.discoveryMode, options.repoSignals));
  if (proactiveRules.length === 0) return { missingRules: [] };

  const ledger = await readDelegationLedger(projectRoot);
  const currentRunEntries = ledger.entries.filter((entry) => entry.runId === ledger.runId);
  const missingRules = proactiveRules.filter(
    (rule) =>
      !currentRunEntries.some(
        (entry) => entry.stage === stage && entry.agent === rule.agent && entry.mode === "proactive"
      )
  );
  if (missingRules.length === 0) return { missingRules: [] };
  if (!options.acceptWaiver) return { missingRules };

  const waiverReason = options.waiverReason?.trim() || "accepted via --accept-proactive-waiver";
  for (const rule of missingRules) {
    await appendDelegation(projectRoot, {
      stage,
      agent: rule.agent,
      mode: "proactive",
      status: "waived",
      waiverReason,
      acceptedBy: "user-flag",
      conditionTrigger: rule.when,
      skill: rule.skill,
      ts: new Date().toISOString()
    });
  }
  return { missingRules: [] };
}
