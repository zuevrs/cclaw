import { readDelegationLedger } from "../delegation.js";
import {
  type StageLintContext,
  sectionBodyByName
} from "./shared.js";

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
    isTrivialOverride
  } = ctx;

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

    const delegationLedger = await readDelegationLedger(projectRoot);
    const activeRunRows = delegationLedger.entries.filter((entry) =>
      entry.stage === "ship" &&
      entry.runId === delegationLedger.runId &&
      entry.agent === "architect" &&
      entry.status === "completed"
    );
    const hasCrossStageReferenceInArtifact =
      /\barchitect-cross-stage-verification\b/iu.test(raw) ||
      /\barchitect\b[\s\S]{0,180}\bcross[-\s]?stage\b/iu.test(raw) ||
      /\bCROSS_STAGE_VERIFIED\b/u.test(raw) ||
      /\bDRIFT_DETECTED\b/u.test(raw);

    findings.push({
      section: "ship.cross_stage_cohesion_missing",
      required: true,
      rule: "Ship artifact must include architect cross-stage verification reference (`architect-cross-stage-verification` / CROSS_STAGE_VERIFIED / DRIFT_DETECTED) before finalization.",
      found: hasCrossStageReferenceInArtifact,
      details: hasCrossStageReferenceInArtifact
        ? "Architect cross-stage verification reference is present in ship artifact."
        : activeRunRows.length > 0
          ? "Completed architect delegation exists in ledger, but ship artifact is missing explicit cross-stage verification reference."
          : "Ship artifact is missing architect cross-stage verification reference."
    });

    const driftDetectedInArtifact = /\bDRIFT_DETECTED\b/u.test(raw);
    const driftDetectedInDelegation = activeRunRows.some((row) => {
      const refs = Array.isArray(row.evidenceRefs) ? row.evidenceRefs.join(" ") : "";
      return /\bDRIFT_DETECTED\b/u.test(refs);
    });
    const driftDetected = driftDetectedInArtifact || driftDetectedInDelegation;

    findings.push({
      section: "ship.cross_stage_drift_detected",
      required: true,
      rule: "If architect cross-stage verification reports DRIFT_DETECTED, ship must be blocked until drift is resolved or explicitly waived.",
      found: !driftDetected,
      details: driftDetected
        ? "Architect cross-stage verification reported DRIFT_DETECTED; ship must not proceed."
        : "No DRIFT_DETECTED signal found in ship artifact or architect delegation evidence."
    });
}
