import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath as resolveStageArtifactPath } from "../artifact-paths.js";
import { exists } from "../fs-utils.js";
import { CONFIDENCE_FINDING_REGEX_SOURCE } from "../content/skills.js";
import type { FlowTrack } from "../types.js";
import {
  type StageLintContext,
  checkCriticPredictionsContract,
  evaluateInvestigationTrace,
  evaluateLayeredDocumentReviewStatus,
  evaluateQaLogFloor,
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

/**
 * parenthetical suffixes that the audit strips
 * from a Codebase Investigation filename cell BEFORE attempting
 * `fs.stat`. The user's quick-tier test wrote `index.html (new)` in
 * the table, and the linter then tried to stat the literal string
 * `index.html (new)` (with the suffix) and failed with "could not
 * read blast-radius file(s): index.html (new)". Authors used these
 * markers as informational labels, not as part of the filename.
 *
 * Stripping happens for ANY parenthetical suffix on the same line as
 * the filename cell so we don't have to enumerate every author
 * convention. For new files (suffix "new"), the audit records
 * "new file, no stale diagrams to detect" instead of trying to stat.
 */
const STALE_DIAGRAM_NEW_FILE_SUFFIX_PATTERN = /\(\s*new(?:[\s-]?file)?\s*\)/iu;
const STALE_DIAGRAM_SKIP_FILE_SUFFIX_PATTERN = /\(\s*(?:n\/a|skip|skipped|deleted|removed|stub|placeholder|tbd)\s*\)/iu;

export interface CodebaseInvestigationFileRef {
  /** Filename to stat (parenthetical suffix already stripped). */
  filename: string;
  /** Raw cell content, useful for diagnostic messages. */
  raw: string;
  /** When true, the audit treats this row as a "new file, no baseline". */
  newFile: boolean;
  /**
   * When true, the audit skips this row entirely (suffix `(skip)`,
   * `(deleted)`, `(stub)`, leading `#`, or a `skip:` token in the
   * Notes column).
   */
  skip: boolean;
}

export function normalizeCodebaseInvestigationFileRef(value: string, notesCell: string): CodebaseInvestigationFileRef | null {
  const cleanedFull = value
    .replace(/`/gu, "")
    .replace(/^\s*[-*]\s*/u, "")
    .trim();
  if (!cleanedFull) return null;
  if (/^#/u.test(cleanedFull)) {
    return { filename: cleanedFull.replace(/^#\s*/u, ""), raw: cleanedFull, newFile: false, skip: true };
  }
  // Strip ANY trailing parenthetical suffix(es) so the audit operates
  // on the raw filename. We loop because authors sometimes stack
  // multiple suffixes (`index.html (new) (stub)`).
  let stripped = cleanedFull;
  let newFile = false;
  let skip = false;
  for (let safety = 0; safety < 4; safety += 1) {
    const trailingParen = /\s*\([^)]*\)\s*$/u.exec(stripped);
    if (!trailingParen) break;
    const parenText = trailingParen[0];
    if (STALE_DIAGRAM_NEW_FILE_SUFFIX_PATTERN.test(parenText)) newFile = true;
    if (STALE_DIAGRAM_SKIP_FILE_SUFFIX_PATTERN.test(parenText)) skip = true;
    stripped = stripped.slice(0, trailingParen.index).trim();
  }
  if (!stripped) return null;
  if (/^(?:file|n\/a|none|\(none\)|tbd|\?)$/iu.test(stripped)) return null;
  // Notes column may carry an explicit `skip:` marker.
  if (/(?:^|\s|\|)skip\s*:/iu.test(notesCell)) skip = true;
  return { filename: stripped, raw: cleanedFull, newFile, skip };
}

export function collectCodebaseInvestigationFiles(sectionBody: string): CodebaseInvestigationFileRef[] {
  const refs: CodebaseInvestigationFileRef[] = [];
  const seen = new Set<string>();
  for (const row of getMarkdownTableRows(sectionBody)) {
    const notesCell = row[row.length - 1] ?? "";
    const fileCell = normalizeCodebaseInvestigationFileRef(row[0] ?? "", notesCell);
    if (!fileCell) continue;
    const key = `${fileCell.filename}|${fileCell.skip}|${fileCell.newFile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(fileCell);
  }
  return refs;
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
  const newFiles: string[] = [];
  const skipped: string[] = [];
  let scanned = 0;
  for (const ref of refs) {
    if (ref.skip) {
      skipped.push(ref.filename);
      continue;
    }
    if (ref.newFile) {
      newFiles.push(ref.filename);
      continue;
    }
    const absPath = path.isAbsolute(ref.filename) ? ref.filename : path.join(projectRoot, ref.filename);
    if (!(await exists(absPath))) {
      missing.push(ref.filename);
      continue;
    }
    let fileStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      fileStat = await fs.stat(absPath);
    } catch {
      missing.push(ref.filename);
      continue;
    }
    if (!fileStat.isFile()) continue;
    scanned += 1;
    if (fileStat.mtimeMs > artifactStat.mtimeMs) {
      stale.push(ref.filename);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      details: `Stale Diagram Audit could not read blast-radius file(s): ${missing.join(", ")}. Strip parenthetical suffixes like \` (new)\`, \` (deleted)\`, \` (stub)\` from the filename column, mark new files as \`<path> (new)\`, or add a leading \`#\` to the filename to skip the row.`
    };
  }
  const noteParts: string[] = [];
  if (skipped.length > 0) noteParts.push(`${skipped.length} skipped (${skipped.join(", ")})`);
  if (newFiles.length > 0) noteParts.push(`${newFiles.length} new file(s) with no stale diagrams to detect (${newFiles.join(", ")})`);
  const notes = noteParts.length > 0 ? `; ${noteParts.join("; ")}` : "";
  if (scanned === 0 && newFiles.length === 0 && skipped.length === 0) {
    return {
      ok: false,
      details: "Stale Diagram Audit found no readable blast-radius files in Codebase Investigation."
    };
  }
  if (stale.length > 0) {
    return {
      ok: false,
      details: `Stale Diagram Audit flagged stale file(s) newer than diagram baseline: ${stale.join(", ")}${notes}.`
    };
  }
  return {
    ok: true,
    details: `Stale Diagram Audit clear: ${scanned} blast-radius file(s) are not newer than diagram baseline${notes}.`
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
    isTrivialOverride,
    activeStageFlags
  } = ctx;
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    const qaLogBody = sectionBodyByName(sections, "Q&A Log");
    const qaLogRows = qaLogBody ? getMarkdownTableRows(qaLogBody) : [];
    const qaLogOk = qaLogBody !== null && qaLogRows.length > 0;
    findings.push({
      section: "qa_log_missing",
      required: false,
      rule: "[P2] qa_log_missing — Q&A Log empty — confirm you actually had a dialogue with the user, not a draft from memory.",
      found: qaLogOk,
      details: qaLogOk
        ? `Q&A Log contains ${qaLogRows.length} data row(s).`
        : qaLogBody === null
          ? "Missing `## Q&A Log` section."
          : "Q&A Log is present but has zero data rows."
    });

    {
      const skipQuestions = activeStageFlags.includes("--skip-questions");
      const floor = evaluateQaLogFloor(qaLogBody, track, "design", { discoveryMode: ctx.discoveryMode, skipQuestions });
      findings.push({
        section: "qa_log_unconverged",
        required: !floor.skipQuestionsAdvisory,
        rule: "[P1] qa_log_unconverged — Q&A Log has not converged for this stage. Continue elicitation until every forcing-question topic id is tagged with `[topic:<id>]` on at least one row, the last 2 rows produce no decision-changing impact (Ralph-Loop), or an explicit user stop-signal row is appended.",
        found: floor.ok,
        details: floor.details
      });
    }
    const criticPredictions = checkCriticPredictionsContract(sections);
    if (criticPredictions !== null) {
      findings.push({
        section: "critic.predictions_missing",
        required: false,
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
        required: false,
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
        required: false,
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
