import { createHash } from "node:crypto";
import { SHIP_FINALIZATION_MODES } from "../constants.js";
import { questionBudgetHint } from "../track-heuristics.js";
import { FLOW_STAGES, type DiscoveryMode, type FlowStage, type FlowTrack } from "../types.js";
import { stageSchema } from "../content/stage-schema.js";

/**
 * Recognized stop-signal phrases that satisfy the Q&A floor escape hatch
 * when recorded as a Q&A Log row. Mirrors `Stop Signals (Natural Language)`
 * in `adaptive-elicitation/SKILL.md`.
 */
/**
 * Stop-signal phrases. ASCII tokens use `\b` word boundaries; non-ASCII
 * (RU/UA) tokens use Unicode-aware boundaries built from `\p{L}` so cyrillic
 * characters around the phrase prevent partial matches without breaking on
 * `\b`'s ASCII-only boundary semantics.
 */
const QA_LOG_STOP_SIGNAL_PATTERNS: RegExp[] = [
  /\bstop[-\s]?signal\b/iu,
  /\bachieved\s+enough\b/iu,
  /\benough\b/iu,
  /\bskip\b/iu,
  /\bjust\s+draft\s+it\b/iu,
  /\bstop\s+asking\b/iu,
  /\bmove\s+on\b/iu,
  /\bno\s+more\s+questions\b/iu,
  /(?<![\p{L}\p{N}_])достаточно(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])хватит(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])давай\s+драфт(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])досить(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])вистачить(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])рухаємось\s+далі(?![\p{L}\p{N}_])/iu
];

/**
 * Stages that run adaptive elicitation. The `qa_log_unconverged` rule
 * only fires for these. Other stages may still record a Q&A Log but no
 * convergence floor is enforced.
 */
export const ELICITATION_STAGES: ReadonlySet<FlowStage> = new Set<FlowStage>([
  "brainstorm",
  "scope",
  "design"
]);

/**
 * Phrases that mark a Q&A Log row as "no new decision" — used by the
 * Ralph-Loop convergence detector. When the last 2 substantive rows have
 * a Decision impact tagged with one of these phrases, convergence has
 * been reached even if not every forcing question was explicitly
 * addressed.
 */
const QA_LOG_NO_DECISION_TOKENS: RegExp[] = [
  /\bskip(?:ped)?\b/iu,
  /\bcontinue\b/iu,
  /\bno[-\s]?change\b/iu,
  /\bno[-\s]?decision\b/iu,
  /\bno[-\s]?op\b/iu,
  /\bnoop\b/iu,
  /\bdone\b/iu,
  /\bsame\b/iu,
  /\bok\b/iu
];

/**
 * Language-neutral forcing-question topic descriptor.
 *
 * Each forcing-question row in a stage's checklist declares topics as
 * `id: human-readable label` pairs (e.g. `pain: what pain are we solving`).
 * The `id` (kebab-case ASCII) is the machine-key authors stamp on Q&A Log
 * rows via `[topic:<id>]` so the linter can verify coverage in ANY natural
 * language (RU/EN/UA/etc.). English keyword detection is intentionally
 * absent because it silently mis-reports convergence on RU/UA Q&A.
 */
export interface ForcingQuestionTopic {
  id: string;
  topic: string;
}

export interface QaLogFloorOptions {
  discoveryMode?: DiscoveryMode;
  /**
   * When true, downgrades the finding to advisory (`required: false`).
   * Set when `--skip-questions` was persisted to the active stage flags.
   */
  skipQuestions?: boolean;
  /**
   * Optional pre-extracted forcing-question topic descriptors. When
   * omitted, the evaluator calls `extractForcingQuestions(stage)` which
   * scans the stage's checklist row. Strings are accepted as topic IDs
   * (label = id) for callers that build their own list.
   */
  forcingQuestions?: ReadonlyArray<ForcingQuestionTopic | string>;
}

export interface QaLogFloorResult {
  /** Whether convergence is satisfied (passes the gate). */
  ok: boolean;
  /** Substantive Q&A Log row count (excludes `skipped`/`waived` only rows). */
  count: number;
  /**
   * Legacy field, retained for harness UI compatibility. Always 0 in
   * the convergence floor no longer enforces a fixed count.
   * Harness can still surface `questionBudgetHint(track, stage).recommended`
   * as a soft hint, but it is NOT tied to gate blocking.
   */
  min: number;
  /** Whether a stop-signal row was detected. */
  hasStopSignal: boolean;
  /**
   * Legacy field, retained for harness UI compatibility. Always false in
   * convergence semantics replaced the lite-tier short-circuit.
   */
  liteShortCircuit: boolean;
  /** Whether `--skip-questions` flag downgraded the finding to advisory. */
  skipQuestionsAdvisory: boolean;
  /** Forcing-question topics deemed addressed (substring match in Q&A). */
  forcingCovered: string[];
  /** Forcing-question topics still pending (no matching Q&A row). */
  forcingPending: string[];
  /**
   * True when the last 2 substantive rows have decision_impact marking
   * `skip`/`continue`/`no-change`/`done`/etc. — i.e. Q&A is no longer
   * surfacing decision-changing answers (Ralph-Loop convergence detector).
   */
  noNewDecisions: boolean;
  /** Human-readable details for the linter finding. */
  details: string;
}

/**
 * Decide whether a Q&A Log row counts as a "substantive" entry. Rows
 * whose decision_impact column reads `skipped` / `waived` only do not
 * count.
 */
function isSubstantiveQaRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  const last = cells[cells.length - 1] ?? "";
  const normalized = last.toLowerCase();
  if (/^\s*(?:skipped|waived)\b/u.test(normalized)) return false;
  return true;
}

/**
 * Detect a stop-signal row in the Q&A Log. Pattern is matched across
 * all cells of any row so the user's quote can live in any column.
 */
function detectStopSignal(rows: string[][]): boolean {
  for (const row of rows) {
    const joined = row.join(" | ");
    for (const pattern of QA_LOG_STOP_SIGNAL_PATTERNS) {
      if (pattern.test(joined)) return true;
    }
  }
  return false;
}

/**
 * Validate the kebab-case ASCII shape of a forcing-question topic ID.
 * IDs are short, language-neutral identifiers authors can paste into a
 * `[topic:<id>]` tag without typos.
 */
const TOPIC_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

function isValidTopicId(id: string): boolean {
  return TOPIC_ID_PATTERN.test(id);
}

/**
 * Parse a single checklist row into the list of forcing-question topic
 * descriptors it declares. Returns `null` when the row is not a
 * forcing-questions header. Throws when the header is found but its
 * body does not match the `id: topic; id: topic; ...` syntax — authors
 * fix the stage definition rather than silently ship un-coverable
 * topics.
 *
 * Exposed for unit tests that exercise the parser without depending on
 * the live stage schema.
 */
export function parseForcingQuestionsRow(
  row: string,
  context: string = "row"
): ForcingQuestionTopic[] | null {
  const headerMatch = /\*\*\s*[A-Za-z]+\s+forcing\s+questions\s*\([^)]*\)\s*\*\*\s*(?:[—\-–:]+)?\s*(.+)/iu.exec(
    row
  );
  if (!headerMatch) return null;
  const body = (headerMatch[1] ?? "").trim();
  if (body.length === 0) return [];
  // Take everything up to the first sentence-ending `.` followed by a
  // space + capital letter. We split on `;` only; commas are part of
  // human labels. Authors stop the list with `.` so the trailing
  // prose ("Tag the matching ...") is excluded.
  const listSection = body.split(/\.\s+(?=[A-Z])/u)[0] ?? body;
  const segments = listSection
    .split(/;\s*/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const topics: ForcingQuestionTopic[] = [];
  for (const segment of segments) {
    const match = /^[`*_]?\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*[`*_]?\s*:\s*(.+?)\s*$/u.exec(segment);
    if (!match) {
      throw new Error(
        `parseForcingQuestionsRow(${context}): segment "${segment}" does not match required \`id: topic\` syntax. Use \`id: topic; id: topic; ...\` form.`
      );
    }
    const id = (match[1] ?? "").toLowerCase();
    const topic = (match[2] ?? "").replace(/[`*_]+$/u, "").trim();
    if (!isValidTopicId(id)) {
      throw new Error(
        `parseForcingQuestionsRow(${context}): invalid topic id "${id}" in segment "${segment}". IDs must match ${TOPIC_ID_PATTERN.source}.`
      );
    }
    if (topic.length === 0) {
      throw new Error(
        `parseForcingQuestionsRow(${context}): empty topic label after id "${id}" in segment "${segment}".`
      );
    }
    topics.push({ id, topic });
  }
  return topics;
}

/**
 * Extract forcing-question topics from a stage's checklist.
 *
 * Only the `id: topic; id: topic; ...` syntax is accepted. Throws when
 * the syntax is malformed so authors fix the stage definition rather
 * than silently shipping un-coverable topics.
 *
 * Returns empty array when no forcing-questions row is present (caller
 * treats absence as "no forcing requirement" — convergence falls back
 * to the no-new-decisions / stop-signal detectors). Returning [] when
 * the row exists but lists no segments is also legal.
 */
export function extractForcingQuestions(stage: FlowStage): ForcingQuestionTopic[] {
  let checklist: readonly string[];
  try {
    checklist = stageSchema(stage).executionModel.checklist;
  } catch {
    return [];
  }
  for (const row of checklist) {
    const parsed = parseForcingQuestionsRow(row, `stage=${stage}`);
    if (parsed === null) continue;
    return parsed;
  }
  return [];
}

/**
 * Detect whether a Q&A Log row carries an explicit `[topic:<id>]` tag
 * for the requested forcing-topic id. Matching is case-insensitive on
 * the id, ASCII-only on the tag boundary. NO keyword fallback: the user
 * must stamp the tag in any cell of the row.
 */
function isTopicAddressed(id: string, rows: string[][]): boolean {
  const needle = id.toLowerCase();
  const tagPattern = /\[topic:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*\]/giu;
  for (const row of rows) {
    const haystack = row.join(" | ");
    tagPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(haystack)) !== null) {
      const candidate = (match[1] ?? "").toLowerCase();
      if (candidate === needle) return true;
    }
  }
  return false;
}

function lastTwoRowsAllNoDecision(substantiveRows: string[][]): boolean {
  if (substantiveRows.length < 2) return false;
  const tail = substantiveRows.slice(-2);
  for (const row of tail) {
    const decisionImpact = (row[row.length - 1] ?? "").trim();
    if (decisionImpact.length === 0) return false;
    const matched = QA_LOG_NO_DECISION_TOKENS.some((pattern) => pattern.test(decisionImpact));
    if (!matched) return false;
  }
  return true;
}

/**
 * Evaluate the Q&A Log convergence floor for a brainstorm / scope /
 * design artifact. Returns ok=true when convergence is reached or any
 * escape hatch fires.
 *
 * Convergence sources (any one can set ok=true — see also
 * `adaptiveElicitationSkillMarkdown`):
 * - Every forcing-question topic id from the stage checklist is tagged
 *   `[topic:<id>]` on at least one `## Q&A Log` row.
 * - Ralph-Loop path: last 2 substantive rows read as no-new-decisions,
 *   substantive count ≥ max(2, questionBudgetHint(discoveryMode, stage).min),
 *   and not (guided/deep discovery with pending forcing-topic ids).
 * - Stop-signal row (`QA_LOG_STOP_SIGNAL_PATTERNS`).
 * - `--skip-questions` (`options.skipQuestions`): ok remains false but
 *   `skipQuestionsAdvisory` is true (linter treats as non-blocking).
 * - No forcing-questions row in the checklist and ≥1 substantive row.
 *
 * `[topic:<id>]` is the sole topic-coverage signal. The `min` and
 * `liteShortCircuit` fields stay for harness compatibility (min is
 * always 0; liteShortCircuit false).
 */
export function evaluateQaLogFloor(
  qaLogBody: string | null,
  track: FlowTrack,
  stage: FlowStage,
  options: QaLogFloorOptions = {}
): QaLogFloorResult {
  const rows = qaLogBody !== null ? getMarkdownTableRows(qaLogBody) : [];
  const substantiveRows = rows.filter(isSubstantiveQaRow);
  const count = substantiveRows.length;
  const hasStopSignal = detectStopSignal(rows);
  const skipQuestionsAdvisory = options.skipQuestions === true;
  const discoveryMode = options.discoveryMode ?? (track === "quick" ? "lean" : "guided");

  const forcingTopics: ForcingQuestionTopic[] = (options.forcingQuestions ?? extractForcingQuestions(stage)).map(
    (entry) => (typeof entry === "string" ? { id: entry, topic: entry } : entry)
  );
  const forcingCovered: string[] = [];
  const forcingPending: string[] = [];
  for (const topic of forcingTopics) {
    if (isTopicAddressed(topic.id, rows)) forcingCovered.push(topic.id);
    else forcingPending.push(topic.id);
  }

  const budget = questionBudgetHint(discoveryMode, stage);
  const noNewDecisions = lastTwoRowsAllNoDecision(substantiveRows);
  const allForcingCovered =
    forcingTopics.length > 0 ? forcingPending.length === 0 : count >= 1;
  const minimumRowsReached = count >= Math.max(2, budget.min);
  const riskEscalationNeeded = forcingPending.length > 0 && /^(guided|deep)$/u.test(discoveryMode);
  const noNewDecisionConverged = noNewDecisions && minimumRowsReached && !riskEscalationNeeded;

  const ok = allForcingCovered || noNewDecisionConverged || hasStopSignal;

  const pendingIdsBracket = forcingPending.length > 0
    ? `[${forcingPending.join(", ")}]`
    : "[none]";

  let details: string;
  if (ok) {
    if (allForcingCovered && forcingTopics.length > 0) {
      details = `Q&A Log converged: all ${forcingTopics.length} forcing-question topic(s) addressed across ${count} substantive row(s).`;
    } else if (allForcingCovered) {
      details = `Q&A Log converged: stage exposes no forcing-questions row and ${count} substantive entry recorded.`;
    } else if (noNewDecisionConverged) {
      const remaining = forcingPending.length > 0
        ? ` ${forcingPending.length} forcing topic IDs still pending: ${pendingIdsBracket} after the minimum ${budget.min}-row discovery pass.`
        : ` Ralph-Loop convergence detector says no new decision-changing rows in the last 2 turns after the minimum ${budget.min}-row discovery pass.`;
      details = `Q&A Log converged via no-new-decisions detector at ${count} row(s).${remaining}`;
    } else {
      details = `Q&A Log converged: explicit user stop-signal row recorded at ${count} row(s).`;
    }
  } else if (skipQuestionsAdvisory) {
    details = `Q&A Log unconverged at ${count} row(s); --skip-questions flag downgraded the finding to advisory. Forcing topic IDs pending: ${pendingIdsBracket}.`;
  } else if (noNewDecisions && !minimumRowsReached) {
    details = `Q&A Log still below the minimum ${budget.min}-row ${discoveryMode} discovery pass (${count} substantive row(s)). Forcing topic IDs pending: ${pendingIdsBracket}. Continue asking decision-changing questions before drafting.`;
  } else if (riskEscalationNeeded && noNewDecisions) {
    details = `Q&A Log cannot converge via Ralph-Loop yet because ${discoveryMode} mode keeps pending forcing topic IDs blocking: ${pendingIdsBracket}. Cover the remaining topics or record an explicit stop-signal row.`;
  } else {
    details = `Q&A Log unconverged at ${count} row(s). Forcing topic IDs pending: ${pendingIdsBracket}. Tag each Q&A row with \`[topic:<id>]\` to mark coverage, complete the minimum ${budget.min}-row ${discoveryMode} discovery pass, or record an explicit user stop-signal row.`;
  }

  const advisoryBudget = budget.recommended;

  return {
    ok,
    count,
    min: 0,
    hasStopSignal,
    liteShortCircuit: false,
    skipQuestionsAdvisory,
    forcingCovered,
    forcingPending,
    noNewDecisions: noNewDecisionConverged,
    details: advisoryBudget > 0
      ? `${details} (advisory budget for ${discoveryMode}/${stage}: ~${advisoryBudget} Q&A turns)`
      : details
  };
}

export interface LintFinding {
  section: string;
  required: boolean;
  rule: string;
  found: boolean;
  details: string;
}

export interface LintFindingDedupSummary {
  newCount: number;
  repeatCount: number;
  resolvedCount: number;
  /**
   * Short single-line human-facing summary of the dedup outcome. Empty
   * string when there is nothing to report.
   */
  header: string;
  /**
   * Parallel to the `findings` array on `LintResult`; each status tags
   * the finding at the same index as `new`, `repeat`, or `resolved`.
   * `null` slots correspond to findings that weren't classified (for
   * example, when the dedup cache is unreadable).
   */
  statuses: Array<
    | { kind: "new" }
    | { kind: "repeat"; count: number }
    | { kind: "resolved" }
    | null
  >;
}

export interface LintResult {
  stage: string;
  file: string;
  passed: boolean;
  findings: LintFinding[];
  dedup?: LintFindingDedupSummary;
}

export function normalizeHeadingTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export type H2SectionMap = Map<string, string>;

/**
 * Collect H2 sections and body content (`## Section Name`).
 *
 * - Ignores lines that live inside fenced code blocks (``` / ~~~) so a
 *   commented `## Approaches` inside an example doesn't open a phantom
 *   section and swallow real content.
 * - When the same heading appears more than once at the top level we
 *   concatenate the bodies rather than silently overwriting the earlier
 *   occurrence. This keeps lint rules honest when authors split a section
 *   into multiple passes.
 */
export function extractH2Sections(markdown: string): H2SectionMap {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  let fenced: string | null = null;

  const flush = (): void => {
    if (currentHeading === null) return;
    const existing = sections.get(currentHeading);
    const body = buffer.join("\n");
    sections.set(
      currentHeading,
      existing === undefined ? body : `${existing}\n${body}`
    );
  };

  for (const line of lines) {
    const fenceMatch = /^(```|~~~)/u.exec(line);
    if (fenceMatch) {
      if (fenced === null) {
        fenced = fenceMatch[1] ?? null;
      } else if (line.startsWith(fenced)) {
        fenced = null;
      }
      if (currentHeading !== null) buffer.push(line);
      continue;
    }
    if (fenced === null) {
      const match = /^##\s+(.+)$/u.exec(line);
      if (match) {
        flush();
        currentHeading = normalizeHeadingTitle(match[1] ?? "");
        buffer = [];
        continue;
      }
    }
    if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

export function duplicateH2Headings(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  let fenced: string | null = null;
  const counts = new Map<string, number>();
  const displayHeading = new Map<string, string>();

  for (const line of lines) {
    const fenceMatch = /^(```|~~~)/u.exec(line);
    if (fenceMatch) {
      if (fenced === null) {
        fenced = fenceMatch[1] ?? null;
      } else if (line.startsWith(fenced)) {
        fenced = null;
      }
      continue;
    }
    if (fenced !== null) continue;

    const match = /^##\s+(.+)$/u.exec(line);
    if (!match) continue;
    const heading = normalizeHeadingTitle(match[1] ?? "");
    const key = heading.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!displayHeading.has(key)) {
      displayHeading.set(key, heading);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => displayHeading.get(key) ?? key);
}

/**
 * Return the author-authored prose of an artifact, stripping linter meta
 * regions so free-text scans (placeholder tokens, scope-reduction phrases,
 * investigation trigger words) don't self-cannibalize by matching the
 * linter's own templated meta-phrases.
 *
 * Stripping rules (in order):
 *   1. `<!-- linter-meta --> ... <!-- /linter-meta -->` paired blocks.
 *      Both markers must appear on their own line; unterminated openings
 *      are left as-is so a malformed artifact cannot hide arbitrary
 *      content by omitting the closing marker.
 *   2. Every other HTML comment (`<!-- ... -->`, possibly multi-line).
 *   3. Fenced code blocks that are tagged `linter-rule` (e.g.
 *      ```` ```linter-rule ````). Plain fenced code blocks are preserved
 *      because many stages quote code samples that the linter should
 *      still see.
 *
 * The function guarantees the returned string is a strict subset of the
 * original: no characters are synthesized, and line offsets are
 * preserved for any surviving line (blank lines stand in for stripped
 * regions). This keeps regex-based linter checks stable when authors
 * add or remove linter-meta blocks between runs.
 */
export function extractAuthoredBody(rawArtifact: string): string {
  if (typeof rawArtifact !== "string" || rawArtifact.length === 0) {
    return "";
  }
  const linterMetaBlock = /^[ \t]*<!--\s*linter-meta\s*-->[\s\S]*?^[ \t]*<!--\s*\/linter-meta\s*-->[ \t]*$/gmu;
  let body = rawArtifact.replace(linterMetaBlock, (match) =>
    match.replace(/[^\n]/gu, "")
  );
  const htmlComment = /<!--[\s\S]*?-->/gu;
  body = body.replace(htmlComment, (match) => match.replace(/[^\n]/gu, ""));
  const linterRuleFence = /^([ \t]*)(`{3,}|~{3,})\s*linter-rule\b[^\n]*\n[\s\S]*?\n\1\2[ \t]*$/gmu;
  body = body.replace(linterRuleFence, (match) => match.replace(/[^\n]/gu, ""));
  return body;
}

export function headingPresent(sections: H2SectionMap, section: string): boolean {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const h of sections.keys()) {
    if (h.toLowerCase() === want) {
      return true;
    }
  }
  return false;
}

export function sectionBodyByName(sections: H2SectionMap, section: string): string | null {
  const want = normalizeHeadingTitle(section).toLowerCase();
  for (const [heading, body] of sections.entries()) {
    if (heading.toLowerCase() === want) {
      return body;
    }
  }
  return null;
}

export function sectionBodyByAnyName(sections: H2SectionMap, sectionNames: string[]): string | null {
  const bodies = sectionNames.flatMap((section) => {
    const body = sectionBodyByName(sections, section);
    return body === null ? [] : [`### ${section}\n${body}`];
  });
  if (bodies.length === 0) return null;
  return bodies.join("\n");
}

export function sectionBodyByHeadingPrefix(sections: H2SectionMap, prefix: string): string | null {
  const want = normalizeHeadingTitle(prefix).toLowerCase();
  for (const [heading, body] of sections.entries()) {
    if (heading.toLowerCase().startsWith(want)) {
      return body;
    }
  }
  return null;
}

export interface CriticPredictionsContractCheck {
  found: boolean;
  details: string;
}

export function checkCriticPredictionsContract(
  sections: H2SectionMap
): CriticPredictionsContractCheck | null {
  const criticFindingsBody = sectionBodyByName(sections, "Critic Findings");
  const layeredReviewBody = sectionBodyByHeadingPrefix(sections, "Layered review");
  const layeredReviewMentionsCritic =
    layeredReviewBody !== null && /\bcritic\b/iu.test(layeredReviewBody);
  const sourceBody = criticFindingsBody ?? (layeredReviewMentionsCritic ? layeredReviewBody : null);
  if (sourceBody === null) return null;

  const predictionsMatch =
    /(?:^|\n)#{3,4}\s*Pre-commitment predictions\b([\s\S]*?)(?=\n#{2,4}\s+|$)/iu.exec(sourceBody);
  const predictionsCount = predictionsMatch ? countListItems(predictionsMatch[1] ?? "") : 0;
  const hasPredictions = predictionsCount >= 1;
  const hasValidated = /(?:^|\n)#{3,4}\s*Validated\s*\/\s*Disproven\b/iu.test(sourceBody);
  const hasOpenQuestions = /(?:^|\n)#{3,4}\s*Open Questions\b/iu.test(sourceBody);

  const missing: string[] = [];
  if (!hasPredictions) {
    missing.push("`Pre-commitment predictions` subsection is missing or has no list items");
  }
  if (!hasValidated) {
    missing.push("`Validated / Disproven` subsection is missing");
  }
  if (!hasOpenQuestions) {
    missing.push("`Open Questions` subsection is missing");
  }

  return {
    found: missing.length === 0,
    details:
      missing.length === 0
        ? "Critic pre-commitment predictions contract is present (predictions, validated/disproven mapping, open questions)."
        : missing.join("; ")
  };
}

const DOCUMENT_REVIEWER_NAMES = [
  "coherence-reviewer",
  "scope-guardian-reviewer",
  "feasibility-reviewer"
] as const;

export interface LayeredDocumentReviewStatus {
  triggeredReviewers: string[];
  missingStructured: string[];
  failOrPartialWithoutWaiver: string[];
}

export function evaluateLayeredDocumentReviewStatus(
  sections: H2SectionMap,
  confidenceFindingRegexSource: string
): LayeredDocumentReviewStatus | null {
  const layeredReviewBody = sectionBodyByHeadingPrefix(sections, "Layered review");
  if (layeredReviewBody === null) return null;

  const triggeredReviewers = DOCUMENT_REVIEWER_NAMES.filter((reviewer) =>
    new RegExp(`\\b${reviewer}\\b`, "iu").test(layeredReviewBody)
  );
  if (triggeredReviewers.length === 0) return null;

  const findingRegex = new RegExp(confidenceFindingRegexSource, "iu");
  const hasCalibratedFinding = findingRegex.test(layeredReviewBody);
  const missingStructured: string[] = [];
  const failOrPartialWithoutWaiver: string[] = [];
  const waiverRegex = /(?:explicit\s+waiver|waiver\s*:|waived\s*:|accepted[-\s]?risk)/iu;

  for (const reviewer of triggeredReviewers) {
    const escaped = reviewer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const subsectionMatch =
      new RegExp(`(?:^|\\n)#{3,4}\\s*${escaped}\\b([\\s\\S]*?)(?=\\n#{2,4}\\s+|$)`, "iu")
        .exec(layeredReviewBody);
    const reviewerBlock = subsectionMatch?.[1] ?? layeredReviewBody;
    const statusMatch = /\b(?:Status|Result|Verdict)\s*:\s*(PASS|PASS_WITH_GAPS|FAIL|PARTIAL|BLOCKED)\b/iu
      .exec(reviewerBlock);
    const inlineStatusMatch =
      new RegExp(`${escaped}[\\s\\S]{0,120}\\b(PASS|PASS_WITH_GAPS|FAIL|PARTIAL|BLOCKED)\\b`, "iu")
        .exec(layeredReviewBody);
    const status = (statusMatch?.[1] ?? inlineStatusMatch?.[1] ?? "").toUpperCase();
    if (!hasCalibratedFinding || status.length === 0) {
      missingStructured.push(reviewer);
    }
    if ((status === "FAIL" || status === "PARTIAL") && !waiverRegex.test(reviewerBlock) && !waiverRegex.test(layeredReviewBody)) {
      failOrPartialWithoutWaiver.push(`${reviewer}:${status}`);
    }
  }

  return {
    triggeredReviewers,
    missingStructured,
    failOrPartialWithoutWaiver
  };
}

/**
 * Build a regex that matches `<field>: <value>` even when the field name
 * and/or value are wrapped in markdown emphasis (`*`, `**`, `_`, `__`).
 *
 * The shipped templates render fields as `- **Field name:** value`, so any
 * structural check that searches for `Field:\s*token` against the rendered
 * artifact must tolerate the closing `**` between the colon and the value.
 *
 * `field` is treated as literal text (regex meta-characters are escaped).
 * `value` is inserted verbatim so callers can pass alternation
 * (`STARTUP|BUILDER|...`). `flags` defaults to case-insensitive Unicode.
 */
export function markdownFieldRegex(field: string, value: string, flags = "iu"): RegExp {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const emph = "[*_]{0,2}";
  const source =
    `(?:^|[\\s>])${emph}\\s*${escapedField}\\s*${emph}\\s*:\\s*${emph}\\s*(?:${value})\\b`;
  return new RegExp(source, flags);
}

export function extractMarkdownSectionBody(markdown: string, section: string): string | null {
  return sectionBodyByName(extractH2Sections(markdown), section);
}

export function headingLineIndex(markdown: string, section: string): number {
  const want = normalizeHeadingTitle(section).toLowerCase();
  const lines = markdown.split(/\r?\n/);
  let fenced: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```+|~~~+)\s*([A-Za-z0-9_-]+)?\s*$/u.exec(line);
    if (fence) {
      const marker = fence[1]!;
      if (fenced === null) {
        fenced = marker;
      } else if (fenced === marker) {
        fenced = null;
      }
      continue;
    }
    if (fenced !== null) continue;
    const heading = /^##\s+(.+)$/u.exec(line);
    if (!heading) continue;
    if (normalizeHeadingTitle(heading[1] ?? "").toLowerCase() === want) {
      return i;
    }
  }
  return -1;
}

export function parseShortCircuitStatus(sectionBody: string | null): string {
  if (!sectionBody) return "";
  const lines = sectionBody.split(/\r?\n/u);
  return lines
    .map((line) => line.replace(/[*_`]/gu, "").trim())
    .map((line) => /^[-*]?\s*status\s*:\s*(.+)$/iu.exec(line)?.[1] ?? "")
    .find((value) => value.trim().length > 0)?.trim().toLowerCase() ?? "";
}

export function isShortCircuitActivated(sectionBody: string | null): boolean {
  const statusValue = parseShortCircuitStatus(sectionBody);
  return /^(?:activated|yes|true)$/u.test(statusValue) || /\bactivated\b/iu.test(statusValue);
}

export function meaningfulLineCount(sectionBody: string): number {
  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("<!--"))
    .filter((line) => !/^[-:| ]+$/u.test(line))
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .length;
}

export function lineHasToken(line: string, token: string): boolean {
  return new RegExp(`\\b${token}\\b`, "u").test(line);
}

export function countListItems(sectionBody: string): number {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const bullets = lines.filter((line) => /^[-*]\s+\S+/u.test(line)).length;
  const tableRows = lines.filter((line) => /^\|.*\|$/u.test(line) && !/^\|[-:| ]+\|$/u.test(line));
  const tableDataRows = tableRows.length > 0 ? Math.max(0, tableRows.length - 1) : 0;
  return Math.max(bullets, tableDataRows);
}

export function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

export function tableHeaderCells(sectionBody: string): string[] | null {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /^\|.*\|$/u.test(line));
  if (headerIndex < 0) return null;
  const separator = lines[headerIndex + 1];
  if (!separator || !/^\|[-:| ]+\|$/u.test(separator)) {
    return null;
  }
  return parseMarkdownTableRow(lines[headerIndex]);
}

export function extractMinItemsFromRule(rule: string): number | null {
  const match = /at least\s+(\d+)/iu.exec(rule);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tokensFromRule(rule: string): string[] {
  const allCaps = rule.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [];
  if (allCaps.length > 0) {
    return [...new Set(allCaps)];
  }
  if (/finalization enum token/iu.test(rule)) {
    return [...SHIP_FINALIZATION_MODES];
  }
  if (/final verdict/iu.test(rule)) {
    return ["APPROVED", "APPROVED_WITH_CONCERNS", "BLOCKED"];
  }
  return [];
}

export const VAGUE_AC_ADJECTIVES = [
  "fast",
  "quick",
  "slow",
  "fast enough",
  "quickly",
  "intuitive",
  "robust",
  "reliable",
  "scalable",
  "simple",
  "easy",
  "user-friendly",
  "user friendly",
  "nice",
  "good",
  "clean",
  "secure enough",
  "responsive",
  "efficient",
  "performant",
  "smooth",
  "seamless",
  "modern"
];

export function isSeparatorRow(line: string): boolean {
  return /^\|[-:| ]+\|$/u.test(line);
}

export function getMarkdownTableRows(sectionBody: string): string[][] {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const rows: string[][] = [];
  let sawSeparator = false;
  for (const line of lines) {
    if (!/^\|.*\|$/u.test(line)) continue;
    if (isSeparatorRow(line)) {
      sawSeparator = true;
      continue;
    }
    if (!sawSeparator) continue;
    rows.push(parseMarkdownTableRow(line));
  }
  return rows;
}

export type BinaryFlag = "yes" | "no" | "unknown";

export function parseBinaryFlag(value: string): BinaryFlag {
  const normalized = value.trim().toLowerCase();
  if (/^(?:y|yes|true|1)$/u.test(normalized)) return "yes";
  if (/^(?:n|no|false|0|none)$/u.test(normalized)) return "no";
  return "unknown";
}

export function parseKeyedBinaryFlag(value: string, key: string): BinaryFlag {
  const match = new RegExp(`${key}\\s*=\\s*(y|yes|true|1|n|no|false|0)`, "iu").exec(value);
  if (!match) return "unknown";
  return /^(?:y|yes|true|1)$/iu.test(match[1] ?? "") ? "yes" : "no";
}

export function parseFailureModeRescueFlag(rescueCell: string): BinaryFlag {
  const keyed = parseKeyedBinaryFlag(rescueCell, "rescued");
  if (keyed !== "unknown") return keyed;
  const direct = parseBinaryFlag(rescueCell);
  if (direct !== "unknown") return direct;
  if (/\b(?:no rescue|without rescue|unrescued|no fallback|none|absent)\b/iu.test(rescueCell)) {
    return "no";
  }
  if (/\b(?:fallback|retry|degrade|recover|rescue|mitigat)\b/iu.test(rescueCell)) {
    return "yes";
  }
  return "unknown";
}

export function parseFailureModeTestFlag(rowText: string): BinaryFlag {
  const keyed = parseKeyedBinaryFlag(rowText, "test");
  if (keyed !== "unknown") return keyed;
  if (/\b(?:no tests?|untested|without tests?)\b/iu.test(rowText)) {
    return "no";
  }
  if (/\b(?:tested|has tests?|with tests?|covered by tests?)\b/iu.test(rowText)) {
    return "yes";
  }
  return "unknown";
}

export function validateFailureModeTable(sectionBody: string): { ok: boolean; details: string } {
  const header = tableHeaderCells(sectionBody);
  if (!header) {
    return {
      ok: false,
      details: "Failure Mode Table must include a markdown header row and separator."
    };
  }
  const expectedHeader = ["Method", "Exception", "Rescue", "UserSees"];
  const normalizedHeader = header.map((cell) => cell.toLowerCase());
  const normalizedExpected = expectedHeader.map((cell) => cell.toLowerCase());
  const headerMatches =
    normalizedHeader.length === normalizedExpected.length &&
    normalizedHeader.every((cell, index) => cell === normalizedExpected[index]);
  if (!headerMatches) {
    return {
      ok: false,
      details: `Failure Mode Table header must be exactly: ${expectedHeader.join(" | ")}.`
    };
  }
  const rows = getMarkdownTableRows(sectionBody);
  if (rows.length === 0) {
    return {
      ok: false,
      details: "Failure Mode Table must include at least one data row."
    };
  }
  for (const [index, row] of rows.entries()) {
    if (row.length < 4) {
      return {
        ok: false,
        details: `Failure Mode Table row ${index + 1} must provide 4 columns (Method, Exception, Rescue, UserSees).`
      };
    }
    const method = (row[0] ?? "").trim();
    const exception = (row[1] ?? "").trim();
    const rescue = (row[2] ?? "").trim();
    const userSees = (row[3] ?? "").trim();
    if (!method || !exception || !rescue || !userSees) {
      return {
        ok: false,
        details: `Failure Mode Table row ${index + 1} must populate all columns (Method, Exception, Rescue, UserSees).`
      };
    }
    const rescueFlag = parseFailureModeRescueFlag(rescue);
    const testFlag = parseFailureModeTestFlag(`${method} ${exception} ${rescue} ${userSees}`);
    const userSilent = /\bsilent\b/iu.test(userSees);
    if (rescueFlag === "no" && testFlag === "no" && userSilent) {
      return {
        ok: false,
        details: `Failure Mode Table CRITICAL row ${index + 1} (${method}): RESCUED=N + TEST=N + UserSees=Silent. Add rescue path, add test coverage, or make user impact explicit.`
      };
    }
  }
  return {
    ok: true,
    details: "Failure Mode Table header and critical-risk checks passed."
  };
}

// Canonical scope mode tokens (gstack CEO review). The four mode names live in
// the scope skill, the artifact template, and downstream traces. Requiring one
// of them in Scope Summary is **structural** — not free-form English keyword
// matching on user prose. Authors may also use the canonical short form on a
// `Mode:` / `Selected mode:` line (e.g. `Selected mode: hold`) as a courtesy.
export const SCOPE_MODE_FULL_TOKENS: readonly string[] = [
  "SCOPE EXPANSION",
  "SELECTIVE EXPANSION",
  "HOLD SCOPE",
  "SCOPE REDUCTION"
];
export type CanonicalScopeMode = (typeof SCOPE_MODE_FULL_TOKENS)[number];

// Short-form synonyms accepted only when stamped on an explicit `Mode:` /
// `Selected mode:` / `Scope mode:` line. Plain prose with the same word does
// not count, so `strict` / `broad` / `narrow` / similar non-mode adjectives
// remain rejected.
export const SCOPE_MODE_LINE_REGEX = /(?:^|\n)\s*[-*]?\s*\**\s*(?:Selected\s+|Scope\s+)?Mode\**\s*:\s*\**\s*([^\n]+)/iu;
export const SCOPE_MODE_SHORT_TOKEN_REGEX = /\b(?:hold(?:[\s_-]?scope)?|selective(?:[\s_-]?expansion)?|scope[\s_-]?expansion|expansion|scope[\s_-]?reduction|reduction|expand|reduce)\b/iu;
export const SPEC_MAX_MODULES = 5;

// Next-stage handoff token. We only enforce the canonical machine-surface stage
// IDs (`design`, `spec`) plus stable handoff phrases. The surrounding prose may
// be written in any language — this guards the downstream cross-stage trace,
// not the wording of the rationale.
export const NEXT_STAGE_HANDOFF_REGEX = /(?:`(?:design|spec)`|\bdesign\b|\bspec\b|next[-\s_]stage|next stage|handoff|hand[-\s]off)/iu;

export function hasCanonicalScopeMode(body: string): boolean {
  return extractCanonicalScopeMode(body) !== null;
}

export function canonicalModesInText(text: string): CanonicalScopeMode[] {
  const normalized = text
    .toUpperCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const hits: CanonicalScopeMode[] = [];
  if (/\bSCOPE EXPANSION\b/u.test(normalized)) hits.push("SCOPE EXPANSION");
  if (/\bSELECTIVE EXPANSION\b/u.test(normalized)) hits.push("SELECTIVE EXPANSION");
  if (/\bHOLD SCOPE\b/u.test(normalized)) hits.push("HOLD SCOPE");
  if (/\bSCOPE REDUCTION\b/u.test(normalized)) hits.push("SCOPE REDUCTION");
  return hits;
}

export function shortModeToCanonical(text: string): CanonicalScopeMode | null {
  if (!SCOPE_MODE_SHORT_TOKEN_REGEX.test(text)) return null;
  const normalized = text
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
  if (/\bselective(?:\s+expansion)?\b/u.test(normalized)) return "SELECTIVE EXPANSION";
  if (/\bhold(?:\s+scope)?\b/u.test(normalized)) return "HOLD SCOPE";
  if (/\b(?:scope\s+reduction|reduction|reduce)\b/u.test(normalized)) return "SCOPE REDUCTION";
  if (/\b(?:scope\s+expansion|expansion|expand)\b/u.test(normalized)) return "SCOPE EXPANSION";
  return null;
}

export function canonicalModeFromCandidate(candidate: string): CanonicalScopeMode | null {
  const canonicalHits = canonicalModesInText(candidate);
  if (canonicalHits.length === 1) return canonicalHits[0];
  if (canonicalHits.length > 1) return null;
  return shortModeToCanonical(candidate);
}

export function extractCanonicalScopeMode(body: string): CanonicalScopeMode | null {
  // Strict: a Mode: / Selected mode: line that picks exactly ONE canonical mode
  // is the strongest signal. The template scaffolding contains all four mode
  // tokens inside an instructional `(one of ...)` placeholder; we ignore that
  // line so authors who never replace the scaffolding still fail validation.
  for (const match of body.matchAll(new RegExp(SCOPE_MODE_LINE_REGEX, "giu"))) {
    const raw = (match[1] ?? "").trim();
    const sanitized = raw.replace(/\(.*?\)/gu, "").trim();
    if (sanitized.length === 0) continue;
    const mode = canonicalModeFromCandidate(sanitized);
    if (mode) return mode;
  }
  // Fallback: any line outside an instructional `(one of ...)` placeholder
  // names exactly one mode. Block lines that list multiple modes (the
  // unfilled template) or are wrapped in an instructional parenthetical.
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/\(\s*one\s+of\b/iu.test(line)) continue;
    const sanitized = line.replace(/\(.*?\)/gu, "");
    const mode = canonicalModeFromCandidate(sanitized);
    if (mode) return mode;
  }
  return null;
}

// Premise challenge is owned solely by brainstorm (`## Premise Check`);
// scope only records `## Premise Drift` when scope-stage Q&A surfaces
// new evidence that materially changes the brainstorm answer. The
// drift section is optional and structural-only via the default
// `validateSectionBody` path (no specialized validator required).

export function validateScopeSummary(sectionBody: string): { ok: boolean; details: string } {
  const meaningfulLines = sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /[\p{L}\p{N}]/u.test(line));

  if (meaningfulLines.length < 2) {
    return {
      ok: false,
      details:
        "Scope Summary must list at least 2 substantive lines covering the selected mode and the next-stage handoff."
    };
  }

  if (!hasCanonicalScopeMode(sectionBody)) {
    return {
      ok: false,
      details:
        "Scope Summary must name the selected mode using a canonical token (SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE, SCOPE REDUCTION) or a short form on a `Mode:` line (hold, selective, expansion, reduction)."
    };
  }

  if (!NEXT_STAGE_HANDOFF_REGEX.test(sectionBody)) {
    return {
      ok: false,
      details:
        "Scope Summary must record the track-aware next-stage handoff (mention `design` for standard, `spec` for medium, or include a `Next-stage handoff:` line)."
    };
  }

  return {
    ok: true,
    details: "Scope Summary names the selected mode and the next-stage handoff."
  };
}

export const APPROACH_ROLE_VALUES = ["baseline", "challenger", "wild-card"] as const;
export const APPROACH_UPSIDE_VALUES = ["low", "modest", "high", "higher"] as const;
export const REQUIREMENT_PRIORITY_VALUES = ["P0", "P1", "P2", "P3", "DROPPED"] as const;

export function normalizeTableToken(value: string): string {
  return value
    .replace(/[`*_]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-");
}

export function columnIndex(header: string[], expected: string): number {
  return header.findIndex((cell) => normalizeTableToken(cell) === expected);
}

export function validateApproachesTaxonomy(sectionBody: string): {
  rowCount: number;
  roleUpsideOk: boolean;
  challengerOk: boolean;
  details: string;
} {
  const header = tableHeaderCells(sectionBody);
  const rows = getMarkdownTableRows(sectionBody);
  if (!header) {
    return {
      rowCount: 0,
      roleUpsideOk: false,
      challengerOk: false,
      details: "Approaches must be a markdown table with canonical Role and Upside columns."
    };
  }

  const roleIndex = columnIndex(header, "role");
  const upsideIndex = columnIndex(header, "upside");
  if (roleIndex < 0 || upsideIndex < 0) {
    const firstColumnTokens = rows.map((row) => normalizeTableToken(row[0] ?? ""));
    const appearsTransposed = firstColumnTokens.includes("role") || firstColumnTokens.includes("upside");
    return {
      rowCount: rows.length,
      roleUpsideOk: false,
      challengerOk: false,
      details: appearsTransposed
        ? "Approaches table appears transposed: `Role`/`Upside` are rows, but must be columns. Use `| Approach | Role | Upside | ... |` with one approach per row."
        : "Approaches table must include canonical `Role` and `Upside` columns (Role: baseline | challenger | wild-card; Upside: low | modest | high | higher)."
    };
  }

  let challengerRows = 0;
  let challengerHasHighUpside = false;
  for (const [index, row] of rows.entries()) {
    const role = normalizeTableToken(row[roleIndex] ?? "");
    const upside = normalizeTableToken(row[upsideIndex] ?? "");
    if (!APPROACH_ROLE_VALUES.includes(role as (typeof APPROACH_ROLE_VALUES)[number])) {
      return {
        rowCount: rows.length,
        roleUpsideOk: false,
        challengerOk: false,
        details: `Approaches row ${index + 1} has invalid Role "${row[roleIndex] ?? ""}". Expected one of: ${APPROACH_ROLE_VALUES.join(", ")}.`
      };
    }
    if (!APPROACH_UPSIDE_VALUES.includes(upside as (typeof APPROACH_UPSIDE_VALUES)[number])) {
      return {
        rowCount: rows.length,
        roleUpsideOk: false,
        challengerOk: false,
        details: `Approaches row ${index + 1} has invalid Upside "${row[upsideIndex] ?? ""}". Expected one of: ${APPROACH_UPSIDE_VALUES.join(", ")}.`
      };
    }
    if (role === "challenger") {
      challengerRows += 1;
      if (upside === "high" || upside === "higher") {
        challengerHasHighUpside = true;
      }
    }
  }

  const challengerOk = challengerRows === 1 && challengerHasHighUpside;
  return {
    rowCount: rows.length,
    roleUpsideOk: true,
    challengerOk,
    details: challengerOk
      ? "Approaches table uses canonical Role/Upside values and exactly one high/higher-upside challenger."
      : `Approaches table must include exactly one challenger row with Upside high or higher. Found ${challengerRows} challenger row(s).`
  };
}

export function validateCalibratedSelfReview(sectionBody: string): { ok: boolean; details: string } {
  const statusLineMatch = /^\s*-\s*Status:\s*(.*)$/imu.exec(sectionBody);
  const statusValue = statusLineMatch ? statusLineMatch[1].trim() : "";
  const mentionsApproved = /\bApproved\b/iu.test(statusValue);
  const mentionsIssuesFound = /\bIssues Found\b/iu.test(statusValue);
  const statusPickedExactlyOne =
    statusLineMatch !== null && (mentionsApproved !== mentionsIssuesFound);

  const hasPatchesHeader = /^\s*-\s*Patches applied:/imu.test(sectionBody);
  const hasConcernsHeader = /^\s*-\s*Remaining concerns:/imu.test(sectionBody);

  if (statusPickedExactlyOne && hasPatchesHeader && hasConcernsHeader) {
    return {
      ok: true,
      details: "Self-Review Notes use the calibrated review prompt format."
    };
  }

  const problems: string[] = [];
  if (!statusLineMatch) {
    problems.push("missing `- Status:` line");
  } else if (!mentionsApproved && !mentionsIssuesFound) {
    problems.push("`- Status:` must include `Approved` or `Issues Found`");
  } else if (mentionsApproved && mentionsIssuesFound) {
    problems.push(
      "`- Status:` must pick exactly one of `Approved` or `Issues Found` (the placeholder `Approved | Issues Found` is not a decision)"
    );
  }
  if (!hasPatchesHeader) problems.push("missing `- Patches applied:` line");
  if (!hasConcernsHeader) problems.push("missing `- Remaining concerns:` line");

  return {
    ok: false,
    details:
      "Self-Review Notes must use the calibrated review prompt format: `- Status: Approved` (or `Issues Found`), `- Patches applied:` (inline note or sub-bullets), and `- Remaining concerns:` (inline note or sub-bullets). Issues: " +
      problems.join("; ") +
      "."
  };
}

export function validateRequirementsTaxonomy(sectionBody: string): { ok: boolean; details: string } {
  const header = tableHeaderCells(sectionBody);
  if (!header) {
    return {
      ok: false,
      details: "Requirements must be a markdown table with a Priority column."
    };
  }
  const priorityIndex = columnIndex(header, "priority");
  if (priorityIndex < 0) {
    return {
      ok: false,
      details: "Requirements table must include a canonical `Priority` column."
    };
  }
  const rows = getMarkdownTableRows(sectionBody);
  if (rows.length === 0) {
    return {
      ok: false,
      details: "Requirements table must include at least one requirement row."
    };
  }
  for (const [index, row] of rows.entries()) {
    const rawPriority = (row[priorityIndex] ?? "").replace(/[`*_]/gu, "").trim().toUpperCase();
    if (!REQUIREMENT_PRIORITY_VALUES.includes(rawPriority as (typeof REQUIREMENT_PRIORITY_VALUES)[number])) {
      return {
        ok: false,
        details: `Requirements row ${index + 1} has invalid Priority "${row[priorityIndex] ?? ""}". Expected one of: ${REQUIREMENT_PRIORITY_VALUES.join(", ")}.`
      };
    }
  }
  return {
    ok: true,
    details: "Requirements table uses canonical Priority values."
  };
}

// Decision identity is anchored only by stable D-XX IDs which the agent
// can edit safely without recomputing content hashes. This avoids the
// class of agent-driven shell hash spam (`shasum`, `sha256sum`,
// `Get-FileHash`) that surfaced when rows were reordered or rephrased
// under previous content-hash anchors.

export interface InteractionEdgeCaseRequirement {
  label: string;
  pattern: RegExp;
}

export const INTERACTION_EDGE_CASE_REQUIREMENTS: readonly InteractionEdgeCaseRequirement[] = [
  { label: "double-click", pattern: /\bdouble[\s-]?click\b/iu },
  {
    label: "nav-away-mid-request",
    pattern: /\b(?:nav(?:igate)?[\s-]?away(?:[\s-]?mid[\s-]?request)?|leave\s+(?:page|view|screen).*(?:request|save|submit)|close\s+tab.*(?:request|save|submit))\b/iu
  },
  {
    label: "10K-result dataset",
    pattern: /\b(?:10k(?:[\s-]?result)?|10,?000|large[\s-]?result(?:[\s-]?dataset)?)\b/iu
  },
  {
    label: "background-job abandonment",
    pattern: /\b(?:background[\s-]?job.*abandon(?:ed|ment)?|abandon(?:ed|ment)?.*background[\s-]?job)\b/iu
  },
  { label: "zombie connection", pattern: /\bzombie[\s-]?connection\b/iu }
];

/**
 * context for `validateInteractionEdgeCaseMatrix`.
 *
 * Background: a quick-tier test of a 3-file static landing page used
 * to trip "Interaction Edge Case row \"nav-away-mid-request\" must mark
 * Handled? as yes/no" because the author wrote `N/A` (no network at
 * all), then `unhandled must reference a deferred item id (for example
 * D-12)`. Two relaxations apply:
 *
 *   1. `N/A — <reason>` (em-dash + free-text reason) is now an
 *      accepted Handled? value. The reason replaces the D-XX
 *      requirement.
 *   2. When the caller signals lite-tier and the design has no
 *      network/external dependencies (detected via the Architecture
 *      Diagram body or a missing Failure Mode Table), the standard
 *      mandatory rows (`nav-away-mid-request`, `10K-result dataset`,
 *      `background-job abandonment`, `zombie connection`) are
 *      treated as advisory rather than required. The `double-click`
 *      row stays mandatory because UI duplicate-action handling is
 *      relevant even for static pages.
 */
export interface InteractionEdgeCaseValidationContext {
  /** Optional H2 sections map for cross-section "no network" detection. */
  sections?: H2SectionMap | null;
  /** When true, network-dependent mandatory rows become advisory. */
  liteTier?: boolean;
}

const INTERACTION_EDGE_CASE_NA_PATTERN = /^\s*n\s*\/\s*a\b/iu;
const INTERACTION_EDGE_CASE_NA_WITH_REASON_PATTERN = /^\s*n\s*\/\s*a\s*[—–\-:]\s*\S/iu;
const INTERACTION_EDGE_CASE_NETWORK_DEPENDENT_LABELS: ReadonlySet<string> = new Set([
  "nav-away-mid-request",
  "10K-result dataset",
  "background-job abandonment",
  "zombie connection"
]);

function shouldRelaxNetworkDependentEdgeCases(
  context: InteractionEdgeCaseValidationContext
): boolean {
  if (!context.liteTier) return false;
  const sections = context.sections ?? null;
  if (!sections) return true;
  const diagramBody = sectionBodyByName(sections, "Architecture Diagram");
  const failureModeBody = sectionBodyByName(sections, "Failure Mode Table");
  const failureModeRowCount = failureModeBody !== null ? getMarkdownTableRows(failureModeBody).length : 0;
  if (failureModeRowCount > 0) return false;
  if (diagramBody && DIAGRAM_EXTERNAL_DEPENDENCY_PATTERN.test(diagramBody)) return false;
  return true;
}

export function validateInteractionEdgeCaseMatrix(
  sectionBody: string,
  context: InteractionEdgeCaseValidationContext = {}
): { ok: boolean; details: string } {
  const rows = getMarkdownTableRows(sectionBody);
  const relaxNetworkRows = shouldRelaxNetworkDependentEdgeCases(context);
  if (rows.length === 0) {
    if (relaxNetworkRows) {
      return {
        ok: true,
        details: "Data Flow Interaction Edge Case matrix is advisory for lite-tier no-network designs (no Failure Mode Table rows and no external-dependency nodes detected)."
      };
    }
    return {
      ok: false,
      details: "Data Flow must include an Interaction Edge Case matrix table with required rows."
    };
  }

  const seen = new Map<string, true>();
  for (const [, row] of rows.entries()) {
    const labelCell = (row[0] ?? "").trim();
    if (!labelCell) continue;
    const requirement = INTERACTION_EDGE_CASE_REQUIREMENTS.find((candidate) =>
      candidate.pattern.test(labelCell)
    );
    if (!requirement) continue;

    if (row.length < 4) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" must include 4 columns: Edge case | Handled? | Design response | Deferred item.`
      };
    }

    const handledRaw = (row[1] ?? "").trim();
    const handled = parseBinaryFlag(handledRaw);
    const response = (row[2] ?? "").trim();
    const deferred = (row[3] ?? "").trim();
    const isNA = INTERACTION_EDGE_CASE_NA_PATTERN.test(handledRaw);
    if (handled === "unknown" && !isNA) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" must mark Handled? as yes/no, or write \`N/A — <reason>\` (em-dash + free-text reason) when the case does not apply.`
      };
    }
    if (isNA) {
      // `N/A — <reason>` short-circuits both the "must mark yes/no"
      // rule and the "must reference a deferred item id" rule. The
      // reason satisfies justification.
      const hasReason = INTERACTION_EDGE_CASE_NA_WITH_REASON_PATTERN.test(handledRaw) || response.length > 0;
      if (!hasReason) {
        return {
          ok: false,
          details: `Interaction Edge Case row "${requirement.label}" marked N/A but missing reason. Use \`N/A — <reason>\` (em-dash + free-text reason) in the Handled? cell or fill the Design response cell.`
        };
      }
      seen.set(requirement.label, true);
      continue;
    }
    if (!response) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" must describe the design response.`
      };
    }
    if (handled === "no" && (!deferred || /\bnone\b/iu.test(deferred))) {
      return {
        ok: false,
        details: `Interaction Edge Case row "${requirement.label}" is unhandled and must reference a deferred item id (for example D-12) or mark Handled? as \`N/A — <reason>\`.`
      };
    }
    seen.set(requirement.label, true);
  }

  const missing = INTERACTION_EDGE_CASE_REQUIREMENTS
    .map((requirement) => requirement.label)
    .filter((label) => !seen.has(label));
  const stillMissing = relaxNetworkRows
    ? missing.filter((label) => !INTERACTION_EDGE_CASE_NETWORK_DEPENDENT_LABELS.has(label))
    : missing;
  const advisoryMissing = relaxNetworkRows
    ? missing.filter((label) => INTERACTION_EDGE_CASE_NETWORK_DEPENDENT_LABELS.has(label))
    : [];
  if (stillMissing.length > 0) {
    const advisoryNote = advisoryMissing.length > 0
      ? ` (${advisoryMissing.length} network-dependent row(s) demoted to advisory by lite-tier no-network detection: ${advisoryMissing.join(", ")})`
      : "";
    return {
      ok: false,
      details: `Interaction Edge Case matrix is missing required row(s): ${stillMissing.join(", ")}${advisoryNote}.`
    };
  }
  const advisoryNote = advisoryMissing.length > 0
    ? ` (${advisoryMissing.length} network-dependent row(s) advisory under lite-tier no-network: ${advisoryMissing.join(", ")})`
    : "";
  return {
    ok: true,
    details: `Interaction Edge Case matrix contains all required rows with handled/deferred status${advisoryNote}.`
  };
}

export const PRE_SCOPE_AUDIT_SIGNALS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "git log -30 --oneline", pattern: /\bgit\s+log\b[^\n]*-30[^\n]*\boneline\b/iu },
  { label: "git diff --stat", pattern: /\bgit\s+diff\b[^\n]*--stat\b/iu },
  { label: "git stash list", pattern: /\bgit\s+stash\s+list\b/iu },
  {
    label: "debt marker scan (TODO|FIXME|XXX|HACK)",
    pattern: /\b(?:rg|ripgrep)\b[^\n]*(?:TODO|FIXME|XXX|HACK)|\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/iu
  }
];

export function validatePreScopeSystemAudit(sectionBody: string): { ok: boolean; details: string } {
  const missing = PRE_SCOPE_AUDIT_SIGNALS
    .filter((signal) => !signal.pattern.test(sectionBody))
    .map((signal) => signal.label);
  if (missing.length > 0) {
    return {
      ok: false,
      details: `Pre-Scope System Audit is missing required signal(s): ${missing.join(", ")}.`
    };
  }
  return {
    ok: true,
    details: "Pre-Scope System Audit captures git log/diff/stash/debt-marker checks."
  };
}

export const DIAGRAM_ARROW_PATTERN = /(?:<--?>|<?==?>|--?>|->>|=>|-\.->|→|⟶|↦|={2,}>|-{3,}>|\.{3,}>|-(?:\s-){1,}\s?->)/u;
export const DIAGRAM_FAILURE_EDGE_PATTERN = /\b(fail(?:ed|ure)?|error|timeout|fallback|degrad(?:e|ed|ation)|retry|backoff|circuit|unavailable|recover(?:y)?|rescue|mitigat(?:e|ion)|rollback|exception|abort|dead[\s-]?letter|dlq)\b/iu;
export const DIAGRAM_GENERIC_NODE_PATTERN = /\b(service|component|module|system)\s*(?:[A-Z0-9])?\b/iu;
/**
 * external-dependency keywords that trigger the
 * failure-edge requirement. The architecture diagram is allowed to
 * omit failure edges only when ALL of:
 *   - Failure Mode Table has zero rows.
 *   - The diagram body mentions no external-dependency keyword.
 *
 * Static landing pages (3 HTML/CSS/JS files, no network) match this:
 * no failure modes to map, no external systems to fail. The previous
 * blanket "must include at least one failure-edge" rule produced
 * ceremony-only failures that the agent worked around with fake
 * `(timeout)` annotations, defeating the spirit of the rule.
 */
export const DIAGRAM_EXTERNAL_DEPENDENCY_PATTERN = /\b(http|https|api|rest|grpc|graphql|websocket|socket|tcp|udp|rpc|fetch|request|database|db|sql|postgres|mysql|sqlite|mongo|redis|cache|queue|kafka|rabbitmq|sqs|sns|s3|cdn|external|upstream|downstream|third[\s-]?party|webhook|cloud|service[\s-]?bus|event[\s-]?bus|broker|stream|topic)\b/iu;
export const TEST_COMMAND_MARKER_PATTERN = /\b(?:npm|pnpm|yarn|bun|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|dotnet test)\b/iu;
export const RED_FAILURE_MARKER_PATTERN = /\b(?:fail|failed|failing|assertionerror|cannot find|exception|error|exit code\s*[:=]?\s*[1-9])\b/iu;
export const GREEN_SUCCESS_MARKER_PATTERN = /\b(?:pass|passed|green|ok|0 failed|exit code\s*[:=]?\s*0)\b/iu;

export function diagramEdgeLines(sectionBody: string): string[] {
  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !line.startsWith("%%"))
    .filter((line) => DIAGRAM_ARROW_PATTERN.test(line));
}

export function hasFailureEdgeInDiagram(sectionBody: string): boolean {
  const lines = diagramEdgeLines(sectionBody);
  for (const line of lines) {
    if (DIAGRAM_ARROW_PATTERN.test(line) && DIAGRAM_FAILURE_EDGE_PATTERN.test(line)) {
      return true;
    }
  }
  return false;
}

export function hasLabeledDiagramArrow(lines: string[]): boolean {
  return lines.some((line) => /\|[^|]+\|/u.test(line) || /:\s*[A-Za-z]/u.test(line));
}

/**
 * accepted async edge patterns. Returns true when
 * a line carries any of:
 *
 *   - `-.->`, `-->>`, `~~>` (mermaid dotted/messaging arrows)
 *   - `- - ->` (loose dotted ASCII arrow with optional spaces)
 *   - `.....>` (3-or-more dots followed by `>`)
 *   - `\basync\b` text token (label-based)
 *   - `[async]` bracketed label, `async:` prefix, `async:` cell content
 *
 * The error message printed when this fails (see
 * `validateArchitectureDiagram`) lists every accepted pattern
 * verbatim so the agent does not have to guess.
 */
export function hasAsyncDiagramEdge(lines: string[]): boolean {
  return lines.some((line) => {
    if (/-\.->|-->>|~~>/u.test(line)) return true;
    if (/-(?:\s-){1,}\s?->/u.test(line)) return true;
    if (/\.{3,}\s*>/u.test(line)) return true;
    if (/\basync\b/iu.test(line)) return true;
    if (/\[\s*async\s*\]/iu.test(line)) return true;
    if (/(?:^|[\s|:])async\s*:/iu.test(line)) return true;
    return false;
  });
}

/**
 * accepted sync edge patterns. Returns true when a
 * line carries any of:
 *
 *   - `\bsync\b` text token (label-based)
 *   - `[sync]` bracketed label, `sync:` prefix, `sync:` cell content
 *   - Solid `-->`, `->`, `=>`, `→`, `⟶`, `↦` arrow that is NOT a known
 *     dotted/async variant (`-.->`, `-->>`, `~~>`)
 *   - `===>` (3+ `=` then `>`) and `--->` (3+ `-` then `>`) heavy solid
 *     arrows
 */
export function hasSyncDiagramEdge(lines: string[]): boolean {
  return lines.some((line) => {
    if (/\bsync\b/iu.test(line) && !/\basync\b/iu.test(line)) return true;
    if (/\[\s*sync\s*\]/iu.test(line)) return true;
    if (/(?:^|[\s|:])sync\s*:/iu.test(line)) return true;
    if (/={2,}>/u.test(line)) return true;
    if (/-{3,}>/u.test(line)) return true;
    if (!/(-->|->|=>|→|⟶|↦)/u.test(line)) return false;
    if (/-\.->|-->>|~~>/u.test(line)) return false;
    if (/-(?:\s-){1,}\s?->/u.test(line)) return false;
    return true;
  });
}

/**
 * exact accepted-pattern list shown in the error
 * message when sync/async distinction fails. Keep in sync with
 * `hasAsyncDiagramEdge` / `hasSyncDiagramEdge` above.
 */
export const DIAGRAM_SYNC_ASYNC_ACCEPTED_PATTERNS = [
  "Solid arrows: `-->`, `->`, `===>`, `--->`, `=>`, `→`, `⟶`, `↦`",
  "Dotted/async arrows: `-.->`, `-->>`, `~~>`, `- - ->`, `.....>`",
  "Text labels on the same line: `sync` / `async`",
  "Bracket labels: `[sync]` / `[async]`",
  "Cell-prefix labels: `sync:` / `async:` (e.g. `A -->|sync: persist| B`)"
] as const;

export interface ArchitectureDiagramValidationContext {
  /** Optional H2 sections map for cross-section checks (e.g. Failure Mode Table presence). */
  sections?: H2SectionMap | null;
}

export interface ArchitectureDiagramValidationResult {
  ok: boolean;
  details: string;
}

/**
 * Architecture Diagram structural check.
 *
 * Promoted out of `validateSectionBody` so it can take a `sections`
 * map and conditionally enforce the failure-edge rule based on
 * cross-section context (Failure Mode Table presence + diagram body
 * mentioning external-dependency keywords).
 */
export function validateArchitectureDiagram(
  sectionBody: string,
  context: ArchitectureDiagramValidationContext = {}
): ArchitectureDiagramValidationResult {
  const edgeLines = diagramEdgeLines(sectionBody);
  if (edgeLines.length === 0) {
    return {
      ok: false,
      details: "Architecture Diagram must include at least one directional edge line (for example `A -->|action| B`)."
    };
  }
  if (!hasLabeledDiagramArrow(edgeLines)) {
    return {
      ok: false,
      details: "Architecture Diagram must label each edge with an action/message (for example `A -->|sync: persist| B`)."
    };
  }
  const genericLine = edgeLines.find((line) => DIAGRAM_GENERIC_NODE_PATTERN.test(line));
  if (genericLine) {
    return {
      ok: false,
      details: `Architecture Diagram uses a generic node label in edge "${genericLine}". Use concrete component names instead of placeholders like Service/Component.`
    };
  }
  if (!hasAsyncDiagramEdge(edgeLines) || !hasSyncDiagramEdge(edgeLines)) {
    const acceptedList = DIAGRAM_SYNC_ASYNC_ACCEPTED_PATTERNS.map((line) => `  - ${line}`).join("\n");
    return {
      ok: false,
      details: `Architecture Diagram must distinguish sync vs async edges. Accepted patterns:\n${acceptedList}\nExample line that satisfies both: \`Browser -->|sync: render| App\` plus \`App -.->|async: log| Telemetry\`.`
    };
  }
  if (!shouldEnforceFailureEdge(sectionBody, context)) {
    return {
      ok: true,
      details: "Architecture Diagram includes labeled directional edges with sync/async distinction; failure-edge enforcement skipped (no failure-mode rows and no external-dependency nodes detected)."
    };
  }
  if (!hasFailureEdgeInDiagram(sectionBody)) {
    return {
      ok: false,
      details: "Architecture Diagram must include at least one failure-edge arrow with a failure keyword (for example: timeout, error, fallback, degraded, retry). Mark a failure path in the diagram (e.g. `App -->|timeout| FallbackCache`)."
    };
  }
  return {
    ok: true,
    details: "Architecture Diagram contains labeled edges, sync/async distinction, and a failure-edge."
  };
}

/**
 * decide whether the failure-edge enforcement
 * should fire for the given Architecture Diagram body. Returns
 * `false` (skip the rule) when BOTH:
 *   - The artifact's `## Failure Mode Table` (if present) has zero
 *     data rows OR is absent entirely.
 *   - The architecture diagram body mentions NO known external-
 *     dependency keyword (network, db, queue, …).
 *
 * Static landing pages (no network, no failure modes) hit this
 * path. Designs with even one Failure Mode row OR one external
 * dependency keyword in the diagram fall through to the legacy
 * blanket failure-edge requirement.
 */
function shouldEnforceFailureEdge(
  diagramBody: string,
  context: ArchitectureDiagramValidationContext
): boolean {
  const sections = context.sections ?? null;
  const failureModeBody = sections ? sectionBodyByName(sections, "Failure Mode Table") : null;
  const failureModeRowCount = failureModeBody !== null ? getMarkdownTableRows(failureModeBody).length : 0;
  if (failureModeRowCount > 0) return true;
  if (DIAGRAM_EXTERNAL_DEPENDENCY_PATTERN.test(diagramBody)) return true;
  return false;
}

/**
 * pointer-mode evidence acceptance. RED/GREEN sections may
 * substitute pasted stdout with a single line of the form
 * `Evidence: <relative-or-abs-path>` or `Evidence: spanId:<id>`. The
 * validator alone cannot reach the filesystem or delegation ledger
 * synchronously, so the lint pipeline pre-resolves pointers and then
 * passes booleans through these option flags.
 */
export interface TddEvidencePointerOptions {
  /**
   * True when the section body has at least one `Evidence:` pointer line
   * AND the pointer resolved to either an existing file or a known
   * delegation spanId. The validator then short-circuits without
   * requiring pasted stdout markers.
   */
  pointerSatisfied?: boolean;
  /**
   * true when `delegation-events.jsonl` carries at least
   * one slice-tagged event for the current run with the matching phase
   * (`phase=red` for RED, `phase=green` for GREEN) and a non-empty
   * `evidenceRefs` array. Phase events are the new source of truth in
   * the markdown evidence block is auto-satisfied without
   * requiring hand-pasted stdout content.
   */
  phaseEventsSatisfied?: boolean;
}

/**
 * Sync helper that scans for `Evidence:` lines in a section body and
 * returns the trimmed value of each. Used by the lint pipeline to
 * pre-resolve pointers (filesystem path-existence or delegation ledger
 * spanId match) before invoking the validators.
 *
 * Recognised forms:
 *   Evidence: <path>
 *   Evidence: spanId:<id>
 *   - Evidence: <path>
 */
export function extractEvidencePointers(sectionBody: string): string[] {
  const pointers: string[] = [];
  const pattern = /^\s*-?\s*evidence\s*:\s*(.+?)\s*$/imu;
  for (const line of sectionBody.split(/\r?\n/u)) {
    const match = pattern.exec(line);
    if (match && match[1] !== undefined) {
      const value = match[1].trim();
      if (value.length > 0) pointers.push(value);
    }
  }
  return pointers;
}

export function validateTddRedEvidence(
  sectionBody: string,
  opts: TddEvidencePointerOptions = {}
): { ok: boolean; details: string } {
  if (opts.phaseEventsSatisfied) {
    return {
      ok: true,
      details: "RED Evidence auto-satisfied: delegation-events.jsonl carries a phase=red row with non-empty evidenceRefs for the active run."
    };
  }
  if (opts.pointerSatisfied) {
    return {
      ok: true,
      details: "RED Evidence satisfied via `Evidence: <path|spanId:...>` pointer (resolved to an existing artifact or delegation span)."
    };
  }
  const meaningful = meaningfulLineCount(sectionBody);
  if (meaningful < 2) {
    return {
      ok: false,
      details: "RED Evidence must include at least 2 meaningful lines (command plus failing output context)."
    };
  }
  if (!TEST_COMMAND_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "RED Evidence must include the test command that produced the failure."
    };
  }
  if (!RED_FAILURE_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "RED Evidence must include explicit failing output markers (FAIL/FAILED/AssertionError/exit code != 0)."
    };
  }
  return {
    ok: true,
    details: "RED Evidence includes command + failing output markers."
  };
}

export function validateTddGreenEvidence(
  sectionBody: string,
  opts: TddEvidencePointerOptions = {}
): { ok: boolean; details: string } {
  if (opts.phaseEventsSatisfied) {
    return {
      ok: true,
      details: "GREEN Evidence auto-satisfied: delegation-events.jsonl carries a phase=green row with non-empty evidenceRefs for the active run."
    };
  }
  if (opts.pointerSatisfied) {
    return {
      ok: true,
      details: "GREEN Evidence satisfied via `Evidence: <path|spanId:...>` pointer (resolved to an existing artifact or delegation span)."
    };
  }
  const meaningful = meaningfulLineCount(sectionBody);
  if (meaningful < 2) {
    return {
      ok: false,
      details: "GREEN Evidence must include at least 2 meaningful lines (command and passing result)."
    };
  }
  if (!TEST_COMMAND_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "GREEN Evidence must include the full-suite test command."
    };
  }
  if (!GREEN_SUCCESS_MARKER_PATTERN.test(sectionBody)) {
    return {
      ok: false,
      details: "GREEN Evidence must include explicit passing markers (PASS/PASSED/OK/exit code 0)."
    };
  }
  return {
    ok: true,
    details: "GREEN Evidence includes command + passing output markers."
  };
}

export function validateVerificationLadder(sectionBody: string): { ok: boolean; details: string } {
  const hasTextLine = /highest tier reached/iu.test(sectionBody);
  const hasCanonicalTable = hasVerificationLadderTableRow(sectionBody);
  if (!hasTextLine && !hasCanonicalTable) {
    return {
      ok: false,
      details:
        "Verification Ladder must include either a 'Highest tier reached' line or a canonical table row (Slice | Tier reached | Evidence) with non-empty tier and evidence."
    };
  }
  if (!/\b(static|command|behavioral|human)\b/iu.test(sectionBody)) {
    return {
      ok: false,
      details: "Verification Ladder must name a tier (static | command | behavioral | human)."
    };
  }
  if (!/\b(evidence|command|sha|commit)\b/iu.test(sectionBody)) {
    return {
      ok: false,
      details: "Verification Ladder must include evidence details (command output or commit SHA)."
    };
  }
  return {
    ok: true,
    details: "Verification Ladder includes tier + evidence fields."
  };
}

export function hasVerificationLadderTableRow(sectionBody: string): boolean {
  const lines = sectionBody.split(/\r?\n/u);
  let sawHeader = false;
  let sawSeparator = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      sawHeader = false;
      sawSeparator = false;
      continue;
    }
    const cells = trimmed
      .replace(/^\|/u, "")
      .replace(/\|$/u, "")
      .split("|")
      .map((cell) => cell.trim());
    if (!sawHeader) {
      const lowered = cells.map((cell) => cell.toLowerCase());
      const hasTierColumn = lowered.some((cell) => /tier(?:\s+reached)?/u.test(cell));
      const hasEvidenceColumn = lowered.some((cell) => cell.includes("evidence"));
      if (hasTierColumn && hasEvidenceColumn) {
        sawHeader = true;
        continue;
      }
      continue;
    }
    if (!sawSeparator) {
      if (cells.every((cell) => /^[:\-\s]+$/u.test(cell))) {
        sawSeparator = true;
        continue;
      }
      sawHeader = false;
      continue;
    }
    if (cells.length >= 2 && cells.some((cell) => /\b(static|command|behavioral|human)\b/iu.test(cell))) {
      const evidenceCellHasContent = cells.some((cell) => cell.length > 0 && !/^\s*$/u.test(cell) && !/^[:\-\s]+$/u.test(cell));
      if (evidenceCellHasContent) {
        return true;
      }
    }
  }
  return false;
}

export type LearningEntryType = "rule" | "pattern" | "lesson" | "compound";
export type LearningConfidence = "high" | "medium" | "low";
export type LearningSeverity = "critical" | "important" | "suggestion";
export type LearningSource = "stage" | "retro" | "compound" | "idea" | "manual";

export interface LearningSeedEntry {
  type: LearningEntryType;
  trigger: string;
  action: string;
  confidence: LearningConfidence;
  severity?: LearningSeverity;
  stage?: FlowStage | null;
  origin_stage?: FlowStage | null;
  frequency?: number;
  created?: string;
  first_seen_ts?: string;
  last_seen_ts?: string;
  project?: string | null;
  source?: LearningSource | null;
}

export interface LearningsParseResult {
  ok: boolean;
  none: boolean;
  entries: LearningSeedEntry[];
  errors: string[];
  details: string;
}

/** Multiline block used by linter + learnings harvest stderr (identical text). */
export function formatLearningsErrorsBullets(errors: string[]): string {
  if (errors.length === 0) {
    return "Errors:\n  - Learnings section could not be parsed.";
  }
  return `Errors:\n${errors.map((error) => `  - ${error}`).join("\n")}`;
}

export function learningsParseFailureHumanSummary(artifactRelPath: string, errors: string[]): string {
  return `learnings harvest failed for \`${artifactRelPath}\`.\n${formatLearningsErrorsBullets(errors)}`;
}

export const LEARNING_TYPE_SET = new Set<LearningEntryType>(["rule", "pattern", "lesson", "compound"]);
export const LEARNING_CONFIDENCE_SET = new Set<LearningConfidence>(["high", "medium", "low"]);
export const LEARNING_SEVERITY_SET = new Set<LearningSeverity>(["critical", "important", "suggestion"]);
export const LEARNING_SOURCE_SET = new Set<LearningSource>([
  "stage",
  "retro",
  "compound",
  "idea",
  "manual"
]);
export const FLOW_STAGE_SET = new Set<FlowStage>(FLOW_STAGES);
export const LEARNING_ALLOWED_KEYS = new Set([
  "type",
  "trigger",
  "action",
  "confidence",
  "severity",
  "stage",
  "origin_stage",
  "frequency",
  "created",
  "first_seen_ts",
  "last_seen_ts",
  "project",
  "source"
]);

export function isIsoUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isNullableStage(value: unknown): value is FlowStage | null {
  return value === null || (typeof value === "string" && FLOW_STAGE_SET.has(value as FlowStage));
}

export function parseLearningSeedEntry(raw: unknown, index: number): { ok: boolean; entry?: LearningSeedEntry; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `Learnings bullet #${index} must be a JSON object.` };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!LEARNING_ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        error: `Learnings bullet #${index} includes unknown key "${key}" (allowed keys mirror knowledge JSONL fields).`
      };
    }
  }

  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (!LEARNING_TYPE_SET.has(type as LearningEntryType)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must set type to one of: rule, pattern, lesson, compound.`
    };
  }

  const trigger = typeof obj.trigger === "string" ? obj.trigger.trim() : "";
  if (trigger.length === 0) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must include non-empty "trigger".`
    };
  }

  const action = typeof obj.action === "string" ? obj.action.trim() : "";
  if (action.length === 0) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must include non-empty "action".`
    };
  }

  const confidence = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
  if (!LEARNING_CONFIDENCE_SET.has(confidence as LearningConfidence)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} must set confidence to high|medium|low.`
    };
  }
  const severity = typeof obj.severity === "string" ? obj.severity.toLowerCase() : undefined;
  if (severity !== undefined && !LEARNING_SEVERITY_SET.has(severity as LearningSeverity)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "severity" must be critical|important|suggestion.`
    };
  }

  if (obj.stage !== undefined && !isNullableStage(obj.stage)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "stage" must be one of ${FLOW_STAGES.join(", ")} or null.`
    };
  }
  if (obj.origin_stage !== undefined && !isNullableStage(obj.origin_stage)) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "origin_stage" must be one of ${FLOW_STAGES.join(", ")} or null.`
    };
  }
  if (obj.project !== undefined && !isNullableString(obj.project)) {
    return { ok: false, error: `Learnings bullet #${index} field "project" must be string or null.` };
  }
  if (
    obj.source !== undefined &&
    obj.source !== null &&
    (typeof obj.source !== "string" || !LEARNING_SOURCE_SET.has(obj.source as LearningSource))
  ) {
    return {
      ok: false,
      error: `Learnings bullet #${index} field "source" must be stage|retro|compound|idea|manual or null.`
    };
  }
  if (
    obj.frequency !== undefined &&
    (typeof obj.frequency !== "number" || !Number.isInteger(obj.frequency) || obj.frequency < 1)
  ) {
    return { ok: false, error: `Learnings bullet #${index} field "frequency" must be an integer >= 1.` };
  }
  for (const timestampField of ["created", "first_seen_ts", "last_seen_ts"] as const) {
    const value = obj[timestampField];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isIsoUtcTimestamp(value)) {
      return {
        ok: false,
        error: `Learnings bullet #${index} field "${timestampField}" must be ISO UTC (YYYY-MM-DDTHH:MM:SSZ).`
      };
    }
  }

  return {
    ok: true,
    entry: {
      ...obj,
      type: type as LearningEntryType,
      trigger,
      action,
      confidence: confidence as LearningConfidence,
      ...(severity ? { severity: severity as LearningSeverity } : {})
    } as LearningSeedEntry
  };
}

export function parseLearningsSection(sectionBody: string): LearningsParseResult {
  const lines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);
  const bullets = nonEmpty.filter((line) => /^-\s+\S+/u.test(line));

  if (bullets.length === 0) {
    return {
      ok: false,
      none: false,
      entries: [],
      errors: ["Learnings section must contain bullet entries."],
      details: "Learnings section must contain bullet entries."
    };
  }

  const nonBulletContent = nonEmpty.filter((line) => !/^-\s+\S+/u.test(line));
  if (nonBulletContent.length > 0) {
    return {
      ok: false,
      none: false,
      entries: [],
      errors: ["Learnings section must only contain bullet lines (one bullet per learning)."],
      details: "Learnings section must only contain bullet lines (one bullet per learning)."
    };
  }

  if (bullets.length === 1) {
    const payload = bullets[0]!.replace(/^-\s+/u, "").trim();
    if (/^none this stage\.?$/iu.test(payload)) {
      return {
        ok: true,
        none: true,
        entries: [],
        errors: [],
        details: "Learnings section explicitly marked as none."
      };
    }
  }

  const entries: LearningSeedEntry[] = [];
  const errors: string[] = [];
  for (let i = 0; i < bullets.length; i += 1) {
    const payload = bullets[i]!.replace(/^-\s+/u, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      errors.push(
        `Learnings bullet #${i + 1} must be valid JSON object or "None this stage.": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      continue;
    }
    const parsedEntry = parseLearningSeedEntry(parsed, i + 1);
    if (!parsedEntry.ok || !parsedEntry.entry) {
      errors.push(parsedEntry.error ?? `Learnings bullet #${i + 1} is invalid.`);
      continue;
    }
    entries.push(parsedEntry.entry);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      none: false,
      entries: [],
      errors,
      details: errors.join(" | ")
    };
  }

  return {
    ok: true,
    none: false,
    entries,
    errors: [],
    details: `Parsed ${entries.length} learning bullet(s) as knowledge-compatible JSON entries.`
  };
}

/**
 * file-path / reference detector for the
 * `investigation_path_first_missing` advisory rule.
 *
 * The detector is intentionally permissive: it only needs to recognize
 * "the author wrote down a path or ref" — the linter does NOT validate
 * the path resolves on disk. Patterns matched (any one is enough):
 *   - TS/JS/MD/JSON/YAML path with extension
 *     (`src/foo/bar.ts`, `tests/spec.test.ts`, `docs/quality-gates.md`).
 *   - Slash-bearing path under a known repo root prefix
 *     (`src/...`, `tests/...`, `docs/...`, `scripts/...`,
 *     `.cclaw/...`, `.cursor/...`, `node_modules/...`,
 *     `examples/...`, `e2e/...`).
 *   - GitHub-style ref (`owner/repo#123`, `org/repo@sha`,
 *     `path:line`, `path:line-line`).
 *   - Explicit `path:` / `paths:` / `ref:` / `refs:` marker.
 *   - Stable cclaw IDs (`R1`, `D-12`, `AC-3`, `T-4`, `S-2`, `DD-5`,
 *     `ADR-1`, `R-1`, `F-1`, `CR-1`, `I-1`, `QS-1`).
 *   - Backticked path-like token containing a slash.
 *
 * Exposed for unit tests (`tests/unit/investigation-trace-evaluator.test.ts`).
 */
export const INVESTIGATION_TRACE_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s`(\[])(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|mdx|json|yaml|yml|toml|sh|py|rs|go|java|kt|swift|rb|css|scss|html)\b/iu,
  /(?:^|[\s`(\[])(?:src|tests?|docs?|scripts?|e2e|examples?|packages?|apps?|cmd|internal|pkg|lib|app|server|client|backend|frontend|\.cclaw|\.cursor|\.github|node_modules)\/[A-Za-z0-9_./-]+/iu,
  /\b[A-Za-z0-9_./-]+(?:\.[A-Za-z0-9]+)?:\d+(?:[-:]\d+)?\b/u,
  /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#\d+|@[0-9a-f]{6,40})\b/iu,
  /(?:^|\s)(?:paths?|refs?|file|files|cite|citation)\s*:\s*\S/iu,
  /\b(?:R|D|AC|T|S|DD|ADR|F|CR|I|QS)-?\d+\b/u,
  /`[^`]*\/[^`]+`/u
];

export interface InvestigationTraceFinding {
  ok: boolean;
  details: string;
}

const INVESTIGATION_TRACE_PLACEHOLDER_PATTERN = /^(?:none|none\.|n\/a|tbd|todo|fixme|placeholder|optional|fill[\s-]?in)\b/u;

const INVESTIGATION_TRACE_ID_ONLY_CELL = /^[A-Z]{1,4}-?\d+$/u;

function isInvestigationTracePlaceholderCell(cell: string): boolean {
  const stripped = cell.replace(/[`*_>#]/gu, "").trim();
  if (stripped.length === 0) return true;
  if (INVESTIGATION_TRACE_PLACEHOLDER_PATTERN.test(stripped.toLowerCase())) return true;
  return false;
}

function isInvestigationTracePlaceholderProseLine(line: string): boolean {
  const stripped = line.replace(/[`*_>#-]/gu, "").trim();
  if (stripped.length === 0) return true;
  const lower = stripped.toLowerCase();
  if (INVESTIGATION_TRACE_PLACEHOLDER_PATTERN.test(lower)) return true;
  if (/^\(\s*(?:none|n\/a|tbd|todo|fixme|placeholder|optional|fill[\s-]?in)\b/u.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Internal core that does NOT depend on `StageLintContext`. Returned
 * shape is consumed by `evaluateInvestigationTrace` (which pushes a
 * finding into the context) and by unit tests that exercise the
 * detector directly.
 *
 * Returns `null` for sections that are missing, empty, or contain only
 * template scaffolding (table headers, separators, placeholder rows
 * with empty cells, lone `- None.` lines). Callers treat `null` as
 * silent — no finding is emitted.
 */
export function checkInvestigationTrace(
  sectionBody: string | null
): InvestigationTraceFinding | null {
  if (sectionBody === null) return null;
  const lines = sectionBody.split(/\r?\n/u);
  const candidates: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("<!--")) continue;

    const isTableLine = /^\|.*\|$/u.test(trimmed);
    if (isTableLine) {
      if (/^\|[-:| ]+\|$/u.test(trimmed)) continue; // separator row
      const next = (lines[index + 1] ?? "").trim();
      if (/^\|[-:| ]+\|$/u.test(next)) continue; // header row (followed by separator)
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const substantive = cells.filter((cell) => !isInvestigationTracePlaceholderCell(cell));
      if (substantive.length === 0) continue;
      if (substantive.length === 1 && INVESTIGATION_TRACE_ID_ONLY_CELL.test(substantive[0]!)) {
        continue;
      }
      candidates.push(substantive.join(" "));
      continue;
    }

    if (isInvestigationTracePlaceholderProseLine(trimmed)) continue;
    candidates.push(trimmed);
  }

  if (candidates.length === 0) return null;

  const sample = candidates.slice(0, Math.min(5, candidates.length));
  const detectorMatched = sample.some((line) =>
    INVESTIGATION_TRACE_PATH_PATTERNS.some((pattern) => pattern.test(line))
  );
  if (detectorMatched) {
    return {
      ok: true,
      details: "Investigation trace cites file paths or refs in the first non-empty row(s)."
    };
  }
  return {
    ok: false,
    details:
      "Investigation trace has prose-only content in its first row(s). Pass paths and refs, not pasted file contents (e.g. `src/foo/bar.ts:42`, `D-12`, `AC-3`)."
  };
}

/**
 * advisory rule wired into the brainstorm / scope /
 * design / tdd / plan / review linters.
 *
 * Behavior contract:
 * - Section missing or empty / placeholder-only: silent (no finding).
 * - Section has substantive content with a recognizable file path /
 *   ref / explicit `path:`-style marker in the first non-empty rows:
 *   advisory pass (no finding).
 * - Section has substantive content but no path/ref signal: advisory
 *   FAIL finding with ruleId `investigation_path_first_missing`.
 *
 * The rule is `required: false` so it never blocks `stage-complete`.
 */
export function evaluateInvestigationTrace(
  ctx: StageLintContext,
  sectionName: string
): void {
  const body = sectionBodyByName(ctx.sections, sectionName);
  const authoredBody = body === null ? null : extractAuthoredBody(body);
  const result = checkInvestigationTrace(authoredBody);
  if (result === null) return;
  ctx.findings.push({
    section: "investigation_path_first_missing",
    required: false,
    rule: `[P3] investigation_path_first_missing — \`## ${sectionName}\` should cite paths and refs in the first non-empty row(s); pass paths and refs, not content.`,
    found: result.ok,
    details: result.details
  });
}

export function lineContainsVagueAdjective(text: string): string | null {
  const lower = text.toLowerCase();
  for (const adjective of VAGUE_AC_ADJECTIVES) {
    const pattern = new RegExp(`(?:^|[^A-Za-z])${adjective.replace(/ /g, "\\s+")}(?:[^A-Za-z]|$)`, "iu");
    if (pattern.test(lower)) return adjective;
  }
  return null;
}

export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  values: Record<string, string>;
}

export const FRONTMATTER_REQUIRED_KEYS = [
  "stage",
  "schema_version",
  "version",
  "locked_decisions",
  "inputs_hash"
] as const;

export const PLACEHOLDER_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "TODO", regex: /\bTODO\b/iu },
  { label: "TBD", regex: /\bTBD\b/iu },
  { label: "FIXME", regex: /\bFIXME\b/iu },
  { label: "<fill-in>", regex: /<fill-in>/iu },
  { label: "<your-*-here>", regex: /<your-[^>]*-here>/iu },
  { label: "xxx", regex: /\bxxx\b/iu },
  { label: "ellipsis", regex: /\.{3}/u }
];

export const SCOPE_REDUCTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "v1", regex: /\bv1\b/iu },
  { label: "for now", regex: /\bfor now\b/iu },
  { label: "later", regex: /\blater\b/iu },
  { label: "temporary", regex: /\btemporary\b/iu },
  { label: "placeholder", regex: /\bplaceholder\b/iu },
  { label: "mock for now", regex: /\bmock for now\b/iu },
  { label: "hardcoded for now", regex: /\bhardcoded for now\b/iu },
  { label: "will improve later", regex: /\bwill improve later\b/iu }
];

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { hasFrontmatter: false, values: {} };
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex < 0) {
    return { hasFrontmatter: false, values: {} };
  }
  const values: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim();
    values[key] = value;
  }
  return { hasFrontmatter: true, values };
}

export function extractDecisionIds(text: string): string[] {
  const ids = text.match(/\bD-\d+\b/gu) ?? [];
  return [...new Set(ids)];
}

export function extractRequirementIdsFromMarkdown(text: string): string[] {
  const ids = text.match(/\bR\d+\b/gu) ?? [];
  return [...new Set(ids)];
}

export function extractAcceptanceCriterionIdsFromMarkdown(text: string): string[] {
  const ids = text.match(/\bAC-\d+\b/giu) ?? [];
  const normalized = ids.map((id) => id.toUpperCase());
  return [...new Set(normalized)];
}

// Cross-stage decision traceability uses stable D-XX IDs which the
// agent can edit safely without recomputing content hashes.

export function collectPatternHits(
  text: string,
  patterns: Array<{ label: string; regex: RegExp }>
): string[] {
  const hits: string[] = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      hits.push(pattern.label);
    }
  }
  return hits;
}

export interface ValidateSectionBodyContext {
  /**
   * optional H2 sections map for cross-section
   * checks (e.g. Architecture Diagram failure-edge enforcement gates
   * on Failure Mode Table presence). When omitted, cross-section
   * checks fall back to legacy blanket enforcement.
   */
  sections?: H2SectionMap | null;
  /**
   * when true, lite-tier-only relaxations apply.
   * Currently used by the Interaction Edge Case matrix to demote
   * network-dependent mandatory rows to advisory when the design has
   * no Failure Mode Table rows and no external-dependency keywords
   * in the Architecture Diagram body.
   */
  liteTier?: boolean;
  /**
   * pre-resolved RED/GREEN Evidence pointer state. The
   * artifact linter resolves `Evidence: <path|spanId:...>` lines and
   * inspects the TDD slice sidecar before invoking
   * `validateSectionBody`; the resulting booleans here let the
   * validator short-circuit without re-doing async work.
   */
  tddEvidence?: {
    red?: TddEvidencePointerOptions;
    green?: TddEvidencePointerOptions;
  };
}

export function validateSectionBody(
  sectionBody: string,
  rule: string,
  sectionName: string,
  context: ValidateSectionBodyContext = {}
): { ok: boolean; details: string } {
  const bodyLines = sectionBody.split(/\r?\n/).map((line) => line.trim());
  const meaningful = meaningfulLineCount(sectionBody);
  if (meaningful === 0) {
    return {
      ok: false,
      details: "Section exists but has no meaningful content yet."
    };
  }

  const minItems = extractMinItemsFromRule(rule);
  if (minItems !== null) {
    const count = countListItems(sectionBody);
    if (count < minItems) {
      return {
        ok: false,
        details: `Rule expects at least ${minItems} item(s), found ${count}.`
      };
    }
  }

  if (/table must use 4 columns/iu.test(rule)) {
    const header = tableHeaderCells(sectionBody);
    if (!header) {
      return {
        ok: false,
        details: "Rule expects a markdown table header with a separator row."
      };
    }
    const expected = ["Category", "Question asked", "User answer", "Evidence note"];
    const normalizedHeader = header.map((cell) => cell.toLowerCase());
    const normalizedExpected = expected.map((cell) => cell.toLowerCase());
    const matches =
      normalizedHeader.length === normalizedExpected.length &&
      normalizedHeader.every((cell, index) => cell === normalizedExpected[index]);
    if (!matches) {
      return {
        ok: false,
        details: `Rule expects Clarification Log header: ${expected.join(" | ")}.`
      };
    }
  }

  if (/exactly one/iu.test(rule)) {
    const tokens = tokensFromRule(rule);
    if (tokens.length > 0) {
      const selected = new Set<string>();
      const tokenLines: Array<{ line: string; token: string }> = [];
      for (const line of bodyLines) {
        if (!line) continue;
        for (const token of tokens) {
          if (!lineHasToken(line, token)) continue;
          tokenLines.push({ line, token });
          if (/\[x\]/iu.test(line) || /selected|verdict|enum|execution result|status/iu.test(line)) {
            selected.add(token);
          }
        }
      }
      if (selected.size === 0 && tokenLines.length === 1 && !tokenLines[0]!.line.includes("|")) {
        selected.add(tokenLines[0]!.token);
      }
      if (selected.size !== 1) {
        return {
          ok: false,
          details: `Rule expects exactly one selected token (${tokens.join(", ")}); found ${selected.size}.`
        };
      }
      return { ok: true, details: "Exactly one token selected as expected." };
    }
  }

  if (/Status:\s*pending\s+until/iu.test(rule)) {
    const statusLine = bodyLines.find((l) => /^\s*-?\s*Status\s*:/iu.test(l));
    if (!statusLine) {
      return { ok: false, details: "WAIT_FOR_CONFIRM section must contain a 'Status:' line." };
    }
    const validStatuses = ["pending", "approved"];
    const statusMatch = /Status\s*:\s*(\S+)/iu.exec(statusLine);
    const statusValue = statusMatch?.[1]?.toLowerCase();
    if (!statusValue || !validStatuses.includes(statusValue)) {
      const foundLabel = statusValue || "(empty)";
      return {
        ok: false,
        details: "WAIT_FOR_CONFIRM Status must be exactly one of: " + validStatuses.join(", ") + ". Found: " + foundLabel + "."
      };
    }
  }

  const sectionNameNormalized = normalizeHeadingTitle(sectionName).toLowerCase();
  if (sectionNameNormalized === "red evidence") {
    return validateTddRedEvidence(sectionBody, context.tddEvidence?.red ?? {});
  }
  if (sectionNameNormalized === "green evidence") {
    return validateTddGreenEvidence(sectionBody, context.tddEvidence?.green ?? {});
  }
  if (sectionNameNormalized === "verification ladder") {
    return validateVerificationLadder(sectionBody);
  }
  if (sectionNameNormalized === "failure mode table") {
    return validateFailureModeTable(sectionBody);
  }
  if (sectionNameNormalized === "pre-scope system audit") {
    return validatePreScopeSystemAudit(sectionBody);
  }
  if (sectionNameNormalized === "scope summary") {
    return validateScopeSummary(sectionBody);
  }
  if (sectionNameNormalized.startsWith("requirements")) {
    return validateRequirementsTaxonomy(sectionBody);
  }
  if (sectionNameNormalized === "data flow") {
    return validateInteractionEdgeCaseMatrix(sectionBody, {
      sections: context.sections ?? null,
      liteTier: context.liteTier ?? false
    });
  }
  if (sectionNameNormalized === "architecture diagram") {
    return validateArchitectureDiagram(sectionBody, { sections: context.sections ?? null });
  }

  if (
    sectionNameNormalized === "acceptance criteria" &&
    /observable[\s,]*measurable[\s,]+(and )?falsifiable/iu.test(rule)
  ) {
    const rows = getMarkdownTableRows(sectionBody);
    for (const row of rows) {
      const criterionText = row[1] ?? row[0] ?? "";
      const adjective = lineContainsVagueAdjective(criterionText);
      if (adjective) {
        return {
          ok: false,
          details: `Acceptance criterion uses vague adjective "${adjective}" without a measurable predicate: "${criterionText.slice(0, 140)}". Rewrite with a numeric threshold or boolean outcome.`
        };
      }
      const hasDigit = /\d/u.test(criterionText);
      const hasMeasurableVerb = /\b(blocks?|rejects?|returns?|matches?|equals?|emits?|succeeds?|fails?|publishes?|logs?|persists?|reads?|writes?|creates?|deletes?|throws?|contains?|restores?|exceeds?|responds?|warns?|quarantines?|includes?|raises?|passes?|denies|refuses|exits|succeeds|completes|prevents|allows|maps|points|signals|surfaces|records|produces|accepts|requires)\b/iu.test(
        criterionText
      );
      const hasMeaningfulText = /[A-Za-z]/u.test(criterionText) && criterionText.trim().length >= 12;
      if (hasMeaningfulText && !hasDigit && !hasMeasurableVerb) {
        return {
          ok: false,
          details: `Acceptance criterion lacks a measurable predicate (no numeric threshold, no observable verb like blocks/returns/publishes/matches): "${criterionText.slice(0, 140)}". Rewrite so the criterion is falsifiable by a single test.`
        };
      }
    }
  }

  return {
    ok: true,
    details: "Section heading and content satisfy lint heuristics."
  };
}


export interface StageLintContext {
  projectRoot: string;
  stage: FlowStage;
  track: FlowTrack;
  discoveryMode: DiscoveryMode;
  raw: string;
  absFile: string;
  sections: H2SectionMap;
  findings: LintFinding[];
  parsedFrontmatter: ParsedFrontmatter;
  brainstormShortCircuitBody: string | null;
  brainstormShortCircuitActivated: boolean;
  scopePreAuditEnabled: boolean;
  staleDiagramAuditEnabled: boolean;
  isTrivialOverride: boolean;
  overrideSet: Set<string> | null;
  /**
   * Stage-level flags persisted to flow-state.json `activeRun.currentStage.flags`
   * (or equivalent). Used as escape-hatch signal for the Q&A floor rule
   * (e.g. `--skip-questions` downgrades `qa_log_unconverged` to advisory).
   * When orchestrator cannot read flow-state, defaults to an empty array.
   */
  activeStageFlags: string[];
  /**
   * task class for the active run, mirrored from
   * `flow-state.json::taskClass`. `null` when not classified. Stage
   * linters read this together with `track` via
   * `shouldDemoteArtifactValidationByTrack` to demote advanced
   * artifact-level checks (architecture diagram async/failure edges,
   * interaction edge-case mandatory rows, stale-diagram drift,
   * expansion-strategist delegation) from required → advisory.
   */
  taskClass: "software-standard" | "software-trivial" | "software-bugfix" | null;
  /**
   * `flow-state.json::packageVersion` when present.
   */
  packageVersion?: string | null;
}
