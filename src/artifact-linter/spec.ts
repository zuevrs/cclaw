import {
  type StageLintContext,
  getMarkdownTableRows,
  evaluateLayeredDocumentReviewStatus,
  extractAcceptanceCriterionIdsFromMarkdown,
  sectionBodyByName,
  SPEC_MAX_MODULES
} from "./shared.js";
import { CONFIDENCE_FINDING_REGEX_SOURCE } from "../content/skills.js";

export async function lintSpecStage(ctx: StageLintContext): Promise<void> {
  const {
    projectRoot,
    track,
    raw,
    absFile,
    sections,
    findings,
    parsedFrontmatter,
    brainstormShortCircuitBody,
    brainstormShortCircuitActivated,
    staleDiagramAuditEnabled,
    isTrivialOverride
  } = ctx;

    // Universal Layer 2.4 structural checks (evanflow-prd + superpowers).
    // All checks fire only when the matching section is present so legacy
    // fixtures keep working while v3-template artifacts are validated.
    const synthesisBody = sectionBodyByName(sections, "Synthesis Sources");
    if (synthesisBody !== null) {
      const tableRows = synthesisBody
        .split("\n")
        .filter((line) => /^\|/u.test(line));
      const dataRows = tableRows.length >= 3 ? tableRows.slice(2) : [];
      const populatedRows = dataRows.filter((row) =>
        row
          .split("|")
          .slice(1, -1)
          .some((cell) => cell.trim().length > 0)
      );
      const hasRow = populatedRows.length >= 1;
      findings.push({
        section: "Synthesis Sources Coverage",
        required: true,
        rule: "Synthesis Sources must cite at least one source artifact (synthesize-not-interview).",
        found: hasRow,
        details: hasRow
          ? `Detected ${populatedRows.length} populated source row(s).`
          : "Synthesis Sources is empty; spec must cite at least one upstream artifact or context file."
      });
    }

    const behaviorBody = sectionBodyByName(sections, "Behavior Contract");
    if (behaviorBody !== null) {
      const optedOut = /(^|\n)\s*-\s*None\b/iu.test(behaviorBody);
      const userStoryRegex = /(^|\n)\s*-\s*as\s+a\b[\s\S]*?,\s*i\s+can\b[\s\S]*?,\s*so that\b/imu;
      const givenWhenThenRegex = /(^|\n)\s*-\s*given\b[\s\S]*?,\s*when\b[\s\S]*?,\s*then\b/imu;
      const matches = [
        ...behaviorBody.matchAll(/(^|\n)\s*-\s*as\s+a\b[\s\S]*?,\s*i\s+can\b[\s\S]*?,\s*so that\b/gimu),
        ...behaviorBody.matchAll(/(^|\n)\s*-\s*given\b[\s\S]*?,\s*when\b[\s\S]*?,\s*then\b/gimu)
      ];
      const ok = optedOut || matches.length >= 3;
      findings.push({
        section: "Behavior Contract Shape",
        required: true,
        rule: "Behavior Contract must list ≥3 behaviors in user-story (As a/I can/so that) or Given/When/Then form, or declare `- None.` for single-step specs.",
        found: ok,
        details: optedOut
          ? "Single-step spec; behaviors opted out via `- None.`."
          : ok
            ? `Detected ${matches.length} behavior(s) in canonical form.`
            : `Detected ${matches.length} behavior(s) in canonical form; need ≥3 (or `
              + "`- None.`).",
      });
      // Bonus: detect if at least one user-story OR given/when/then form is present
      // (mirrors existing helpers).
      void userStoryRegex;
      void givenWhenThenRegex;
    }

    const archModulesBody = sectionBodyByName(sections, "Architecture Modules");
    if (archModulesBody !== null) {
      const codeFenceCount = (archModulesBody.match(/```/gu) ?? []).length;
      const fnSignatureRegex = /\b(function|class|def|fn|method)\b\s+[A-Za-z_]/u;
      const noCode = codeFenceCount === 0 && !fnSignatureRegex.test(archModulesBody);
      findings.push({
        section: "Architecture Modules No-Code",
        required: true,
        rule: "Architecture Modules must not contain code blocks, function signatures, or class definitions — modules listed by responsibility only.",
        found: noCode,
        details: noCode
          ? "Architecture Modules is free of code blocks and function/class signatures."
          : "Architecture Modules contains a code fence or function/class signature; remove code-level details."
      });

      const tableRows = archModulesBody.split("\n").filter((line) => /^\|/u.test(line));
      const dataRows = tableRows.length >= 3 ? tableRows.slice(2) : [];
      const moduleNames = dataRows
        .map((row) => row.split("|").slice(1, -1)[0]?.trim() ?? "")
        .filter((name) => name.length > 0 && name !== "-" && !/^module$/iu.test(name));
      const uniqueModuleCount = new Set(moduleNames).size;
      findings.push({
        section: "Single-Subsystem Scope",
        required: false,
        rule: `Architecture Modules should stay within one coherent subsystem boundary (<= ${SPEC_MAX_MODULES} named modules).`,
        found: uniqueModuleCount <= SPEC_MAX_MODULES,
        details: uniqueModuleCount <= SPEC_MAX_MODULES
          ? `Module count (${uniqueModuleCount}) stays within single-subsystem guidance.`
          : `Architecture Modules lists ${uniqueModuleCount} modules (> ${SPEC_MAX_MODULES}); split into sub-specs or narrow scope before plan handoff.`
      });
    }

    const selfReviewBody = sectionBodyByName(sections, "Spec Self-Review");
    if (selfReviewBody === null) {
      findings.push({
        section: "Spec Self-Review Coverage",
        required: true,
        rule: "Spec Self-Review must cover placeholder/consistency/scope/ambiguity checks.",
        found: false,
        details: "No ## heading matching required section \"Spec Self-Review\"."
      });
    } else {
      const required = ["placeholder", "consistency", "scope", "ambiguity"];
      const missing = required.filter(
        (token) => !new RegExp(token, "iu").test(selfReviewBody)
      );
      findings.push({
        section: "Spec Self-Review Coverage",
        required: true,
        rule: "Spec Self-Review must cover placeholder/consistency/scope/ambiguity checks.",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Spec Self-Review covers all required checks."
          : `Spec Self-Review is missing check(s): ${missing.join(", ")}.`
      });
    }

    const layeredDocumentReview = evaluateLayeredDocumentReviewStatus(
      sections,
      CONFIDENCE_FINDING_REGEX_SOURCE
    );
    if (layeredDocumentReview !== null) {
      findings.push({
        section: "Document Reviewer Structured Findings",
        required: true,
        rule: "When Layered review references coherence-reviewer/scope-guardian-reviewer/feasibility-reviewer, include explicit reviewer status plus calibrated finding lines.",
        found: layeredDocumentReview.missingStructured.length === 0,
        details: layeredDocumentReview.missingStructured.length === 0
          ? `Structured findings present for reviewers: ${layeredDocumentReview.triggeredReviewers.join(", ")}.`
          : `Missing status or calibrated findings for: ${layeredDocumentReview.missingStructured.join(", ")}.`
      });
      findings.push({
        section: "document-review.fail_without_waiver",
        required: true,
        rule: "[P1] document-review.fail_without_waiver — reviewer FAIL/PARTIAL requires fix evidence or explicit waiver.",
        found: layeredDocumentReview.failOrPartialWithoutWaiver.length === 0,
        details: layeredDocumentReview.failOrPartialWithoutWaiver.length === 0
          ? "No unwaived FAIL/PARTIAL reviewer statuses detected."
          : `Unwaived FAIL/PARTIAL statuses: ${layeredDocumentReview.failOrPartialWithoutWaiver.join(", ")}.`
      });
    }

    const acceptanceCriteriaBody = sectionBodyByName(sections, "Acceptance Criteria");
    if (acceptanceCriteriaBody === null) {
      findings.push({
        section: "spec_ac_ids_present",
        required: true,
        rule: "Acceptance Criteria must assign stable IDs in `AC-N` format for every criterion row.",
        found: false,
        details: "No ## heading matching required section \"Acceptance Criteria\"."
      });
    } else {
      const tableRows = getMarkdownTableRows(acceptanceCriteriaBody);
      const bulletRows = acceptanceCriteriaBody
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/u.test(line));
      const candidateRows = tableRows.length > 0
        ? tableRows.map((row) => row.join(" | ").trim()).filter((row) => row.length > 0)
        : bulletRows;
      const missingIds = candidateRows.filter(
        (row) => extractAcceptanceCriterionIdsFromMarkdown(row).length === 0
      );
      const found = candidateRows.length > 0 && missingIds.length === 0;
      findings.push({
        section: "spec_ac_ids_present",
        required: true,
        rule: "Acceptance Criteria must assign stable IDs in `AC-N` format for every criterion row.",
        found,
        details:
          candidateRows.length === 0
            ? "Acceptance Criteria has no populated criterion rows."
            : missingIds.length === 0
              ? `All ${candidateRows.length} acceptance criterion row(s) include AC-N identifiers.`
              : `${missingIds.length} acceptance criterion row(s) are missing AC-N identifiers.`
      });
    }

    if (acceptanceCriteriaBody !== null && /\|/u.test(acceptanceCriteriaBody)) {
      const hasParallel = /\bparallelSafe\b/iu.test(acceptanceCriteriaBody);
      const hasTouch = /\btouchSurface\b/iu.test(acceptanceCriteriaBody);
      findings.push({
        section: "spec_acs_not_sliceable",
        required: false,
        rule: "Acceptance criteria should declare `parallelSafe` and `touchSurface` per row so plan/TDD can schedule slices safely.",
        found: hasParallel && hasTouch,
        details:
          hasParallel && hasTouch
            ? "Acceptance Criteria mentions parallelSafe and touchSurface."
            : "Add columns or inline markers for parallelSafe (true|false) and touchSurface (short area description) for each AC."
      });
    }
}
