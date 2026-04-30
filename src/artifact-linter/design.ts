import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath as resolveStageArtifactPath } from "../artifact-paths.js";
import { exists } from "../fs-utils.js";
import { CONFIDENCE_FINDING_REGEX_SOURCE } from "../content/skills.js";
import type { FlowTrack } from "../types.js";
import {
  type StageLintContext,
  checkCriticPredictionsContract,
  evaluateLayeredDocumentReviewStatus,
  extractMarkdownSectionBody,
  getMarkdownTableRows,
  meaningfulLineCount,
  sectionBodyByName,
  markdownFieldRegex
} from "./shared.js";

type DesignDiagramTier = "lightweight" | "standard" | "deep";

interface DesignDiagramRequirement {
  section: string;
  markers: string[];
  note: string;
}

const DESIGN_DIAGRAM_REQUIREMENTS: Record<DesignDiagramTier, DesignDiagramRequirement[]> = {
  lightweight: [
    {
      section: "Architecture Diagram",
      markers: ["architecture"],
      note: "Architecture diagram is required for all tiers."
    }
  ],
  standard: [
    {
      section: "Architecture Diagram",
      markers: ["architecture"],
      note: "Architecture diagram is required for all tiers."
    },
    {
      section: "Data-Flow Shadow Paths",
      markers: ["data-flow-shadow-paths"],
      note: "Standard+ requires data-flow shadow path coverage."
    },
    {
      section: "Error Flow Diagram",
      markers: ["error-flow"],
      note: "Standard+ requires explicit error-flow rescue mapping."
    }
  ],
  deep: [
    {
      section: "Architecture Diagram",
      markers: ["architecture"],
      note: "Architecture diagram is required for all tiers."
    },
    {
      section: "Data-Flow Shadow Paths",
      markers: ["data-flow-shadow-paths"],
      note: "Standard+ requires data-flow shadow path coverage."
    },
    {
      section: "Error Flow Diagram",
      markers: ["error-flow"],
      note: "Standard+ requires explicit error-flow rescue mapping."
    },
    {
      section: "Deep Diagram Add-on",
      markers: ["state-machine", "rollback-flowchart", "deployment-sequence"],
      note: "Deep tier requires one add-on deep diagram (state machine, rollback flowchart, or deployment sequence)."
    }
  ]
};

function normalizeDesignDiagramTier(value: string | null): DesignDiagramTier | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (/^(?:lite|light|lightweight)$/u.test(normalized)) return "lightweight";
  if (/^standard$/u.test(normalized)) return "standard";
  if (/^deep$/u.test(normalized)) return "deep";
  return null;
}

function parseApproachTierSection(sectionBody: string | null): DesignDiagramTier | null {
  if (!sectionBody) return null;
  for (const line of sectionBody.split(/\r?\n/u)) {
    const cleaned = line.replace(/[*_`]/gu, "").trim();
    const directMatch = /(?:^|\b)tier\s*:\s*(lite|lightweight|light|standard|deep)\b/iu.exec(cleaned);
    if (directMatch) {
      const captured = directMatch[1] ?? "";
      const remainder = cleaned.slice(cleaned.toLowerCase().indexOf("tier") + 4);
      const tierTokens = remainder.match(/\b(?:lite|lightweight|light|standard|deep)\b/giu) ?? [];
      const distinct = new Set(tierTokens.map((token) => token.toLowerCase()));
      if (distinct.size >= 2) {
        // Multi-token line is the unfilled template placeholder
        // (`Tier: lite | standard | deep`); treat as no decision.
        continue;
      }
      return normalizeDesignDiagramTier(captured);
    }
  }
  const token = /\b(lite|lightweight|light|standard|deep)\b/iu.exec(sectionBody)?.[1] ?? null;
  return normalizeDesignDiagramTier(token);
}

async function resolveDesignDiagramTier(
  projectRoot: string,
  track: FlowTrack,
  designRaw: string
): Promise<{ tier: DesignDiagramTier; source: string }> {
  const fromDesign = parseApproachTierSection(extractMarkdownSectionBody(designRaw, "Approach Tier"));
  if (fromDesign) {
    return { tier: fromDesign, source: "design-artifact:Approach Tier" };
  }
  try {
    const brainstormArtifact = await resolveStageArtifactPath("brainstorm", {
      projectRoot,
      track,
      intent: "read"
    });
    if (await exists(brainstormArtifact.absPath)) {
      const brainstormRaw = await fs.readFile(brainstormArtifact.absPath, "utf8");
      const fromBrainstorm = parseApproachTierSection(
        extractMarkdownSectionBody(brainstormRaw, "Approach Tier")
      );
      if (fromBrainstorm) {
        return { tier: fromBrainstorm, source: "brainstorm-artifact:Approach Tier" };
      }
    }
  } catch {
    // Ignore read/resolve errors and fall back to default tier.
  }
  return { tier: "standard", source: "default:standard" };
}

function normalizeCodebaseInvestigationFileRef(value: string): string | null {
  const cleaned = value
    .replace(/`/gu, "")
    .replace(/^\s*[-*]\s*/u, "")
    .trim();
  if (!cleaned) return null;
  if (/^(?:file|n\/a|none|\(none\)|tbd|\?)$/iu.test(cleaned)) return null;
  return cleaned;
}

function collectCodebaseInvestigationFiles(sectionBody: string): string[] {
  const refs: string[] = [];
  for (const row of getMarkdownTableRows(sectionBody)) {
    const fileCell = normalizeCodebaseInvestigationFileRef(row[0] ?? "");
    if (fileCell) refs.push(fileCell);
  }
  return [...new Set(refs)];
}

interface StaleDiagramAuditResult {
  ok: boolean;
  details: string;
}

async function runStaleDiagramAudit(
  projectRoot: string,
  artifactPath: string,
  artifactRaw: string,
  codebaseInvestigationBody: string
): Promise<StaleDiagramAuditResult> {
  const markerCount = (artifactRaw.match(/<!--\s*diagram:\s*[a-z0-9-]+\s*-->/giu) ?? []).length;
  if (markerCount === 0) {
    return {
      ok: false,
      details: "No diagram markers found in design artifact; stale-diagram baseline cannot be computed."
    };
  }
  let artifactStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    artifactStat = await fs.stat(artifactPath);
  } catch {
    return {
      ok: false,
      details: "Cannot stat design artifact to compute diagram marker baseline."
    };
  }

  const refs = collectCodebaseInvestigationFiles(codebaseInvestigationBody);
  if (refs.length === 0) {
    return {
      ok: false,
      details: "Codebase Investigation must list at least one blast-radius file for stale-diagram audit."
    };
  }

  const stale: string[] = [];
  const missing: string[] = [];
  let scanned = 0;
  for (const ref of refs) {
    const absPath = path.isAbsolute(ref) ? ref : path.join(projectRoot, ref);
    if (!(await exists(absPath))) {
      missing.push(ref);
      continue;
    }
    let fileStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      fileStat = await fs.stat(absPath);
    } catch {
      missing.push(ref);
      continue;
    }
    if (!fileStat.isFile()) continue;
    scanned += 1;
    if (fileStat.mtimeMs > artifactStat.mtimeMs) {
      stale.push(ref);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      details: `Stale Diagram Audit could not read blast-radius file(s): ${missing.join(", ")}.`
    };
  }
  if (scanned === 0) {
    return {
      ok: false,
      details: "Stale Diagram Audit found no readable blast-radius files in Codebase Investigation."
    };
  }
  if (stale.length > 0) {
    return {
      ok: false,
      details: `Stale Diagram Audit flagged stale file(s) newer than diagram baseline: ${stale.join(", ")}.`
    };
  }
  return {
    ok: true,
    details: `Stale Diagram Audit clear: ${scanned} blast-radius file(s) are not newer than diagram baseline.`
  };
}

export async function lintDesignStage(ctx: StageLintContext): Promise<void> {
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
    const criticPredictions = checkCriticPredictionsContract(sections);
    if (criticPredictions !== null) {
      findings.push({
        section: "critic.predictions_missing",
        required: true,
        rule: "[P2] critic.predictions_missing — pre-commitment predictions block missing or empty",
        found: criticPredictions.found,
        details: criticPredictions.details
      });
    }
    const tierResolution = await resolveDesignDiagramTier(projectRoot, track, raw);
    const diagramTier = isTrivialOverride
      ? "lightweight"
      : tierResolution.tier;
    const tierSource = isTrivialOverride
      ? `${tierResolution.source}; trivial override forced lightweight`
      : tierResolution.source;
    const hasDiagramMarkers = /<!--\s*diagram:\s*[a-z0-9-]+\s*-->/iu.test(raw);
    const skipDiagramRequirements = isTrivialOverride && !hasDiagramMarkers;
    if (skipDiagramRequirements) {
      findings.push({
        section: "Diagram Requirement: Architecture Diagram",
        required: true,
        rule: "Compact trivial-override slices may omit architecture diagram markers when they intentionally skip diagram work.",
        found: true,
        details: "Diagram requirement skipped: compact trivial-override slice without diagram markers."
      });
    } else {
      for (const requirement of DESIGN_DIAGRAM_REQUIREMENTS[diagramTier]) {
        const sectionBody = sectionBodyByName(sections, requirement.section);
        const hasSection = sectionBody !== null;
        const matchedMarker = requirement.markers.find((marker) => {
          const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          const markerRegex = new RegExp(`<!--\\s*diagram:\\s*${escapedMarker}\\s*-->`, "iu");
          return sectionBody !== null && markerRegex.test(sectionBody);
        });
        const hasMarker = matchedMarker !== undefined;
        const hasContent = sectionBody !== null && meaningfulLineCount(sectionBody) > 0;
        const found = hasSection && hasMarker && hasContent;
        const markerList = requirement.markers.map((marker) => `<!-- diagram: ${marker} -->`).join(" or ");
        findings.push({
          section: `Diagram Requirement: ${requirement.section}`,
          required: true,
          rule: `Design tier "${diagramTier}" requires "${requirement.section}" with marker ${markerList}. ${requirement.note}`,
          found,
          details: found
            ? `Satisfied (${tierSource}).`
            : !hasSection
              ? `Missing section "${requirement.section}" (${tierSource}).`
              : !hasMarker
                ? `Missing marker (${markerList}) in section "${requirement.section}" (${tierSource}).`
                : `Section "${requirement.section}" has marker but no meaningful content (${tierSource}).`
        });
      }
    }

    if (staleDiagramAuditEnabled) {
      if (isTrivialOverride && !hasDiagramMarkers) {
        findings.push({
          section: "Stale Diagram Drift Check",
          required: true,
          rule: "When stale-diagram audit is enabled, compact trivial-override slices may skip the drift check only if no design diagram markers are present.",
          found: true,
          details: "Stale Diagram Audit skipped: artifact has no diagram markers (compact trivial-override slice)."
        });
      } else {
        const codebaseInvestigation = sectionBodyByName(sections, "Codebase Investigation");
        if (codebaseInvestigation === null) {
          findings.push({
            section: "Stale Diagram Drift Check",
            required: true,
            rule: "When stale-diagram audit is enabled, stale diagram audit requires Codebase Investigation blast-radius files.",
            found: false,
            details: "No ## heading matching required section \"Codebase Investigation\"."
          });
        } else {
          const staleAudit = await runStaleDiagramAudit(
            projectRoot,
            absFile,
            raw,
            codebaseInvestigation
          );
          findings.push({
            section: "Stale Diagram Drift Check",
            required: true,
            rule: "When stale-diagram audit is enabled, blast-radius files must not be newer than current design diagram baseline.",
            found: staleAudit.ok,
            details: staleAudit.details
          });
        }
      }
    }

    // Universal Layer 2.3 structural checks (gstack plan-eng-review). All
    // present-only. Validates regression iron-rule acknowledgment and
    // confidence-calibrated finding format.

    const regressionBody = sectionBodyByName(sections, "Regression Iron Rule");
    if (regressionBody !== null) {
      const ack = markdownFieldRegex("Iron rule acknowledged", "yes|true|y").test(regressionBody);
      findings.push({
        section: "Regression Iron Rule Acknowledgement",
        required: true,
        rule: "Regression Iron Rule section must affirm `Iron rule acknowledged: yes`.",
        found: ack,
        details: ack
          ? "Regression iron rule acknowledged."
          : "Regression Iron Rule is missing explicit `Iron rule acknowledged: yes`."
      });
    }

    const findingsBody = sectionBodyByName(sections, "Calibrated Findings");
    if (findingsBody !== null) {
      const isEmpty = /(^|\n)\s*-\s*None this stage\b/iu.test(findingsBody);
      const findingRegex = new RegExp(CONFIDENCE_FINDING_REGEX_SOURCE, "u");
      const validRows = findingsBody
        .split("\n")
        .filter((line) => /^[-*]\s+\[/u.test(line.trim()))
        .filter((line) => findingRegex.test(line));
      const ok = isEmpty || validRows.length >= 1;
      findings.push({
        section: "Calibrated Finding Format",
        required: true,
        rule: "Calibrated Findings must either declare `None this stage` or contain at least one finding in the form `[P1|P2|P3] (confidence: <n>/10) <path>[:<line>] — <description>`.",
        found: ok,
        details: isEmpty
          ? "No findings recorded for this stage."
          : ok
            ? `Detected ${validRows.length} calibrated finding(s).`
            : "No calibrated findings detected. Use `[P1|P2|P3] (confidence: <n>/10) <repo-path>[:<line>] — <description>`."
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
}
