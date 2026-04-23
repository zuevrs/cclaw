import fs from "node:fs/promises";
import path from "node:path";
import {
  checkReviewSecurityNoChangeAttestation,
  checkReviewVerdictConsistency,
  extractMarkdownSectionBody,
  lintArtifact,
  validateReviewArmy
} from "./artifact-linter.js";
import { resolveArtifactPath } from "./artifact-paths.js";
import { RUNTIME_ROOT } from "./constants.js";
import { stageSchema } from "./content/stage-schema.js";
import { readDelegationLedger } from "./delegation.js";
import type { FlowState, StageGateState } from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { detectPublicApiChanges } from "./internal/detect-public-api-changes.js";
import { readFlowState, writeFlowState } from "./runs.js";
import { parseTddCycleLog, validateTddCycleOrder } from "./tdd-cycle.js";
import { buildTraceMatrix } from "./trace-matrix.js";
import { FLOW_STAGES, type FlowStage } from "./types.js";

async function currentStageArtifactExists(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"]
): Promise<boolean> {
  const resolved = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  return exists(resolved.absPath);
}

async function readArtifactMarkdown(projectRoot: string, artifactFile: string): Promise<string | null> {
  const candidates = [
    path.join(projectRoot, RUNTIME_ROOT, "artifacts", artifactFile),
    path.join(projectRoot, artifactFile)
  ];
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {
      // Try next location.
    }
  }
  return null;
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

const RECONCILIATION_NOTICES_FILE = "reconciliation-notices.json";
const RECONCILIATION_NOTICES_SCHEMA_VERSION = 1;
const DESIGN_RESEARCH_REQUIRED_SECTIONS = [
  "Stack Analysis",
  "Features & Patterns",
  "Architecture Options",
  "Pitfalls & Risks",
  "Synthesis"
] as const;

export const RECONCILIATION_NOTICES_REL_PATH = `${RUNTIME_ROOT}/state/${RECONCILIATION_NOTICES_FILE}`;

export interface ReconciliationNotice {
  id: string;
  runId: string;
  stage: FlowStage;
  gateId: string;
  reason: string;
  demotedAt: string;
}

export interface ReconciliationNoticesPayload {
  schemaVersion: number;
  notices: ReconciliationNotice[];
  parseOk: boolean;
  schemaOk: boolean;
}

export interface ReconciliationNoticeBuckets {
  activeBlocked: ReconciliationNotice[];
  currentStageBlocked: ReconciliationNotice[];
  unsynced: ReconciliationNotice[];
  staleRun: ReconciliationNotice[];
}

function isFlowStageValue(value: unknown): value is FlowStage {
  return typeof value === "string" && (FLOW_STAGES as readonly string[]).includes(value);
}

function reconciliationNoticesPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", RECONCILIATION_NOTICES_FILE);
}

function defaultReconciliationNoticesPayload(): ReconciliationNoticesPayload {
  return {
    schemaVersion: RECONCILIATION_NOTICES_SCHEMA_VERSION,
    notices: [],
    parseOk: true,
    schemaOk: true
  };
}

function sanitizeReconciliationNotice(raw: unknown): ReconciliationNotice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const typed = raw as Record<string, unknown>;
  if (
    typeof typed.id !== "string" ||
    typeof typed.runId !== "string" ||
    !isFlowStageValue(typed.stage) ||
    typeof typed.gateId !== "string" ||
    typeof typed.reason !== "string" ||
    typeof typed.demotedAt !== "string"
  ) {
    return null;
  }
  return {
    id: typed.id,
    runId: typed.runId,
    stage: typed.stage,
    gateId: typed.gateId,
    reason: typed.reason,
    demotedAt: typed.demotedAt
  };
}

export async function readReconciliationNotices(
  projectRoot: string
): Promise<ReconciliationNoticesPayload> {
  const filePath = reconciliationNoticesPath(projectRoot);
  if (!(await exists(filePath))) {
    return defaultReconciliationNoticesPayload();
  }
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    const schemaOk = raw.schemaVersion === RECONCILIATION_NOTICES_SCHEMA_VERSION;
    const notices = Array.isArray(raw.notices)
      ? raw.notices
          .map((value) => sanitizeReconciliationNotice(value))
          .filter((value): value is ReconciliationNotice => value !== null)
      : [];
    return {
      schemaVersion: RECONCILIATION_NOTICES_SCHEMA_VERSION,
      notices,
      parseOk: true,
      schemaOk
    };
  } catch {
    return {
      ...defaultReconciliationNoticesPayload(),
      parseOk: false,
      schemaOk: false
    };
  }
}

async function writeReconciliationNotices(
  projectRoot: string,
  payload: ReconciliationNoticesPayload
): Promise<void> {
  const filePath = reconciliationNoticesPath(projectRoot);
  await ensureDir(path.dirname(filePath));
  await writeFileSafe(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: RECONCILIATION_NOTICES_SCHEMA_VERSION,
        notices: payload.notices
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
}

export function classifyReconciliationNotices(
  flowState: FlowState,
  notices: ReconciliationNotice[]
): ReconciliationNoticeBuckets {
  const activeBlocked: ReconciliationNotice[] = [];
  const currentStageBlocked: ReconciliationNotice[] = [];
  const unsynced: ReconciliationNotice[] = [];
  const staleRun: ReconciliationNotice[] = [];
  for (const notice of notices) {
    if (notice.runId !== flowState.activeRunId) {
      staleRun.push(notice);
      continue;
    }
    const stageCatalog = flowState.stageGateCatalog[notice.stage];
    const blocked = stageCatalog.blocked.includes(notice.gateId);
    if (!blocked) {
      unsynced.push(notice);
      continue;
    }
    activeBlocked.push(notice);
    if (notice.stage === flowState.currentStage) {
      currentStageBlocked.push(notice);
    }
  }
  return { activeBlocked, currentStageBlocked, unsynced, staleRun };
}

export async function verifyCurrentStageGateEvidence(
  projectRoot: string,
  flowState: FlowState
): Promise<GateEvidenceCheckResult> {
  const stage = flowState.currentStage;
  const schema = stageSchema(stage, flowState.track);
  const catalog = flowState.stageGateCatalog[stage];
  const required = schema.requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const recommended = schema.requiredGates
    .filter((gate) => gate.tier === "recommended")
    .map((gate) => gate.id);
  const conditional: string[] = [];
  const requiredSet = new Set(required);
  const recommendedSet = new Set(recommended);
  const allowedSet = new Set([...required, ...recommended]);
  const issues: string[] = [];

  const catalogRequired = unique(catalog.required);
  const catalogRecommended = unique(catalog.recommended ?? []);
  const catalogConditional = unique(catalog.conditional ?? []);
  const catalogTriggered = unique(catalog.triggered ?? []);
  const missingInCatalog = required.filter((gateId) => !catalogRequired.includes(gateId));
  const unexpectedInCatalog = catalogRequired.filter((gateId) => !requiredSet.has(gateId));
  const missingRecommendedInCatalog = recommended.filter((gateId) => !catalogRecommended.includes(gateId));
  const unexpectedRecommendedInCatalog = catalogRecommended.filter((gateId) => !recommendedSet.has(gateId));
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
  for (const gateId of catalogConditional) {
    issues.push(
      `stale conditional gate "${gateId}" found in stageGateCatalog.conditional for stage "${stage}" (conditional gate DSL removed).`
    );
  }
  for (const gateId of catalogTriggered) {
    issues.push(
      `stale triggered conditional gate "${gateId}" found in stageGateCatalog.triggered for stage "${stage}" (conditional gate DSL removed).`
    );
  }

  const blockedSet = new Set(catalog.blocked);
  const passedSet = new Set(catalog.passed);
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

  const artifactPresent = await currentStageArtifactExists(projectRoot, stage, flowState.track);
  const shouldValidateArtifact =
    artifactPresent || catalog.passed.length > 0 || flowState.completedStages.includes(stage);
  if (shouldValidateArtifact) {
    const lint = await lintArtifact(projectRoot, stage, flowState.track);
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
      const reviewCriticalsClaimedResolved =
        passedSet.has("review_criticals_resolved") || flowState.completedStages.includes("review");
      const unresolvedCriticals =
        verdictConsistency.openCriticalCount > 0 || verdictConsistency.shipBlockerCount > 0;
      if (reviewCriticalsClaimedResolved && unresolvedCriticals) {
        issues.push(
          `review criticals gate blocked (review_criticals_resolved): review-army still reports ` +
            `${verdictConsistency.openCriticalCount} open critical(s) and ` +
            `${verdictConsistency.shipBlockerCount} ship blocker(s).`
        );
      }
      const securityAttestation = await checkReviewSecurityNoChangeAttestation(projectRoot);
      if (!securityAttestation.ok) {
        issues.push(`review security attestation failed: ${securityAttestation.errors.join("; ")}`);
      }
      const traceGateRequired = schema.requiredGates.some(
        (gate) => gate.id === "review_trace_matrix_clean" && gate.tier === "required"
      );
      if (traceGateRequired) {
        const trace = await buildTraceMatrix(projectRoot);
        const traceIssues: string[] = [];
        if (trace.orphanedCriteria.length > 0) {
          traceIssues.push(`orphaned criteria: ${trace.orphanedCriteria.join(", ")}`);
        }
        if (trace.orphanedTasks.length > 0) {
          traceIssues.push(`orphaned tasks: ${trace.orphanedTasks.join(", ")}`);
        }
        if (trace.orphanedTests.length > 0) {
          traceIssues.push(`orphaned tests: ${trace.orphanedTests.join(", ")}`);
        }
        if (traceIssues.length > 0) {
          issues.push(
            `review trace-matrix gate blocked (review_trace_matrix_clean): ${traceIssues.join("; ")}.`
          );
        }
      }
    }
    if (stage === "design") {
      const researchGateRequired = schema.requiredGates.some(
        (gate) => gate.id === "design_research_complete" && gate.tier === "required"
      );
      if (researchGateRequired) {
        const researchMarkdown = await readArtifactMarkdown(projectRoot, "02a-research.md");
        if (!researchMarkdown) {
          issues.push(
            "design research gate blocked (design_research_complete): missing `.cclaw/artifacts/02a-research.md`."
          );
        } else {
          const missingSections: string[] = [];
          for (const section of DESIGN_RESEARCH_REQUIRED_SECTIONS) {
            const body = extractMarkdownSectionBody(researchMarkdown, section);
            if (body === null) {
              missingSections.push(section);
              continue;
            }
            const meaningfulLines = body
              .split(/\r?\n/gu)
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .filter((line) => !/^\|?(?:[-:\s|])+$/u.test(line));
            // `<fill-in>` needs its own check because `\b` does not match
            // around `<`/`>` (non-word characters), so the previous combined
            // pattern `\b(?:...|<fill-in>)\b` silently never matched placeholder
            // templates that used angle-bracket form.
            const nonPlaceholder = meaningfulLines.filter(
              (line) =>
                !/\b(?:TODO|TBD|FIXME|pending)\b/iu.test(line) &&
                !/<fill-in>/iu.test(line)
            );
            if (nonPlaceholder.length === 0) {
              missingSections.push(`${section} (empty or placeholder)`);
            }
          }
          if (missingSections.length > 0) {
            issues.push(
              `design research gate blocked (design_research_complete): ${missingSections.join(", ")}.`
            );
          }
        }
      }
    }
    if (stage === "tdd") {
      const docsDriftDetection = await detectPublicApiChanges(projectRoot);
      if (docsDriftDetection.triggered) {
        const ledger = await readDelegationLedger(projectRoot);
        const hasDocUpdaterCompletion = ledger.entries.some((entry) =>
          entry.runId === flowState.activeRunId &&
          entry.stage === "tdd" &&
          entry.agent === "doc-updater" &&
          entry.status === "completed"
        );
        if (!hasDocUpdaterCompletion) {
          issues.push(
            `tdd docs drift gate blocked (tdd_docs_drift_check): public surface changes detected (${docsDriftDetection.changedFiles.join(", ")}) but no completed doc-updater delegation exists for the active run.`
          );
        }
      }
      const tddLogPath = path.join(projectRoot, RUNTIME_ROOT, "state", "tdd-cycle-log.jsonl");
      if (await exists(tddLogPath)) {
        try {
          const tddLogRaw = await fs.readFile(tddLogPath, "utf8");
          const parsedCycles = parseTddCycleLog(tddLogRaw);
          const tddOrderValidation = validateTddCycleOrder(parsedCycles, {
            runId: flowState.activeRunId
          });
          if (!tddOrderValidation.ok) {
            const details: string[] = [...tddOrderValidation.issues];
            if (tddOrderValidation.openRedSlices.length > 0) {
              details.push(`open red slices: ${tddOrderValidation.openRedSlices.join(", ")}`);
            }
            issues.push(`tdd cycle order gate blocked: ${details.join("; ")}`);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          issues.push(`tdd cycle order gate blocked: unable to read tdd-cycle-log.jsonl (${reason}).`);
        }
      }
    }
  }

  const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
  const missingRecommended = recommended.filter((gateId) => !passedSet.has(gateId));
  const missingTriggeredConditional: string[] = [];
  const blockingBlocked = catalog.blocked.filter((gateId) => requiredSet.has(gateId));
  const complete = missingRequired.length === 0 && blockingBlocked.length === 0;

  if (flowState.completedStages.includes(stage) && !complete) {
    if (missingRequired.length > 0) {
      issues.push(
        `stage "${stage}" is marked completed but required gates are not passed: ${missingRequired.join(", ")}.`
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
    triggeredConditionalCount: 0,
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
    const schema = stageSchema(stage, flowState.track);
    const catalog = flowState.stageGateCatalog[stage];
    const required = schema.requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    const passedSet = new Set(catalog.passed);
    const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
    const missingTriggeredConditional: string[] = [];
    const blockingBlocked = catalog.blocked.filter((gateId) => required.includes(gateId));
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
  demotedGateIds: string[];
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
  const schema = stageSchema(stage, flowState.track);
  const required = schema.requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const recommended = schema.requiredGates
    .filter((gate) => gate.tier === "recommended")
    .map((gate) => gate.id);
  const conditional: string[] = [];
  const requiredSet = new Set(required);
  const recommendedSet = new Set(recommended);
  const allowedSet = new Set([...required, ...recommended]);
  const catalog = flowState.stageGateCatalog[stage];
  const notes: string[] = [];
  const demotedGateIds = new Set<string>();

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
  const staleConditional = unique(catalog.conditional).filter((gateId) => !allowedSet.has(gateId));
  for (const gateId of staleConditional) {
    notes.push(`removed stale conditional gate "${gateId}" (conditional gate DSL removed)`);
  }
  const staleTriggered = unique(catalog.triggered);
  for (const gateId of staleTriggered) {
    notes.push(`removed stale triggered gate "${gateId}" (conditional gate DSL removed)`);
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
    demotedGateIds.add(gateId);
    notes.push(`resolved overlap for "${gateId}" in favor of blocked (missing evidence)`);
  }

  for (const gateId of [...passedSet]) {
    const evidence = flowState.guardEvidence[gateId];
    if (typeof evidence === "string" && evidence.trim().length > 0) continue;
    passedSet.delete(gateId);
    blockedSet.add(gateId);
    demotedGateIds.add(gateId);
    notes.push(`moved "${gateId}" from passed to blocked (missing evidence)`);
  }

  const after: StageGateState = {
    required: [...required],
    recommended: [...recommended],
    conditional: [...conditional],
    triggered: [],
    passed: [...required, ...recommended].filter((gateId) => passedSet.has(gateId)),
    blocked: [...required, ...recommended].filter(
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
      demotedGateIds: [...required, ...recommended].filter((gateId) => demotedGateIds.has(gateId)),
      notes
    }
  };
}

export async function reconcileAndWriteCurrentStageGateCatalog(
  projectRoot: string
): Promise<GateReconciliationWritebackResult> {
  const state = await readFlowState(projectRoot);
  const { nextState, reconciliation } = reconcileCurrentStageGateCatalog(state);
  const effectiveState = reconciliation.changed ? nextState : state;
  if (reconciliation.changed) {
    await writeFlowState(projectRoot, effectiveState);
  }
  const noticesPayload = await readReconciliationNotices(projectRoot);
  let noticesChanged = false;

  const noticeBuckets = classifyReconciliationNotices(effectiveState, noticesPayload.notices);
  if (noticeBuckets.unsynced.length > 0 || noticeBuckets.staleRun.length > 0) {
    const dropIds = new Set(
      [...noticeBuckets.unsynced, ...noticeBuckets.staleRun].map((notice) => notice.id)
    );
    noticesPayload.notices = noticesPayload.notices.filter((notice) => !dropIds.has(notice.id));
    noticesChanged = true;
  }

  if (reconciliation.demotedGateIds.length > 0) {
    const existing = new Set(
      noticesPayload.notices.map((notice) => `${notice.runId}:${notice.stage}:${notice.gateId}`)
    );
    for (const gateId of reconciliation.demotedGateIds) {
      const dedupeKey = `${effectiveState.activeRunId}:${reconciliation.stage}:${gateId}`;
      if (existing.has(dedupeKey)) {
        continue;
      }
      const ts = new Date().toISOString();
      noticesPayload.notices.push({
        id: `${dedupeKey}:${ts}`,
        runId: effectiveState.activeRunId,
        stage: reconciliation.stage,
        gateId,
        reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
        demotedAt: ts
      });
      existing.add(dedupeKey);
      noticesChanged = true;
    }
  }

  if (noticesChanged) {
    noticesPayload.notices.sort((a, b) => {
      if (a.demotedAt === b.demotedAt) {
        return a.id.localeCompare(b.id);
      }
      return a.demotedAt.localeCompare(b.demotedAt);
    });
    await writeReconciliationNotices(projectRoot, noticesPayload);
  }
  return {
    ...reconciliation,
    wrote: reconciliation.changed
  };
}
