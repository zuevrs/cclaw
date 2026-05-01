import fs from "node:fs/promises";
import { resolveArtifactPath as resolveStageArtifactPath } from "./artifact-paths.js";
import { exists } from "./fs-utils.js";
import { stageSchema } from "./content/stage-schema.js";
import { readFlowState } from "./run-persistence.js";
import type { FlowStage, FlowTrack } from "./types.js";
import {
  duplicateH2Headings,
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
  type LintFinding,
  type LintResult,
  type StageLintContext
} from "./artifact-linter/shared.js";
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
  type ReviewVerdictConsistencyResult,
  type ReviewSecurityNoChangeAttestationResult
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
      : validateSectionBody(body, v.validationRule, v.section);
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
    findings.push({
      section: "Learnings",
      required: requireLearnings,
      rule: "`## Learnings` must contain either a single `- None this stage.` bullet or JSON bullets compatible with knowledge.jsonl fields (type/trigger/action/confidence required).",
      found: learnings.ok,
      details: `${learnings.details}${meaningfulStageNoneWarning}`
    });
  }

  let activeStageFlags: string[] = [];
  try {
    const flowState = await readFlowState(projectRoot);
    const hint = flowState.interactionHints?.[stage];
    if (hint?.skipQuestions === true) activeStageFlags.push("--skip-questions");
  } catch {
    activeStageFlags = [];
  }
  for (const extra of options.extraStageFlags ?? []) {
    if (typeof extra === "string" && extra.length > 0 && !activeStageFlags.includes(extra)) {
      activeStageFlags.push(extra);
    }
  }

  const stageContext: StageLintContext = {
    projectRoot,
    stage,
    track,
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
    activeStageFlags
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

  const passed = findings.every((f) => !f.required || f.found);
  return { stage, file: relFile, passed, findings };
}
