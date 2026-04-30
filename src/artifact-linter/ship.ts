// @ts-nocheck
import type { StageLintContext } from "./shared.js";

export async function lintShipStage(ctx: StageLintContext): Promise<void> {
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
    sectionBodyByName
  } = shared as Record<string, any>;

    // Universal Layer 2.8 structural checks (superpowers finishing-a-development-branch).
    const optionsBody = sectionBodyByName(sections, "Finalization Options");
    if (optionsBody !== null) {
      const required = ["MERGE_LOCAL", "OPEN_PR", "KEEP_BRANCH", "DISCARD"];
      const missing = required.filter((token) => !optionsBody.includes(token));
      findings.push({
        section: "Finalization Options Coverage",
        required: true,
        rule: "Finalization Options must surface all four canonical options (MERGE_LOCAL, OPEN_PR, KEEP_BRANCH, DISCARD).",
        found: missing.length === 0,
        details: missing.length === 0
          ? "All four finalization options surfaced."
          : `Finalization Options is missing token(s): ${missing.join(", ")}.`
      });
    }

    const prBody = sectionBodyByName(sections, "Structured PR Body");
    if (prBody !== null) {
      const required = ["## Summary", "## Test Plan", "## Commits Included"];
      const missing = required.filter((token) => !prBody.includes(token));
      findings.push({
        section: "Structured PR Body Shape",
        required: true,
        rule: "Structured PR Body must include `## Summary`, `## Test Plan`, and `## Commits Included` subsections.",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Structured PR Body covers all required subsections."
          : `Structured PR Body is missing subsection(s): ${missing.join(", ")}.`
      });
    }

    const verifyBody = sectionBodyByName(sections, "Verify Tests Gate");
    if (verifyBody !== null) {
      const ok = /\bResult:\s*(PASS|FAIL)\b/iu.test(verifyBody);
      findings.push({
        section: "Verify Tests Gate Result",
        required: true,
        rule: "Verify Tests Gate must declare a Result of PASS or FAIL.",
        found: ok,
        details: ok
          ? "Verify Tests Gate result declared."
          : "Verify Tests Gate is missing a `Result: PASS|FAIL` line."
      });
    }
}
