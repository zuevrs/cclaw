// @ts-nocheck
import type { StageLintContext } from "./shared.js";

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
    isTrivialOverride,
    shared
  } = ctx;
  const {
    sectionBodyByName,
    SPEC_MAX_MODULES
  } = shared as Record<string, any>;

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
}
