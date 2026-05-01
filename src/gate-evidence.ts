import fs from "node:fs/promises";
import path from "node:path";
import {
  checkReviewSecurityNoChangeAttestation,
  checkReviewVerdictConsistency,
  extractMarkdownSectionBody,
  lintArtifact,
  validateReviewArmy
} from "./artifact-linter.js";
import { ELICITATION_STAGES, evaluateQaLogFloor } from "./artifact-linter/shared.js";
import { resolveArtifactPath } from "./artifact-paths.js";
import { RUNTIME_ROOT } from "./constants.js";
import { stageSchema } from "./content/stage-schema.js";
import { readDelegationLedger } from "./delegation.js";
import type { FlowState, StageGateState } from "./flow-state.js";
import { exists } from "./fs-utils.js";
import {
  computeEarlyLoopStatus,
  isEarlyLoopStage,
  normalizeEarlyLoopMaxIterations
} from "./early-loop.js";
import { detectPublicApiChanges } from "./internal/detect-public-api-changes.js";
import { readFlowState, writeFlowState } from "./runs.js";
import { parseTddCycleLog, validateTddCycleOrder } from "./tdd-cycle.js";
import { validateTddVerificationEvidence } from "./tdd-verification-evidence.js";
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

async function readStageArtifactMarkdown(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"]
): Promise<string | null> {
  const resolved = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  if (!(await exists(resolved.absPath))) {
    return null;
  }
  try {
    return await fs.readFile(resolved.absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Structured signal for the harness UI describing the adaptive
 * elicitation Q&A floor for the current stage. Always present on
 * brainstorm/scope/design verifications; null on other stages.
 *
 * Mirrors the `evaluateQaLogFloor` linter helper. Harness can render
 * `count / min` progress, surface stop-signal/skip-questions hints, and
 * differentiate between blocking and advisory.
 */
export interface QaLogFloorSignal {
  ok: boolean;
  count: number;
  min: number;
  hasStopSignal: boolean;
  liteShortCircuit: boolean;
  skipQuestionsAdvisory: boolean;
  blocking: boolean;
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
  /** Q&A floor signal for adaptive elicitation stages, null otherwise. */
  qaLogFloor: QaLogFloorSignal | null;
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

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function discoverRealTestCommands(projectRoot: string): Promise<string[]> {
  const commands: string[] = [];
  const packageJson = await readJsonFile(path.join(projectRoot, "package.json"));
  const scripts = packageJson?.scripts;
  if (scripts && typeof scripts === "object" && !Array.isArray(scripts)) {
    const scriptNames = Object.keys(scripts).filter((name) => {
      const value = (scripts as Record<string, unknown>)[name];
      return typeof value === "string" && (name === "test" || name.startsWith("test:"));
    });
    for (const name of scriptNames.sort()) {
      commands.push(name === "test" ? "npm test" : `npm run ${name}`);
      commands.push(name === "test" ? "pnpm test" : `pnpm ${name}`);
      commands.push(name === "test" ? "yarn test" : `yarn ${name}`);
      commands.push(name === "test" ? "bun test" : `bun run ${name}`);
    }
  }
  if (await exists(path.join(projectRoot, "pyproject.toml"))) commands.push("pytest");
  if (await exists(path.join(projectRoot, "pytest.ini"))) commands.push("pytest");
  if (await exists(path.join(projectRoot, "go.mod"))) commands.push("go test ./...");
  if (await exists(path.join(projectRoot, "Cargo.toml"))) commands.push("cargo test");
  if (await exists(path.join(projectRoot, "pom.xml"))) commands.push("mvn test");
  if (
    await exists(path.join(projectRoot, "build.gradle")) ||
    await exists(path.join(projectRoot, "build.gradle.kts"))
  ) {
    commands.push("gradle test", "./gradlew test");
  }
  return unique(commands);
}

async function verifyDiscoveredCommandEvidence(
  projectRoot: string,
  stage: FlowStage,
  gateId: string,
  flowState: FlowState
): Promise<string | null> {
  if (!(stage === "tdd" && gateId === "tdd_verified_before_complete")) {
    return null;
  }
  const commands = await discoverRealTestCommands(projectRoot);
  if (commands.length === 0) return null;
  const evidence = flowState.guardEvidence[gateId];
  const normalizedEvidence = typeof evidence === "string" ? evidence.toLowerCase() : "";
  const matched = commands.some((command) => normalizedEvidence.includes(command.toLowerCase()));
  if (matched) return null;
  return `${stage} verification gate blocked (${gateId}): guard evidence must cite one discovered real test command: ${commands.join(", ")}.`;
}

interface EarlyLoopGateSnapshot {
  stage: string;
  runId: string;
  iteration: number;
  maxIterations: number;
  openConcernIds: string[];
  openConcernCount: number;
  convergenceTripped: boolean;
  escalationReason?: string;
}

function toEarlyLoopGateSnapshot(value: unknown): EarlyLoopGateSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const typed = value as Record<string, unknown>;
  const stage = typeof typed.stage === "string" ? typed.stage : "";
  const runId = typeof typed.runId === "string" ? typed.runId : "active";
  const iteration = typeof typed.iteration === "number" && Number.isInteger(typed.iteration) && typed.iteration >= 0
    ? typed.iteration
    : 0;
  const maxIterations = normalizeEarlyLoopMaxIterations(
    typeof typed.maxIterations === "number" ? typed.maxIterations : undefined
  );
  const openConcernIds = Array.isArray(typed.openConcerns)
    ? typed.openConcerns
        .flatMap((concern) => {
          if (!concern || typeof concern !== "object" || Array.isArray(concern)) return [];
          const id = (concern as Record<string, unknown>).id;
          return typeof id === "string" && id.trim().length > 0 ? [id.trim()] : [];
        })
        .sort((a, b) => a.localeCompare(b, "en"))
    : [];
  if (stage.length === 0) return null;
  return {
    stage,
    runId,
    iteration,
    maxIterations,
    openConcernIds,
    openConcernCount: openConcernIds.length,
    convergenceTripped: typed.convergenceTripped === true,
    escalationReason:
      typeof typed.escalationReason === "string" && typed.escalationReason.trim().length > 0
        ? typed.escalationReason.trim()
        : undefined
  };
}

async function readEarlyLoopGateSnapshot(
  projectRoot: string,
  flowState: FlowState
): Promise<{ snapshot: EarlyLoopGateSnapshot | null; issue?: string }> {
  if (!isEarlyLoopStage(flowState.currentStage)) {
    return { snapshot: null };
  }
  const stateDir = path.join(projectRoot, RUNTIME_ROOT, "state");
  const statusPath = path.join(stateDir, "early-loop.json");
  let onDisk: EarlyLoopGateSnapshot | null = null;
  if (await exists(statusPath)) {
    try {
      onDisk = toEarlyLoopGateSnapshot(JSON.parse(await fs.readFile(statusPath, "utf8")));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        snapshot: null,
        issue:
          `early loop gate blocked (early_loop_open_concerns): unable to parse ${statusPath} (${reason}). ` +
          "Rebuild status with `cclaw internal early-loop-status --write`."
      };
    }
  }

  if (
    onDisk &&
    onDisk.stage === flowState.currentStage &&
    onDisk.runId === flowState.activeRunId
  ) {
    return { snapshot: onDisk };
  }

  try {
    const computed = await computeEarlyLoopStatus(
      flowState.currentStage,
      flowState.activeRunId,
      path.join(stateDir, "early-loop-log.jsonl")
    );
    return {
      snapshot: {
        stage: computed.stage,
        runId: computed.runId,
        iteration: computed.iteration,
        maxIterations: computed.maxIterations,
        openConcernIds: computed.openConcerns.map((concern) => concern.id),
        openConcernCount: computed.openConcerns.length,
        convergenceTripped: computed.convergenceTripped,
        escalationReason: computed.escalationReason
      }
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      snapshot: null,
      issue:
        `early loop gate blocked (early_loop_open_concerns): unable to compute status from early-loop-log.jsonl (${reason}).`
    };
  }
}

const DESIGN_RESEARCH_REQUIRED_SECTIONS = [
  "Stack Analysis",
  "Features & Patterns",
  "Architecture Options",
  "Pitfalls & Risks",
  "Synthesis"
] as const;

export interface VerifyCurrentStageGateEvidenceOptions {
  /** Extra stage flags propagated from the in-flight CLI args (e.g. `--skip-questions`). */
  extraStageFlags?: string[];
}

export async function verifyCurrentStageGateEvidence(
  projectRoot: string,
  flowState: FlowState,
  options: VerifyCurrentStageGateEvidenceOptions = {}
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
  const softNotices: string[] = [];

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
      continue;
    }
    if (stage === "tdd" && gateId === "tdd_verified_before_complete") {
      const verification = await validateTddVerificationEvidence(projectRoot, evidence);
      if (!verification.ok) {
        issues.push(
          `tdd verification gate blocked (${gateId}): ${verification.issues.join(" ")}`
        );
      }
    }
    const discoveredCommandIssue = await verifyDiscoveredCommandEvidence(projectRoot, stage, gateId, flowState);
    if (discoveredCommandIssue) {
      issues.push(discoveredCommandIssue);
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
    const lint = await lintArtifact(projectRoot, stage, flowState.track, {
      extraStageFlags: options.extraStageFlags
    });
    if (!lint.passed) {
      const failedRequiredFindings = lint.findings
        .filter((finding) => finding.required && !finding.found);
      const failedRequired = failedRequiredFindings.map((finding) => finding.section);
      if (failedRequired.length > 0) {
        const failureDetails = failedRequiredFindings
          .map((finding) => {
            const details = finding.details?.trim();
            const rule = finding.rule?.trim();
            const explanation = details && details.length > 0 ? details : rule;
            return explanation && explanation.length > 0
              ? `${finding.section}: ${explanation}`
              : finding.section;
          })
          .join("; ");
        issues.push(
          `artifact validation failed for required sections: ${failedRequired.join(", ")}. ${failureDetails}`
        );
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
    }
    if (stage === "design") {
      const researchGateRequired = schema.requiredGates.some(
        (gate) => gate.id === "design_research_complete" && gate.tier === "required"
      );
      if (researchGateRequired) {
        const designMarkdown = await readStageArtifactMarkdown(projectRoot, "design", flowState.track);
        const inlineResearchBody = designMarkdown
          ? extractMarkdownSectionBody(designMarkdown, "Research Fleet Synthesis")
          : null;
        const inlineResearchLines = inlineResearchBody
          ? inlineResearchBody
            .split(/\r?\n/gu)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .filter((line) => !/^\|?(?:[-:\s|])+$/u.test(line))
            .filter((line) =>
              !/\b(?:TODO|TBD|FIXME|pending)\b/iu.test(line) &&
              !/<fill-in>/iu.test(line) &&
              !/^>\s*Default path:/iu.test(line) &&
              !/^\|\s*compact inline synthesis\s*\|\s*\|\s*\|\s*\|?\s*$/iu.test(line)
            )
          : [];
        const inlineResearchComplete = inlineResearchLines.length > 0;
        const researchMarkdown = await readArtifactMarkdown(projectRoot, "02a-research.md");
        if (!inlineResearchComplete && !researchMarkdown) {
          issues.push(
            "design research gate blocked (design_research_complete): fill `Research Fleet Synthesis` in the active design artifact, or write `.cclaw/artifacts/02a-research.md` for deep/high-risk research."
          );
        } else if (researchMarkdown) {
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

  if (isEarlyLoopStage(stage)) {
    const { snapshot, issue } = await readEarlyLoopGateSnapshot(projectRoot, flowState);
    if (issue) {
      issues.push(issue);
    } else if (snapshot && snapshot.openConcernCount > 0) {
      const concernTail = snapshot.openConcernIds.length > 3
        ? `, +${snapshot.openConcernIds.length - 3} more`
        : "";
      const concernSample = snapshot.openConcernIds.slice(0, 3).join(", ");
      if (snapshot.convergenceTripped) {
        const reason = snapshot.escalationReason ?? "convergence guard tripped";
        softNotices.push(
          `early loop escalation notice (early_loop_open_concerns): ${reason}; ` +
            `open concerns remain (${concernSample}${concernTail}). Request explicit human override before advancing.`
        );
      } else {
        issues.push(
          `early loop gate blocked (early_loop_open_concerns): ` +
            `${snapshot.openConcernCount} open concern(s) remain after iteration ` +
            `${snapshot.iteration}/${snapshot.maxIterations} (${concernSample}${concernTail}).`
        );
      }
    }
  }

  const missingRequired = required.filter((gateId) => !passedSet.has(gateId));
  const missingRecommended = [
    ...recommended.filter((gateId) => !passedSet.has(gateId)),
    ...softNotices
  ];
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

  let qaLogFloor: QaLogFloorSignal | null = null;
  if (ELICITATION_STAGES.has(stage)) {
    let qaLogBody: string | null = null;
    try {
      const stageMd = await readStageArtifactMarkdown(projectRoot, stage, flowState.track);
      qaLogBody = stageMd
        ? extractMarkdownSectionBody(stageMd, "Q&A Log")
        : null;
    } catch {
      qaLogBody = null;
    }
    const skipQuestionsHint =
      flowState.interactionHints?.[stage]?.skipQuestions === true ||
      (options.extraStageFlags ?? []).includes("--skip-questions");
    const floor = evaluateQaLogFloor(qaLogBody, flowState.track, stage, {
      skipQuestions: skipQuestionsHint
    });
    qaLogFloor = {
      ok: floor.ok,
      count: floor.count,
      min: floor.min,
      hasStopSignal: floor.hasStopSignal,
      liteShortCircuit: floor.liteShortCircuit,
      skipQuestionsAdvisory: floor.skipQuestionsAdvisory,
      blocking: !floor.ok && !floor.skipQuestionsAdvisory
    };
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
    missingTriggeredConditional,
    qaLogFloor
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
  if (reconciliation.changed) {
    await writeFlowState(projectRoot, nextState);
  }
  return {
    ...reconciliation,
    wrote: reconciliation.changed
  };
}
