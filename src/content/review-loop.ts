import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FlowStage } from "../types.js";
import type { SkillEnvelope } from "./stage-schema.js";

export const REVIEW_LOOP_STAGES = ["scope", "design"] as const;
export type ReviewLoopStage = (typeof REVIEW_LOOP_STAGES)[number];

export const REVIEW_LOOP_DEFAULT_MAX_ITERATIONS = 3;
export const REVIEW_LOOP_DEFAULT_TARGET_SCORE = 0.8;

export type ReviewFindingSeverity = "critical" | "important" | "suggestion";
export type ReviewLoopStopReason =
  | "quality_threshold_met"
  | "max_iterations_reached"
  | "user_opt_out";

export interface ReviewLoopDimension {
  id: string;
  label: string;
  weight: number;
  guidance: string;
}

export interface ReviewLoopDimensionScore {
  dimensionId: string;
  score: number;
  weight?: number;
  rationale?: string;
}

export interface ReviewFinding {
  id: string;
  dimensionId: string;
  severity: ReviewFindingSeverity;
  summary: string;
  evidence?: string;
  recommendation?: string;
}

export interface ReviewLoopBudget {
  maxIterations?: number;
  targetScore?: number;
}

export interface ReviewLoopIterationSummary {
  iteration: number;
  qualityScore: number;
  findingsCount: number;
}

export interface ReviewLoopInput {
  artifactPath: string;
  stage: ReviewLoopStage;
  checklist?: readonly ReviewLoopDimension[];
  priorIterations?: ReadonlyArray<ReviewLoopIterationSummary>;
  budget?: ReviewLoopBudget;
}

export interface ReviewLoopDispatchRequest {
  stage: ReviewLoopStage;
  artifactPath: string;
  checklist: readonly ReviewLoopDimension[];
  priorIterations: ReadonlyArray<ReviewLoopIterationSummary>;
  iteration: number;
  budget: Required<ReviewLoopBudget>;
}

export interface ReviewLoopIterationResult {
  qualityScore: number;
  findings: ReviewFinding[];
  iteration: number;
  shouldContinue: boolean;
  dimensionScores: ReviewLoopDimensionScore[];
}

export interface ReviewLoopEnvelope {
  type: "review-loop";
  version: "1";
  stage: ReviewLoopStage;
  artifactPath: string;
  targetScore: number;
  maxIterations: number;
  stopReason: ReviewLoopStopReason;
  iterations: ReviewLoopIterationSummary[];
}

export interface ReviewLoopRunResult {
  iterations: ReviewLoopIterationResult[];
  qualityScore: number;
  stopReason: ReviewLoopStopReason;
  envelope: ReviewLoopEnvelope;
}

export type ReviewLoopDispatcher = (
  request: ReviewLoopDispatchRequest
) => Promise<unknown>;

export interface ReviewLoopDispatchAdapterRequest {
  request: ReviewLoopDispatchRequest;
  prompt: string;
  responseSchema: string;
}

export type ReviewLoopDispatchAdapter = (
  payload: ReviewLoopDispatchAdapterRequest
) => Promise<unknown>;

export type ReviewLoopApplyFindings = (
  iteration: ReviewLoopIterationResult
) => Promise<void> | void;

export interface RunReviewLoopOptions {
  dispatcher: ReviewLoopDispatcher;
  applyFindings: ReviewLoopApplyFindings;
  shouldOptOut?: () => boolean;
  emitEnvelope?: (envelope: ReviewLoopEnvelope) => void;
}

const REVIEW_LOOP_RESPONSE_SCHEMA = `{
  "findings": [
    {
      "id": "F-1",
      "dimensionId": "<one checklist id>",
      "severity": "critical|important|suggestion",
      "summary": "what is wrong",
      "evidence": "artifact quote/path",
      "recommendation": "concrete fix"
    }
  ],
  "dimensionScores": [
    {
      "dimensionId": "<one checklist id>",
      "score": 0.0
    }
  ]
}`;

export const REVIEW_LOOP_CHECKLISTS = {
  scope: [
    {
      id: "premise_fit",
      label: "Premise fit",
      weight: 1,
      guidance:
        "Does the scope contract solve the actual user/problem framing without drifting into adjacent asks?"
    },
    {
      id: "alternatives_coverage",
      label: "Alternatives coverage",
      weight: 1,
      guidance:
        "Are meaningful alternatives compared with explicit trade-offs and one clear recommendation?"
    },
    {
      id: "error_rescue_registry",
      label: "Error and rescue coverage",
      weight: 1,
      guidance:
        "Does each scoped capability define failure mode, detection signal, and fallback/rescue behavior?"
    },
    {
      id: "scope_creep_risk",
      label: "Scope-creep risk",
      weight: 1,
      guidance:
        "Are in/out boundaries explicit and protected against silent expansion/reduction language?"
    },
    {
      id: "completion_status_fidelity",
      label: "Completion status fidelity",
      weight: 1,
      guidance:
        "Does the completion dashboard honestly report unresolved risks, decision count, and stop reason?"
    }
  ],
  design: [
    {
      id: "architecture_fit",
      label: "Architecture fit",
      weight: 1,
      guidance:
        "Do architecture boundaries and diagrams align with scope and real blast-radius code?"
    },
    {
      id: "failure_mode_coverage",
      label: "Failure-mode coverage",
      weight: 1,
      guidance:
        "Does the failure-mode table capture method/exception/rescue/user-visible impact for critical paths?"
    },
    {
      id: "test_coverage_realism",
      label: "Test coverage realism",
      weight: 1,
      guidance:
        "Is the proposed test split realistic (unit/integration/e2e) with explicit gap handling?"
    },
    {
      id: "performance_budget",
      label: "Performance budget",
      weight: 1,
      guidance:
        "Are critical metrics, thresholds, and measurement methods concrete and enforceable?"
    },
    {
      id: "observability_adequacy",
      label: "Observability adequacy",
      weight: 1,
      guidance:
        "Can on-call trace a failure from user symptom to root cause via logs/metrics/traces/alerts?"
    }
  ]
} as const satisfies Record<ReviewLoopStage, readonly ReviewLoopDimension[]>;

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeBudget(budget?: ReviewLoopBudget): Required<ReviewLoopBudget> {
  const maxIterations =
    typeof budget?.maxIterations === "number" && Number.isInteger(budget.maxIterations)
      ? Math.min(Math.max(budget.maxIterations, 1), 10)
      : REVIEW_LOOP_DEFAULT_MAX_ITERATIONS;
  const targetScore =
    typeof budget?.targetScore === "number"
      ? clampScore(budget.targetScore)
      : REVIEW_LOOP_DEFAULT_TARGET_SCORE;
  return { maxIterations, targetScore };
}

function formatChecklistForPrompt(checklist: readonly ReviewLoopDimension[]): string {
  return checklist
    .map((dimension, index) => {
      return `${index + 1}. [${dimension.id}] ${dimension.label} (weight=${dimension.weight})\n   - ${dimension.guidance}`;
    })
    .join("\n");
}

function formatPriorIterationsForPrompt(
  priorIterations: ReadonlyArray<ReviewLoopIterationSummary>
): string {
  if (priorIterations.length === 0) {
    return "- none";
  }
  return priorIterations
    .map((row) => {
      return `- iteration ${row.iteration}: score=${row.qualityScore.toFixed(3)}, findings=${row.findingsCount}`;
    })
    .join("\n");
}

export function buildOutsideVoiceReviewPrompt(
  request: ReviewLoopDispatchRequest
): string {
  return [
    "You are the Outside Voice adversarial reviewer.",
    "Review ONLY the provided artifact markdown and return strict JSON (no prose).",
    "",
    `Stage: ${request.stage}`,
    `Iteration: ${request.iteration}/${request.budget.maxIterations}`,
    `Target quality score: ${request.budget.targetScore}`,
    "",
    "Checklist dimensions:",
    formatChecklistForPrompt(request.checklist),
    "",
    "Prior iterations:",
    formatPriorIterationsForPrompt(request.priorIterations),
    "",
    "Return JSON schema:",
    REVIEW_LOOP_RESPONSE_SCHEMA
  ].join("\n");
}

export function createOutsideVoiceDispatcher(
  adapter: ReviewLoopDispatchAdapter
): ReviewLoopDispatcher {
  return async (request) => {
    return adapter({
      request,
      prompt: buildOutsideVoiceReviewPrompt(request),
      responseSchema: REVIEW_LOOP_RESPONSE_SCHEMA
    });
  };
}

function normalizeSeverity(value: unknown): ReviewFindingSeverity {
  if (typeof value !== "string") return "important";
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "suggestion") return "suggestion";
  return "important";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseFindings(
  value: unknown,
  checklist: readonly ReviewLoopDimension[]
): ReviewFinding[] {
  if (!Array.isArray(value)) return [];
  const fallbackDimension = checklist[0]?.id ?? "general";
  const allowedDimensions = new Set(checklist.map((item) => item.id));
  const findings: ReviewFinding[] = [];
  value.forEach((raw, index) => {
    const row = asRecord(raw);
    if (!row) return;
    const summary =
      typeof row.summary === "string"
        ? row.summary.trim()
        : typeof row.finding === "string"
          ? row.finding.trim()
          : "";
    if (summary.length === 0) return;
    const requestedDimension =
      typeof row.dimensionId === "string"
        ? row.dimensionId
        : typeof row.dimension === "string"
          ? row.dimension
          : fallbackDimension;
    const dimensionId = allowedDimensions.has(requestedDimension)
      ? requestedDimension
      : fallbackDimension;
    findings.push({
      id:
        typeof row.id === "string" && row.id.trim().length > 0
          ? row.id.trim()
          : `F-${index + 1}`,
      dimensionId,
      severity: normalizeSeverity(row.severity),
      summary,
      evidence: typeof row.evidence === "string" ? row.evidence : undefined,
      recommendation:
        typeof row.recommendation === "string" ? row.recommendation : undefined
    });
  });
  return findings;
}

function inferDimensionScoresFromFindings(
  checklist: readonly ReviewLoopDimension[],
  findings: readonly ReviewFinding[]
): ReviewLoopDimensionScore[] {
  const byDimension = new Map<string, number>(
    checklist.map((dimension) => [dimension.id, 1])
  );
  for (const finding of findings) {
    const current = byDimension.get(finding.dimensionId) ?? 1;
    const penalty =
      finding.severity === "critical"
        ? 0.4
        : finding.severity === "important"
          ? 0.2
          : 0.1;
    byDimension.set(finding.dimensionId, clampScore(current - penalty));
  }
  return checklist.map((dimension) => ({
    dimensionId: dimension.id,
    score: byDimension.get(dimension.id) ?? 0,
    weight: dimension.weight
  }));
}

function parseDimensionScores(
  value: unknown,
  checklist: readonly ReviewLoopDimension[],
  findings: readonly ReviewFinding[]
): ReviewLoopDimensionScore[] {
  if (!Array.isArray(value)) {
    return inferDimensionScoresFromFindings(checklist, findings);
  }
  const allowedDimensions = new Set(checklist.map((item) => item.id));
  const parsed: ReviewLoopDimensionScore[] = [];
  value.forEach((raw) => {
    const row = asRecord(raw);
    if (!row) return;
    const rawDimension =
      typeof row.dimensionId === "string"
        ? row.dimensionId
        : typeof row.dimension === "string"
          ? row.dimension
          : "";
    if (!allowedDimensions.has(rawDimension)) return;
    if (typeof row.score !== "number" || Number.isNaN(row.score)) return;
    parsed.push({
      dimensionId: rawDimension,
      score: clampScore(row.score),
      weight: typeof row.weight === "number" ? row.weight : undefined,
      rationale: typeof row.rationale === "string" ? row.rationale : undefined
    });
  });
  if (parsed.length === 0) {
    return inferDimensionScoresFromFindings(checklist, findings);
  }
  return parsed;
}

function unwrapDispatcherPayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {
        findings: [{ summary: raw, severity: "important" }]
      };
    }
  }
  const record = asRecord(raw);
  if (!record) {
    return raw;
  }
  const payload = asRecord(record.payload);
  if (payload && (Array.isArray(payload.findings) || Array.isArray(payload.dimensionScores))) {
    return payload;
  }
  if (typeof record.output === "string") {
    try {
      return JSON.parse(record.output);
    } catch {
      return { findings: [{ summary: record.output, severity: "important" }] };
    }
  }
  if (typeof record.text === "string") {
    try {
      return JSON.parse(record.text);
    } catch {
      return { findings: [{ summary: record.text, severity: "important" }] };
    }
  }
  return raw;
}

export function parseReviewLoopDispatcherResult(
  raw: unknown,
  checklist: readonly ReviewLoopDimension[]
): { findings: ReviewFinding[]; dimensionScores: ReviewLoopDimensionScore[] } {
  const payload = unwrapDispatcherPayload(raw);
  const record = asRecord(payload);
  const findings = parseFindings(record?.findings, checklist);
  const dimensionScores = parseDimensionScores(
    record?.dimensionScores,
    checklist,
    findings
  );
  return { findings, dimensionScores };
}

export function aggregateQualityScore(
  scores: readonly ReviewLoopDimensionScore[],
  checklist: readonly ReviewLoopDimension[]
): number {
  if (checklist.length === 0) return 0;
  const byDimension = new Map(scores.map((row) => [row.dimensionId, row]));
  let weightedScore = 0;
  let totalWeight = 0;
  for (const dimension of checklist) {
    const scoreRow = byDimension.get(dimension.id);
    const score = clampScore(scoreRow?.score ?? 0);
    const weight =
      typeof scoreRow?.weight === "number" && scoreRow.weight > 0
        ? scoreRow.weight
        : dimension.weight;
    totalWeight += weight;
    weightedScore += score * weight;
  }
  if (totalWeight <= 0) return 0;
  return clampScore(weightedScore / totalWeight);
}

async function materializeArtifactForDispatch(
  artifactPath: string,
  stage: ReviewLoopStage,
  iteration: number
): Promise<{ tempDir: string; tempArtifactPath: string }> {
  const markdown = await fs.readFile(artifactPath, "utf8");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `cclaw-review-loop-${stage}-`));
  const tempArtifactPath = path.join(tempDir, `artifact-iteration-${iteration}.md`);
  await fs.writeFile(tempArtifactPath, markdown, "utf8");
  return { tempDir, tempArtifactPath };
}

export async function runReviewLoopIteration(
  input: ReviewLoopInput & { iteration: number },
  dispatcher: ReviewLoopDispatcher
): Promise<ReviewLoopIterationResult> {
  const checklist = input.checklist ?? REVIEW_LOOP_CHECKLISTS[input.stage];
  const budget = normalizeBudget(input.budget);
  const priorIterations = input.priorIterations ?? [];
  const { tempDir, tempArtifactPath } = await materializeArtifactForDispatch(
    input.artifactPath,
    input.stage,
    input.iteration
  );
  try {
    const raw = await dispatcher({
      stage: input.stage,
      artifactPath: tempArtifactPath,
      checklist,
      priorIterations,
      iteration: input.iteration,
      budget
    });
    const { findings, dimensionScores } = parseReviewLoopDispatcherResult(raw, checklist);
    const qualityScore = aggregateQualityScore(dimensionScores, checklist);
    return {
      qualityScore,
      findings,
      iteration: input.iteration,
      shouldContinue:
        qualityScore < budget.targetScore && input.iteration < budget.maxIterations,
      dimensionScores
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function buildReviewLoopEnvelope(args: {
  stage: ReviewLoopStage;
  artifactPath: string;
  targetScore: number;
  maxIterations: number;
  stopReason: ReviewLoopStopReason;
  iterations: ReadonlyArray<ReviewLoopIterationSummary>;
}): ReviewLoopEnvelope {
  return {
    type: "review-loop",
    version: "1",
    stage: args.stage,
    artifactPath: args.artifactPath,
    targetScore: args.targetScore,
    maxIterations: args.maxIterations,
    stopReason: args.stopReason,
    iterations: [...args.iterations]
  };
}

function formatScore(value: number): string {
  return clampScore(value).toFixed(3);
}

function finalEnvelopeScore(envelope: ReviewLoopEnvelope): number {
  if (envelope.iterations.length === 0) return 0;
  return envelope.iterations[envelope.iterations.length - 1]!.qualityScore;
}

export function renderReviewLoopHeader(
  envelope: ReviewLoopEnvelope
): string {
  return `> Review Loop Quality: ${formatScore(finalEnvelopeScore(envelope))} | stop: ${envelope.stopReason} | iterations: ${envelope.iterations.length}/${envelope.maxIterations}`;
}

export function upsertReviewLoopHeader(
  markdown: string,
  envelope: ReviewLoopEnvelope
): string {
  const header = renderReviewLoopHeader(envelope);
  const existingHeader = /^>\s+Review Loop Quality:.*$/m;
  if (existingHeader.test(markdown)) {
    return markdown.replace(existingHeader, header);
  }
  const firstHeading = /^# .+$/m.exec(markdown);
  if (!firstHeading || firstHeading.index < 0) {
    const prefix = markdown.length > 0 ? `${header}\n\n` : `${header}\n`;
    return `${prefix}${markdown}`;
  }
  const headingEnd = firstHeading.index + firstHeading[0].length;
  return `${markdown.slice(0, headingEnd)}\n\n${header}${markdown.slice(headingEnd)}`;
}

export function renderReviewLoopSummarySection(
  envelope: ReviewLoopEnvelope
): string {
  const rows = envelope.iterations.length > 0
    ? envelope.iterations
      .map((row) => {
        return `| ${row.iteration} | ${formatScore(row.qualityScore)} | ${row.findingsCount} |`;
      })
      .join("\n")
    : "| 0 | 0.000 | 0 |";
  return `## Spec Review Loop
| Iteration | Quality Score | Findings |
|---|---|---|
${rows}

- Stop reason: ${envelope.stopReason}
- Target score: ${formatScore(envelope.targetScore)}
- Max iterations: ${envelope.maxIterations}`;
}

export function upsertReviewLoopSummary(
  markdown: string,
  envelope: ReviewLoopEnvelope
): string {
  const withHeader = upsertReviewLoopHeader(markdown, envelope);
  const section = renderReviewLoopSummarySection(envelope);
  const headingRe = /^##\s+Spec Review Loop\s*$/m;
  const match = headingRe.exec(withHeader);
  if (!match || match.index < 0) {
    const needsBreak = withHeader.endsWith("\n") ? "" : "\n";
    return `${withHeader}${needsBreak}\n${section}\n`;
  }
  const start = match.index;
  const afterStart = withHeader.slice(start + match[0].length);
  const nextHeading = /\n##\s+/m.exec(afterStart);
  const end = nextHeading ? start + match[0].length + nextHeading.index + 1 : withHeader.length;
  return `${withHeader.slice(0, start)}${section}\n${withHeader.slice(end)}`.replace(/\n{3,}/g, "\n\n");
}

export function toSkillEnvelope(
  envelope: ReviewLoopEnvelope,
  emittedAt: string = new Date().toISOString(),
  agent?: string
): SkillEnvelope {
  return {
    version: "1",
    kind: "stage-output",
    stage: envelope.stage,
    payload: envelope,
    emittedAt,
    ...(agent ? { agent } : {})
  };
}

export async function runReviewLoop(
  input: ReviewLoopInput,
  options: RunReviewLoopOptions
): Promise<ReviewLoopRunResult> {
  const budget = normalizeBudget(input.budget);
  const prior = [...(input.priorIterations ?? [])];
  const iterations: ReviewLoopIterationResult[] = [];
  let stopReason: ReviewLoopStopReason = "max_iterations_reached";

  while (iterations.length < budget.maxIterations) {
    if (options.shouldOptOut?.()) {
      stopReason = "user_opt_out";
      break;
    }
    const iteration = prior.length + iterations.length + 1;
    const result = await runReviewLoopIteration(
      {
        ...input,
        iteration,
        priorIterations: [
          ...prior,
          ...iterations.map((row) => ({
            iteration: row.iteration,
            qualityScore: row.qualityScore,
            findingsCount: row.findings.length
          }))
        ]
      },
      options.dispatcher
    );
    iterations.push(result);
    await options.applyFindings(result);
    if (result.qualityScore >= budget.targetScore) {
      stopReason = "quality_threshold_met";
      break;
    }
    if (iterations.length >= budget.maxIterations) {
      stopReason = "max_iterations_reached";
      break;
    }
  }

  const summaryRows: ReviewLoopIterationSummary[] = [
    ...prior,
    ...iterations.map((row) => ({
      iteration: row.iteration,
      qualityScore: row.qualityScore,
      findingsCount: row.findings.length
    }))
  ];
  const finalQualityScore =
    summaryRows.length > 0 ? summaryRows[summaryRows.length - 1]!.qualityScore : 0;
  const envelope = buildReviewLoopEnvelope({
    stage: input.stage,
    artifactPath: input.artifactPath,
    targetScore: budget.targetScore,
    maxIterations: budget.maxIterations,
    stopReason,
    iterations: summaryRows
  });
  options.emitEnvelope?.(envelope);
  return {
    iterations,
    qualityScore: finalQualityScore,
    stopReason,
    envelope
  };
}

export function isReviewLoopStage(stage: FlowStage): stage is ReviewLoopStage {
  return (REVIEW_LOOP_STAGES as readonly string[]).includes(stage);
}
