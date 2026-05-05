import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readDelegationLedger } from "../delegation.js";
import { resolveArtifactPath as resolveStageArtifactPath } from "../artifact-paths.js";
import { exists } from "../fs-utils.js";
import {
  type StageLintContext,
  extractAcceptanceCriterionIdsFromMarkdown,
  extractH2Sections,
  sectionBodyByName
} from "./shared.js";
import { readFlowState } from "../run-persistence.js";

const execFileAsync = promisify(execFile);

function extractSliceCardClosedAcceptanceCriteria(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(/^\s*(?:[-*]\s*)?closes\s*:\s*(.+)$/gimu)) {
    const tail = match[1] ?? "";
    for (const id of extractAcceptanceCriterionIdsFromMarkdown(tail)) {
      ids.add(id);
    }
  }
  return [...ids];
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function entryTimestamp(entry: {
  ts?: string;
  startTs?: string;
  launchedTs?: string;
  ackTs?: string;
  completedTs?: string;
  endTs?: string;
}): string {
  return entry.startTs ?? entry.ts ?? entry.launchedTs ?? entry.ackTs ?? entry.completedTs ?? entry.endTs ?? "";
}

async function readSpecAcceptanceCriteriaIds(
  projectRoot: string,
  track: StageLintContext["track"]
): Promise<string[]> {
  const specArtifact = await resolveStageArtifactPath("spec", {
    projectRoot,
    track,
    intent: "read"
  });
  if (!(await exists(specArtifact.absPath))) {
    return [];
  }
  try {
    const specRaw = await fs.readFile(specArtifact.absPath, "utf8");
    const sections = extractH2Sections(specRaw);
    const acceptanceBody = sectionBodyByName(sections, "Acceptance Criteria") ?? specRaw;
    return extractAcceptanceCriterionIdsFromMarkdown(acceptanceBody);
  } catch {
    return [];
  }
}

async function collectAcceptanceSlicesMap(tddSlicesDir: string): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  let names: string[] = [];
  try {
    names = await fs.readdir(tddSlicesDir);
  } catch {
    return map;
  }
  for (const name of names) {
    const match = /^(S-[A-Za-z0-9._-]+)\.md$/u.exec(name);
    if (!match) continue;
    const sliceId = match[1]!;
    let content = "";
    try {
      content = await fs.readFile(path.join(tddSlicesDir, name), "utf8");
    } catch {
      continue;
    }
    const acIds = extractSliceCardClosedAcceptanceCriteria(content);
    for (const acId of acIds) {
      const set = map.get(acId) ?? new Set<string>();
      set.add(sliceId);
      map.set(acId, set);
    }
  }
  return map;
}

async function sliceHasManagedCommit(
  projectRoot: string,
  sliceId: string,
  sinceTs: string | null
): Promise<boolean> {
  const grepPattern = `^${escapeForRegex(sliceId)}/`;
  const args = ["log", "--extended-regexp", "--grep", grepPattern, "--pretty=%H"];
  if (sinceTs && sinceTs.length > 0) {
    args.push(`--since=${sinceTs}`);
  }
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: projectRoot });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function resolveActiveRunStartTs(projectRoot: string, runId: string): Promise<string | null> {
  const ledger = await readDelegationLedger(projectRoot).catch(() => null);
  const runRows = ledger
    ? ledger.entries.filter((entry) => entry.runId === runId)
    : [];
  const stamps = runRows
    .map((entry) => entryTimestamp(entry))
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort();
  if (stamps.length > 0) {
    return stamps[0]!;
  }
  try {
    const state = await readFlowState(projectRoot);
    if (state.activeRunId === runId) {
      const completed = Object.values(state.completedStageMeta ?? {})
        .map((meta) => meta?.completedAt)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .sort();
      if (completed.length > 0) {
        return completed[0]!;
      }
    }
  } catch {
    // no-op fallback
  }
  return null;
}

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

    const specAcceptanceIds = await readSpecAcceptanceCriteriaIds(projectRoot, track);
    const tddSlicesDir = path.join(path.dirname(absFile), "tdd-slices");
    const acceptanceSlices = await collectAcceptanceSlicesMap(tddSlicesDir);
    const gitPresent = await exists(path.join(projectRoot, ".git"));
    const runStartTs = gitPresent
      ? await resolveActiveRunStartTs(projectRoot, delegationLedger.runId)
      : null;

    const uncoveredCriteria: string[] = [];
    if (specAcceptanceIds.length > 0 && gitPresent && runStartTs !== null) {
      for (const acId of specAcceptanceIds) {
        const slices = [...(acceptanceSlices.get(acId) ?? new Set<string>())];
        let covered = false;
        if (slices.length > 0) {
          for (const sliceId of slices) {
            if (await sliceHasManagedCommit(projectRoot, sliceId, runStartTs)) {
              covered = true;
              break;
            }
          }
        }
        if (!covered) {
          const reason = slices.length === 0
            ? `${acId} has no \`Closes: ${acId}\` slice mapping`
            : `${acId} mapped slices ${slices.join(", ")} have no managed commit since run start`;
          uncoveredCriteria.push(reason);
          findings.push({
            section: `acceptance_criterion_${acId}_uncovered`,
            required: true,
            rule: "Every acceptance criterion must map to at least one slice card and at least one managed slice commit.",
            found: false,
            details: reason
          });
        }
      }
    }

    const allAcceptanceCovered =
      specAcceptanceIds.length === 0 ||
      ((!gitPresent || runStartTs !== null) && uncoveredCriteria.length === 0);
    findings.push({
      section: "ship_all_acceptance_criteria_have_commits",
      required: true,
      rule: "For every spec AC-N, at least one `tdd-slices/S-*.md` card must declare `Closes: AC-N` and at least one managed slice commit (`^S-<id>/`) must exist since run start.",
      found: allAcceptanceCovered,
      details: specAcceptanceIds.length === 0
        ? "Spec acceptance criteria list is empty or unreadable; AC commit coverage check is idle."
        : !gitPresent
          ? "No .git directory detected; AC-to-commit coverage check is skipped for no-VCS mode."
          : runStartTs === null
            ? "Unable to resolve active run start timestamp from delegation ledger/flow-state."
            : uncoveredCriteria.length > 0
              ? `Uncovered acceptance criteria: ${uncoveredCriteria.join(" | ")}.`
              : `All ${specAcceptanceIds.length} acceptance criteria map to slice cards and managed commits since ${runStartTs}.`
    });
}
