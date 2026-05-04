import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath as resolveStageArtifactPath } from "./artifact-paths.js";
import {
  effectiveIntegrationOverseerMode,
  effectiveTddCheckpointMode,
  effectiveWorktreeExecutionMode,
  type FlowState
} from "./flow-state.js";
import { exists } from "./fs-utils.js";
import { stageSchema } from "./content/stage-schema.js";
import { readFlowState } from "./run-persistence.js";
import type { FlowStage, FlowTrack } from "./types.js";
import {
  duplicateH2Headings,
  extractEvidencePointers,
  extractH2Sections,
  extractRequirementIdsFromMarkdown,
  isShortCircuitActivated,
  normalizeHeadingTitle,
  parseFrontmatter,
  parseLearningsSection,
  sectionBodyByAnyName,
  sectionBodyByHeadingPrefix,
  sectionBodyByName,
  validateSectionBody,
  formatLearningsErrorsBullets,
  type H2SectionMap,
  type LintFinding,
  type LintResult,
  type StageLintContext,
  type TddEvidencePointerOptions
} from "./artifact-linter/shared.js";
import { shouldDemoteArtifactValidationByTrack } from "./content/stage-schema.js";
import { readDelegationLedger, recordArtifactValidationDemotedByTrack } from "./delegation.js";
import {
  classifyAndPersistFindings,
  type LintRunDedupResult
} from "./artifact-linter/findings-dedup.js";
import { lintBrainstormStage } from "./artifact-linter/brainstorm.js";
import { lintDesignStage } from "./artifact-linter/design.js";
import { lintPlanStage } from "./artifact-linter/plan.js";
import { lintScopeStage } from "./artifact-linter/scope.js";
import { lintSpecStage } from "./artifact-linter/spec.js";
import { lintTddStage } from "./artifact-linter/tdd.js";
import { lintReviewStage } from "./artifact-linter/review.js";
import { lintShipStage } from "./artifact-linter/ship.js";

export {
  validateReviewArmy,
  checkReviewVerdictConsistency,
  checkReviewSecurityNoChangeAttestation,
  checkReviewTddNoCrossArtifactDuplication,
  type ReviewVerdictConsistencyResult,
  type ReviewSecurityNoChangeAttestationResult,
  type ReviewTddDuplicationConflict,
  type ReviewTddDuplicationResult
} from "./artifact-linter/review-army.js";

export {
  type LintFinding,
  type LintResult,
  type LearningEntryType,
  type LearningConfidence,
  type LearningSeverity,
  type LearningSource,
  type LearningSeedEntry,
  type LearningsParseResult,
  extractAuthoredBody,
  formatLearningsErrorsBullets,
  learningsParseFailureHumanSummary,
  extractMarkdownSectionBody,
  parseLearningsSection
} from "./artifact-linter/shared.js";

const FRONTMATTER_REQUIRED_KEYS = [
  "stage",
  "schema_version",
  "version",
  "locked_decisions",
  "inputs_hash"
] as const;

export interface LintArtifactOptions {
  /**
   * Stage-level flags supplied by the caller (typically `advance-stage`)
   * that augment whatever flow-state.json says. Used so the linter sees
   * `--skip-questions` even before flow-state is updated for the current
   * stage (advance-stage applies the hint to the successor stage only,
   * but the linter must respect the current-call intent).
   */
  extraStageFlags?: string[];
}

export async function lintArtifact(
  projectRoot: string,
  stage: FlowStage,
  track: FlowTrack = "standard",
  options: LintArtifactOptions = {}
): Promise<LintResult> {
  const schema = stageSchema(stage, track);
  const { absPath: absFile, relPath: relFile } = await resolveStageArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
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
  const sections = extractH2Sections(raw);
  const duplicateHeadings = duplicateH2Headings(raw);
  if (duplicateHeadings.length > 0) {
    findings.push({
      section: "duplicate_h2_heading",
      required: false,
      rule: "[P3] keep each `##` heading unique within an artifact; append updates to the existing section instead of cloning headings.",
      found: false,
      details: `Duplicate H2 heading(s): ${duplicateHeadings.join(", ")}. Merge edits into the existing heading to avoid split contracts.`
    });
  }
  const parsedFrontmatter = parseFrontmatter(raw);
  const frontmatterMissingKeys: string[] = FRONTMATTER_REQUIRED_KEYS.filter((key) => {
    const value = parsedFrontmatter.values[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (
    parsedFrontmatter.hasFrontmatter &&
    typeof parsedFrontmatter.values.run !== "string" &&
    typeof parsedFrontmatter.values.feature !== "string"
  ) {
    frontmatterMissingKeys.push("run");
  }
  const frontmatterStage = parsedFrontmatter.values.stage?.replace(/^['"]|['"]$/gu, "");
  const frontmatterSchemaVersion = parsedFrontmatter.values.schema_version?.replace(/^['"]|['"]$/gu, "");
  const frontmatterInputsHash = parsedFrontmatter.values.inputs_hash?.replace(/^['"]|['"]$/gu, "");
  const frontmatterValid =
    parsedFrontmatter.hasFrontmatter &&
    frontmatterMissingKeys.length === 0 &&
    frontmatterStage === stage &&
    frontmatterSchemaVersion === "1" &&
    /^sha256:(?:pending|[a-f0-9]{64})$/iu.test(frontmatterInputsHash ?? "");
  const requireFrontmatter = parsedFrontmatter.hasFrontmatter;
  findings.push({
    section: "Frontmatter",
    required: requireFrontmatter,
    rule: "Artifact must include frontmatter keys (stage, schema_version=1, version, run, locked_decisions, inputs_hash=sha256:pending|sha256:<64hex>). Legacy feature is accepted during migration.",
    found: parsedFrontmatter.hasFrontmatter ? frontmatterValid : true,
    details: !parsedFrontmatter.hasFrontmatter
      ? "Legacy artifact without YAML frontmatter (allowed for backward compatibility)."
      : frontmatterMissingKeys.length > 0
        ? `Frontmatter missing required key(s): ${frontmatterMissingKeys.join(", ")}.`
        : frontmatterStage !== stage
          ? `Frontmatter stage must be "${stage}" (found "${frontmatterStage ?? "(missing)"}").`
          : frontmatterSchemaVersion !== "1"
            ? `Frontmatter schema_version must be "1" (found "${frontmatterSchemaVersion ?? "(missing)"}").`
            : !/^sha256:(?:pending|[a-f0-9]{64})$/iu.test(frontmatterInputsHash ?? "")
              ? "Frontmatter inputs_hash must be sha256:pending or sha256:<64 hex chars>."
              : "Frontmatter integrity checks passed."
  });

  const brainstormShortCircuitBody =
    stage === "brainstorm" ? sectionBodyByName(sections, "Short-Circuit Decision") : null;
  const brainstormShortCircuitActivated =
    stage === "brainstorm" && isShortCircuitActivated(brainstormShortCircuitBody);
  const scopePreAuditEnabled = true;
  const staleDiagramAuditEnabled = true;
  const isTrivialOverride = Boolean(
    schema.trivialOverrideSections &&
    schema.trivialOverrideSections.length > 0 &&
    (
      /trivial.change|mini.design|escape.hatch/iu.test(raw) ||
      brainstormShortCircuitActivated
    )
  );
  const overrideSet = isTrivialOverride
    ? new Set(schema.trivialOverrideSections!.map((s) => normalizeHeadingTitle(s).toLowerCase()))
    : null;

  // Wave 25: precompute the lite-tier signal so the per-section
  // validators (Interaction Edge Case matrix today, others tomorrow)
  // can relax network-dependent mandatory rows for lite/quick/bugfix
  // runs without each validator having to re-derive the predicate.
  // Same flow-state read powers the post-loop demotion + audit log
  // below; we cache the result here to avoid two disk reads.
  let activeStageFlags: string[] = [];
  let discoveryMode: StageLintContext["discoveryMode"] = "guided";
  let taskClass: StageLintContext["taskClass"] = null;
  let activeRunId: string | null = null;
  let completedStagesForAudit: FlowStage[] = [];
  let completedStageMetaForAudit: FlowState["completedStageMeta"];
  let legacyContinuation = false;
  let worktreeExecutionMode: "single-tree" | "worktree-first" = "single-tree";
  let tddCheckpointMode: "per-slice" | "global-red" = "per-slice";
  let integrationOverseerMode: "conditional" | "always" = "always";
  let tddCutoverSliceId = "";
  let tddWorktreeCutoverSliceId = "";
  try {
    const flowState = await readFlowState(projectRoot);
    const hint = flowState.interactionHints?.[stage];
    if (hint?.skipQuestions === true) activeStageFlags.push("--skip-questions");
    discoveryMode = flowState.discoveryMode ?? "guided";
    taskClass = flowState.taskClass ?? null;
    activeRunId = flowState.activeRunId ?? null;
    completedStagesForAudit = flowState.completedStages;
    completedStageMetaForAudit = flowState.completedStageMeta;
    legacyContinuation = flowState.legacyContinuation === true;
    worktreeExecutionMode = effectiveWorktreeExecutionMode(flowState);
    tddCheckpointMode = effectiveTddCheckpointMode(flowState);
    integrationOverseerMode = effectiveIntegrationOverseerMode(flowState);
    tddCutoverSliceId = flowState.tddCutoverSliceId ?? "";
    tddWorktreeCutoverSliceId = flowState.tddWorktreeCutoverSliceId ?? "";
  } catch {
    activeStageFlags = [];
    discoveryMode = "guided";
    taskClass = null;
    activeRunId = null;
    completedStagesForAudit = [];
    completedStageMetaForAudit = undefined;
    legacyContinuation = false;
    worktreeExecutionMode = "single-tree";
    tddCheckpointMode = "per-slice";
    integrationOverseerMode = "always";
    tddCutoverSliceId = "";
    tddWorktreeCutoverSliceId = "";
  }
  for (const extra of options.extraStageFlags ?? []) {
    if (typeof extra === "string" && extra.length > 0 && !activeStageFlags.includes(extra)) {
      activeStageFlags.push(extra);
    }
  }
  const liteTierForValidators = shouldDemoteArtifactValidationByTrack(track, taskClass);

  // v6.11.0 (D5) — pre-resolve RED/GREEN Evidence pointers AND
  // delegation phase events so `validateSectionBody` (sync) can
  // short-circuit. The Evidence: pointer mode (v6.10.0 T3) stays as a
  // fallback alongside legacy markdown content; phase events with a
  // `phase=red`/`phase=green` row plus non-empty evidenceRefs auto-pass
  // the corresponding markdown validator.
  const tddEvidenceContext = stage === "tdd"
    ? await resolveTddEvidencePointerContext({
        projectRoot,
        sections
      })
    : { red: {}, green: {} };

  for (const v of schema.artifactValidation) {
    const sectionKey = normalizeHeadingTitle(v.section).toLowerCase();
    const scopeBoundaryAlias =
      stage === "scope" && sectionKey === "in scope / out of scope";
    const body = scopeBoundaryAlias
      ? sectionBodyByAnyName(sections, ["In Scope / Out of Scope", "In Scope", "Out of Scope"])
      : sectionBodyByName(sections, v.section);
    const hasHeading = body !== null;
    const effectiveRequiredFromOverride = overrideSet
      ? overrideSet.has(sectionKey) ? true : false
      : v.required;
    const effectiveRequired =
      stage === "design" && sectionKey === "data flow" && hasHeading
        ? true
        : stage === "scope" && sectionKey === "pre-scope system audit" && scopePreAuditEnabled
          ? true
        : effectiveRequiredFromOverride;
    const validation = body === null
      ? { ok: false, details: `No ## heading matching required section "${v.section}".` }
      : validateSectionBody(body, v.validationRule, v.section, {
          sections,
          liteTier: liteTierForValidators,
          tddEvidence: stage === "tdd" ? tddEvidenceContext : undefined
        });
    const found = hasHeading && validation.ok;
    findings.push({
      section: v.section,
      required: effectiveRequired,
      rule: v.validationRule,
      found,
      details: found
        ? validation.details
        : validation.details
    });
  }

  const learningsBody = sectionBodyByName(sections, "Learnings");
  const requireLearnings = parsedFrontmatter.hasFrontmatter;
  if (learningsBody === null) {
    findings.push({
      section: "Learnings",
      required: requireLearnings,
      rule: "Required for schema-v1 artifacts: include `## Learnings` with bullets of strict JSON objects compatible with knowledge.jsonl schema, or a single `- None this stage.` sentinel.",
      found: false,
      details: "No ## heading matching required section \"Learnings\"."
    });
  } else {
    const learnings = parseLearningsSection(learningsBody);
    const meaningfulStageNoneWarning =
      learnings.ok && learnings.none && ["design", "tdd", "review"].includes(stage)
        ? " Warning: design/tdd/review usually produce reusable decisions, test patterns, or review lessons; keep `None this stage` only for truly mechanical work."
        : "";
    const learningsErrorBlock =
      !learnings.ok && learnings.errors.length > 0
        ? `\n${formatLearningsErrorsBullets(learnings.errors)}`
        : "";
    findings.push({
      section: "Learnings",
      required: requireLearnings,
      rule: "`## Learnings` must contain either a single `- None this stage.` bullet or JSON bullets compatible with knowledge.jsonl fields (type/trigger/action/confidence required).",
      found: learnings.ok,
      details: `${learnings.details}${learningsErrorBlock}${meaningfulStageNoneWarning}`
    });
  }

  for (const doneStage of completedStagesForAudit) {
    const completionIso = completedStageMetaForAudit?.[doneStage]?.completedAt;
    if (!completionIso) continue;
    const completedMs = Date.parse(completionIso);
    if (!Number.isFinite(completedMs)) continue;
    try {
      const resolvedDone = await resolveStageArtifactPath(doneStage, {
        projectRoot,
        track,
        intent: "read"
      });
      if (!(await exists(resolvedDone.absPath))) continue;
      const artifactStat = await fs.stat(resolvedDone.absPath);
      if (artifactStat.mtimeMs <= completedMs) continue;
      const priorRaw = await fs.readFile(resolvedDone.absPath, "utf8");
      const priorSections = extractH2Sections(priorRaw);
      const amendBody = sectionBodyByName(priorSections, "Amendments");
      const trimmedAmend =
        amendBody === null
          ? ""
          : amendBody.replace(/<!--[\s\S]*?-->/gu, "").replace(/\s+/gu, " ").trim();
      if (trimmedAmend.length > 0) continue;
      findings.push({
        section: "stage_artifact_post_closure_mutation",
        required: false,
        rule: "stage_artifact_post_closure_mutation — substantive post-closure edit without `## Amendments` (advisory)",
        found: false,
        details:
          `Completed stage "${doneStage}" snapshot closed at ${completionIso}, but ${resolvedDone.relPath} has a newer mtime without nonempty \`## Amendments\`. ` +
          "Append dated bullets describing each drift fix, or restore the archived copy."
      });
    } catch {
      continue;
    }
  }

  const stageContext: StageLintContext = {
    projectRoot,
    stage,
    track,
    discoveryMode,
    raw,
    absFile,
    sections,
    findings,
    parsedFrontmatter,
    brainstormShortCircuitBody,
    brainstormShortCircuitActivated,
    scopePreAuditEnabled,
    staleDiagramAuditEnabled,
    isTrivialOverride,
    overrideSet,
    activeStageFlags,
    taskClass,
    legacyContinuation,
    worktreeExecutionMode,
    tddCheckpointMode,
    integrationOverseerMode,
    tddCutoverSliceId,
    tddWorktreeCutoverSliceId
  };

  switch (stage) {
    case "brainstorm":
      await lintBrainstormStage(stageContext);
      break;
    case "design":
      await lintDesignStage(stageContext);
      break;
    case "plan":
      await lintPlanStage(stageContext);
      break;
    case "scope":
      await lintScopeStage(stageContext);
      break;
    case "spec":
      await lintSpecStage(stageContext);
      break;
    case "tdd":
      await lintTddStage(stageContext);
      break;
    case "review":
      await lintReviewStage(stageContext);
      break;
    case "ship":
      await lintShipStage(stageContext);
      break;
    default:
      break;
  }

  if (["design", "spec", "plan", "review"].includes(stage)) {
    const scopeArtifact = await resolveStageArtifactPath("scope", {
      projectRoot,
      track,
      intent: "read"
    });
    if (await exists(scopeArtifact.absPath)) {
      const scopeRaw = await fs.readFile(scopeArtifact.absPath, "utf8");
      const scopeSections = extractH2Sections(scopeRaw);
      const requirementsBody = sectionBodyByHeadingPrefix(scopeSections, "Requirements") ?? "";
      const lockedDecisionsBody = sectionBodyByHeadingPrefix(scopeSections, "Locked Decisions") ?? "";
      const requirementIds = extractRequirementIdsFromMarkdown(requirementsBody);
      const decisionIds = Array.from(
        new Set((lockedDecisionsBody.match(/\bD-\d+\b/giu) ?? []).map((id) => id.toUpperCase()))
      );
      const missingRequirementRefs = requirementIds.filter((id) => !raw.includes(id));
      const missingDecisionRefs = decisionIds.filter((id) => !raw.toUpperCase().includes(id));

      findings.push({
        section: "Scope Requirement Reference Integrity",
        required: requirementIds.length > 0,
        rule: "Every R# requirement ID from scope must be referenced by downstream artifacts.",
        found: missingRequirementRefs.length === 0,
        details:
          requirementIds.length === 0
            ? "No R# requirement IDs found in scope artifact; reference check skipped."
            : missingRequirementRefs.length === 0
              ? `All ${requirementIds.length} scope requirement ID(s) are referenced.`
              : `Missing scope requirement reference(s): ${missingRequirementRefs.join(", ")}.`
      });

      findings.push({
        section: "Locked Decision Reference Integrity",
        required: decisionIds.length > 0,
        rule: "Every D-XX locked decision ID from scope must be referenced by downstream artifacts.",
        found: missingDecisionRefs.length === 0,
        details:
          decisionIds.length === 0
            ? "No D-XX decision IDs found in scope artifact; reference check skipped."
            : missingDecisionRefs.length === 0
              ? `All ${decisionIds.length} locked decision ID(s) are referenced.`
              : `Missing locked decision reference(s): ${missingDecisionRefs.join(", ")}.`
      });
    }
  }

  try {
    const delegationLedger = await readDelegationLedger(projectRoot);
    const legacyWaivers = delegationLedger.entries.filter(
      (entry) =>
        entry.status === "waived" &&
        entry.mode === "proactive" &&
        entry.stage === stage &&
        (typeof entry.approvalToken !== "string" || entry.approvalToken.trim().length === 0)
    );
    if (legacyWaivers.length > 0) {
      const descriptors = legacyWaivers
        .map((entry) =>
          [entry.agent, entry.spanId].filter((value): value is string => typeof value === "string").join("@")
        )
        .filter((value) => value.length > 0);
      findings.push({
        section: "waiver_legacy_provenance",
        required: false,
        rule:
          "waiver_legacy_provenance — proactive waiver(s) without approvalToken. Issue new waivers via `cclaw-cli internal waiver-grant --stage <stage> --reason <slug>` so the provenance trail is signed. Legacy waivers remain valid (advisory).",
        found: false,
        details:
          `Found ${legacyWaivers.length} proactive waiver(s) on stage="${stage}" without approvalToken` +
          (descriptors.length > 0 ? ` (${descriptors.join(", ")})` : "") +
          ". Next waiver should be issued with `cclaw-cli internal waiver-grant` and consumed via `--accept-proactive-waiver=<token>`."
      });
    }
  } catch {
    // Ledger absent or unreadable: no advisory to emit.
  }

  const demote = shouldDemoteArtifactValidationByTrack(track, taskClass);
  const demotedSections: string[] = [];
  if (demote) {
    for (const finding of findings) {
      if (!ARTIFACT_VALIDATION_LITE_DEMOTE_SECTIONS.has(finding.section)) continue;
      if (finding.found) continue;
      if (!finding.required) continue;
      finding.required = false;
      finding.details =
        `${finding.details} (Wave 25: demoted to advisory by track="${track}"` +
        (taskClass ? `, taskClass="${taskClass}"` : "") +
        ").";
      demotedSections.push(finding.section);
    }
    if (demotedSections.length > 0 && activeRunId) {
      await recordArtifactValidationDemotedByTrack(projectRoot, {
        stage,
        track,
        taskClass: taskClass ?? null,
        runId: activeRunId,
        sections: demotedSections
      }).catch(() => {});
    }
  }

  const passed = findings.every((f) => !f.required || f.found);

  let dedup: LintResult["dedup"];
  try {
    const dedupResult: LintRunDedupResult = await classifyAndPersistFindings(
      projectRoot,
      stage,
      findings
    );
    const statusByFingerprint = new Map(
      dedupResult.classified.map(({ fingerprint, status }) => [fingerprint, status] as const)
    );
    const statuses = dedupResult.classified.map(({ status }) => status);
    void statusByFingerprint;
    dedup = {
      newCount: dedupResult.summary.newCount,
      repeatCount: dedupResult.summary.repeatCount,
      resolvedCount: dedupResult.summary.resolvedCount,
      header: dedupResult.header,
      statuses
    };
  } catch {
    dedup = undefined;
  }

  return { stage, file: relFile, passed, findings, ...(dedup ? { dedup } : {}) };
}

/**
 * Wave 25 (v6.1.0) — section names whose required-finding outcome is
 * demoted from blocking → advisory when
 * `shouldDemoteArtifactValidationByTrack(track, taskClass)` returns
 * `true`. Mirrors the user-reported quick-tier failure modes:
 *
 *  - `Architecture Diagram` — sync/async + failure-edge enforcement
 *  - `Data Flow` — Interaction Edge Case mandatory rows
 *  - `Stale Diagram Drift Check` — blast-radius file mtime audit
 *  - `Product Discovery Delegation (Strategist Mode)` — product-discovery delegation
 *
 * Findings remain in the result so the caller can surface them as
 * advisory hints; only `required` flips to `false`.
 */
const ARTIFACT_VALIDATION_LITE_DEMOTE_SECTIONS = new Set<string>([
  "Architecture Diagram",
  "Data Flow",
  "Stale Diagram Drift Check",
  "Product Discovery Delegation (Strategist Mode)"
]);

/**
 * v6.11.0 (D5) — pre-resolve `Evidence:` pointers and delegation
 * phase-event auto-satisfy state for the TDD stage's RED/GREEN
 * Evidence rows so `validateSectionBody` (sync) can short-circuit.
 *
 * - `<path>` pointer is satisfied when the path exists on disk relative
 *   to the project root.
 * - `spanId:<id>` pointer is satisfied when any delegation ledger row
 *   carries that span id.
 * - Phase-event auto-satisfy fires when `delegation-events.jsonl`
 *   carries at least one slice-tagged event for the active run with
 *   `phase=red`/`phase=green` and non-empty `evidenceRefs`. This is the
 *   v6.11.0 replacement for the v6.10.0 sidecar auto-satisfy hook —
 *   slice events are now the source of truth, the RED/GREEN markdown
 *   tables are auto-rendered from them, and the validators MUST NOT
 *   demand pasted stdout when the events already prove RED/GREEN.
 */
async function resolveTddEvidencePointerContext(input: {
  projectRoot: string;
  sections: H2SectionMap;
}): Promise<{ red: TddEvidencePointerOptions; green: TddEvidencePointerOptions }> {
  const { projectRoot, sections } = input;
  const redSection = sectionBodyByName(sections, "RED Evidence") ?? "";
  const greenSection = sectionBodyByName(sections, "GREEN Evidence") ?? "";
  const redPointers = extractEvidencePointers(redSection);
  const greenPointers = extractEvidencePointers(greenSection);

  let knownSpanIds = new Set<string>();
  let phaseEventsAutoSatisfy = { red: false, green: false };
  try {
    const ledger = await readDelegationLedger(projectRoot);
    knownSpanIds = new Set(
      ledger.entries
        .map((entry) => entry.spanId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    );
    const runId = ledger.runId;
    const slicePhaseRows = ledger.entries.filter((entry) =>
      entry.runId === runId &&
      entry.stage === "tdd" &&
      typeof entry.sliceId === "string" &&
      entry.sliceId.length > 0 &&
      typeof entry.phase === "string"
    );
    const redOk = slicePhaseRows.some((entry) =>
      entry.phase === "red" &&
      Array.isArray(entry.evidenceRefs) &&
      entry.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0)
    );
    const greenOk = slicePhaseRows.some((entry) =>
      entry.phase === "green" &&
      Array.isArray(entry.evidenceRefs) &&
      entry.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0)
    );
    phaseEventsAutoSatisfy = { red: redOk, green: greenOk };
  } catch {
    knownSpanIds = new Set();
    phaseEventsAutoSatisfy = { red: false, green: false };
  }

  async function pointerResolves(value: string): Promise<boolean> {
    const trimmed = value.replace(/[`*_]/gu, "").trim();
    if (trimmed.length === 0) return false;
    if (/^spanid\s*:/iu.test(trimmed)) {
      const id = trimmed.replace(/^spanid\s*:\s*/iu, "").trim();
      return id.length > 0 && knownSpanIds.has(id);
    }
    const candidate = path.isAbsolute(trimmed) ? trimmed : path.join(projectRoot, trimmed);
    return exists(candidate);
  }

  async function anyResolved(values: string[]): Promise<boolean> {
    for (const value of values) {
      if (await pointerResolves(value)) return true;
    }
    return false;
  }

  return {
    red: {
      pointerSatisfied: await anyResolved(redPointers),
      phaseEventsSatisfied: phaseEventsAutoSatisfy.red
    },
    green: {
      pointerSatisfied: await anyResolved(greenPointers),
      phaseEventsSatisfied: phaseEventsAutoSatisfy.green
    }
  };
}
