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

function proactiveRulesForDiscoveryMode(
  stage: FlowStage,
  discoveryMode: DiscoveryMode
): StageAutoSubagentDispatch[] {
  const proactiveRules = stageAutoSubagentDispatch(stage).filter((rule) => rule.mode === "proactive");
  if (isEarlyElicitationStage(stage) && (discoveryMode === "lean" || discoveryMode === "guided")) {
    return proactiveRules.filter((rule) => rule.essentialAcrossModes === true);
  }
  return proactiveRules;
}

/**
 * Ensure every proactive dispatch rule for the stage has a ledger row for the
 * active run, or an explicit user-flag waiver.
 *
 * Lean/guided discovery on brainstorm/scope/design keeps only proactive rules
 * marked `essentialAcrossModes` (researcher today) so external research stays
 * auditable without requiring every discretionary proactive lens. Deep
 * discovery evaluates the full proactive matrix.
 */
export async function ensureProactiveDelegationTrace(
  projectRoot: string,
  stage: FlowStage,
  options: {
    acceptWaiver: boolean;
    waiverReason?: string;
    approvalToken?: string;
    approvalReason?: string;
    approvalIssuedAt?: string;
    discoveryMode: DiscoveryMode;
    repoSignals?: RepoSignals;
  }
): Promise<ProactiveDelegationTraceResult> {
  void options.repoSignals;
  const proactiveRules = proactiveRulesForDiscoveryMode(stage, options.discoveryMode);
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

  const approvalToken = options.approvalToken?.trim();
  const approvalReason = options.approvalReason?.trim();
  const waiverReason =
    options.waiverReason?.trim() ||
    approvalReason ||
    "accepted via --accept-proactive-waiver";
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
      ...(approvalToken ? { approvalToken } : {}),
      ...(approvalReason ? { approvalReason } : {}),
      ...(options.approvalIssuedAt ? { approvalIssuedAt: options.approvalIssuedAt } : {}),
      ts: new Date().toISOString()
    });
  }
  return { missingRules: [] };
}
