import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import type { Writable } from "node:stream";
import { resolveArtifactPath } from "../artifact-paths.js";
import { RUNTIME_ROOT, SHIP_FINALIZATION_MODES } from "../constants.js";
import { stageAutoSubagentDispatch, stageSchema } from "../content/stage-schema.js";
import {
  appendDelegation,
  checkMandatoryDelegations,
  readDelegationLedger
} from "../delegation.js";
import {
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "../gate-evidence.js";
import { extractMarkdownSectionBody, parseLearningsSection } from "../artifact-linter.js";
import {
  getAvailableTransitions,
  getTransitionGuards,
  isFlowTrack,
  createInitialFlowState,
  type FlowState,
  type StageGateState
} from "../flow-state.js";
import { appendKnowledge } from "../knowledge-store.js";
import { readFlowState, writeFlowState } from "../runs.js";
import { FLOW_STAGES, TRACK_STAGES, type FlowStage, type FlowTrack } from "../types.js";
import { runCompoundReadinessCommand } from "./compound-readiness.js";
import { runHookManifestCommand } from "./hook-manifest.js";
import { runEnvelopeValidateCommand } from "./envelope-validate.js";
import { runTddLoopStatusCommand } from "./tdd-loop-status.js";
import { runTddRedEvidenceCommand } from "./tdd-red-evidence.js";
import { extractReviewLoopEnvelopeFromArtifact } from "../content/review-loop.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface AdvanceStageArgs {
  stage: FlowStage;
  passedGateIds: string[];
  evidenceByGate: Record<string, string>;
  waiveDelegations: string[];
  waiverReason?: string;
  quiet: boolean;
  json: boolean;
}

interface VerifyFlowStateDiffArgs {
  afterJson?: string;
  afterFile?: string;
  quiet: boolean;
}

interface VerifyCurrentStateArgs {
  quiet: boolean;
}

interface HookArgs {
  hookName: string;
}

interface StartFlowArgs {
  track: FlowTrack;
  className?: string;
  prompt?: string;
  reason?: string;
  stack?: string;
  forceReset: boolean;
  reclassify: boolean;
  quiet: boolean;
}

interface InternalValidationReport {
  ok: boolean;
  stage: FlowStage;
  delegation: {
    satisfied: boolean;
    missing: string[];
    waived: string[];
    missingEvidence: string[];
    expectedMode: string;
  };
  gates: {
    ok: boolean;
    complete: boolean;
    issues: string[];
    missingRequired: string[];
    missingTriggeredConditional: string[];
  };
  completedStages: {
    ok: boolean;
    issues: string[];
  };
}

const AUTO_REVIEW_LOOP_GATE_BY_STAGE: Partial<Record<FlowStage, string>> = {
  design: "design_architecture_locked"
};

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function resolveSuccessorTransition(
  stage: FlowStage,
  track: FlowState["track"],
  transitionTargets: FlowStage[],
  satisfiedGuards: Set<string>,
  selectedTransitionGuards: Set<string>
): FlowStage | null {
  const natural = transitionTargets[0] ?? null;
  const specialTargets = transitionTargets.filter((target) => target !== natural);

  for (const target of specialTargets) {
    const guards = getTransitionGuards(stage, target, track);
    if (guards.length === 0) continue;
    const selectedSpecial = guards.some((guard) => selectedTransitionGuards.has(guard));
    if (!selectedSpecial) continue;
    if (guards.every((guard) => satisfiedGuards.has(guard))) {
      return target;
    }
  }

  if (natural) {
    const guards = getTransitionGuards(stage, natural, track);
    if (guards.every((guard) => satisfiedGuards.has(guard))) {
      return natural;
    }
  }

  for (const target of specialTargets) {
    const guards = getTransitionGuards(stage, target, track);
    if (guards.every((guard) => satisfiedGuards.has(guard))) {
      return target;
    }
  }

  return natural;
}

const TEST_COMMAND_HINT_PATTERN = /\b(?:npm test|pnpm test|yarn test|bun test|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|dotnet test)\b/iu;
const SHA_WITH_LABEL_PATTERN = /\b(?:sha|commit)(?:\s*[:=]|\s+)\s*[0-9a-f]{7,40}\b/iu;
const PASS_STATUS_PATTERN = /\b(?:pass|passed|green|ok)\b/iu;
const SHIP_FINALIZATION_MODE_PATTERN =
  new RegExp(`\\b(?:${SHIP_FINALIZATION_MODES.join("|")})\\b`, "u");
const SHIP_FINALIZATION_MODE_HINT = SHIP_FINALIZATION_MODES.join(", ");
const REVIEW_LOOP_STOP_REASONS = new Set([
  "quality_threshold_met",
  "max_iterations_reached",
  "user_opt_out"
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickReviewLoopEnvelope(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (!direct) return null;
  if (direct.type === "review-loop") return direct;
  const payload = asRecord(direct.payload);
  if (payload?.type === "review-loop") return payload;
  const nested = asRecord(direct.reviewLoop);
  if (nested?.type === "review-loop") return nested;
  return null;
}

function validateReviewLoopGateEvidence(stage: "scope" | "design", evidence: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidence);
  } catch {
    return "must be JSON containing a review-loop envelope (`type: \"review-loop\"`) in top-level, `payload`, or `reviewLoop`.";
  }
  const envelope = pickReviewLoopEnvelope(parsed);
  if (!envelope) {
    return "must include a review-loop envelope (`type: \"review-loop\"`) in top-level, `payload`, or `reviewLoop`.";
  }
  if (envelope.stage !== stage) {
    return `review-loop envelope stage must be "${stage}".`;
  }
  const targetScore = envelope.targetScore;
  if (typeof targetScore !== "number" || Number.isNaN(targetScore) || targetScore < 0 || targetScore > 1) {
    return "review-loop targetScore must be a number between 0 and 1.";
  }
  const maxIterations = envelope.maxIterations;
  if (
    typeof maxIterations !== "number" ||
    Number.isNaN(maxIterations) ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1
  ) {
    return "review-loop maxIterations must be an integer >= 1.";
  }
  if (typeof envelope.stopReason !== "string" || !REVIEW_LOOP_STOP_REASONS.has(envelope.stopReason)) {
    return "review-loop stopReason must be one of quality_threshold_met, max_iterations_reached, user_opt_out.";
  }
  const rows = envelope.iterations;
  if (!Array.isArray(rows) || rows.length === 0) {
    return "review-loop iterations must be a non-empty array.";
  }
  if (rows.length > maxIterations) {
    return "review-loop iterations count cannot exceed maxIterations.";
  }

  let prevScore = -Infinity;
  let reachedTarget = false;
  for (let index = 0; index < rows.length; index++) {
    const row = asRecord(rows[index]);
    if (!row) {
      return `review-loop iterations[${index}] must be an object.`;
    }
    const iteration = row.iteration;
    const qualityScore = row.qualityScore;
    const findingsCount = row.findingsCount;
    if (
      typeof iteration !== "number" ||
      Number.isNaN(iteration) ||
      !Number.isInteger(iteration) ||
      iteration < 1
    ) {
      return `review-loop iterations[${index}].iteration must be an integer >= 1.`;
    }
    if (
      typeof qualityScore !== "number" ||
      Number.isNaN(qualityScore) ||
      qualityScore < 0 ||
      qualityScore > 1
    ) {
      return `review-loop iterations[${index}].qualityScore must be between 0 and 1.`;
    }
    if (
      typeof findingsCount !== "number" ||
      Number.isNaN(findingsCount) ||
      !Number.isInteger(findingsCount) ||
      findingsCount < 0
    ) {
      return `review-loop iterations[${index}].findingsCount must be an integer >= 0.`;
    }
    if (qualityScore + Number.EPSILON < prevScore) {
      return "review-loop qualityScore must be monotonic non-decreasing across iterations.";
    }
    if (qualityScore >= targetScore) {
      reachedTarget = true;
    }
    prevScore = qualityScore;
  }

  if (envelope.stopReason === "quality_threshold_met" && !reachedTarget) {
    return "review-loop stopReason is quality_threshold_met but no iteration reached targetScore.";
  }
  if (envelope.stopReason === "max_iterations_reached" && rows.length < maxIterations) {
    return "review-loop stopReason is max_iterations_reached but iterations are below maxIterations.";
  }

  return null;
}

function validateUserApprovalEvidence(evidence: string): string | null {
  const normalized = evidence.trim();
  if (normalized.length === 0) {
    return "must cite explicit user approval.";
  }
  const reviewLoopEnvelope = (() => {
    try {
      return pickReviewLoopEnvelope(JSON.parse(normalized));
    } catch {
      return null;
    }
  })();
  if (reviewLoopEnvelope) {
    return "must cite explicit user approval; review-loop evidence is outside-voice evidence, not user approval.";
  }
  if (/\b(?:approved|approval|user approved|confirmed|accepted|yes|ok)\b/iu.test(normalized)) {
    return null;
  }
  if (/\b(?:утвержд(?:аю|ено|ен|ена)|подтвержд(?:аю|ено|ен|ена)|соглас(?:ен|на|овано)|да|ок|принято)\b/iu.test(normalized)) {
    return null;
  }
  return "must cite explicit user approval (for example `user approved the scope contract` or `пользователь утвердил scope`).";
}

// Per-gate validators keyed by `${stage}:${gateId}`. Returning a non-null
// string surfaces the reason as an `advance-stage` failure so evidence is
// guaranteed to carry the structural breadcrumbs downstream tooling
// expects. Previously only `tdd:tdd_verified_before_complete` was checked.
const GATE_EVIDENCE_VALIDATORS: Record<string, (evidence: string) => string | null> = {
  "tdd:tdd_verified_before_complete": (evidence) => {
    if (!TEST_COMMAND_HINT_PATTERN.test(evidence)) {
      return "must include the fresh verification command that was run (for example `npm test`, `pytest`, `go test`, or equivalent).";
    }
    if (!SHA_WITH_LABEL_PATTERN.test(evidence)) {
      return "must include a commit SHA token prefixed with `sha` or `commit` (for example `sha: abc1234`).";
    }
    if (!PASS_STATUS_PATTERN.test(evidence)) {
      return "must include explicit success status (for example `PASS` or `GREEN`).";
    }
    return null;
  },
  "review:review_trace_matrix_clean": (evidence) => {
    if (!TEST_COMMAND_HINT_PATTERN.test(evidence)) {
      return "must include the fresh verification command that was run before ship handoff (for example `npm test`, `pytest`, `go test`, or equivalent).";
    }
    if (!PASS_STATUS_PATTERN.test(evidence)) {
      return "must include explicit success status (for example `PASS` or `GREEN`).";
    }
    return null;
  },
  "ship:ship_finalization_executed": (evidence) => {
    if (!SHIP_FINALIZATION_MODE_PATTERN.test(evidence)) {
      return `must name the finalization mode that ran (for example ${SHIP_FINALIZATION_MODE_HINT}).`;
    }
    return null;
  },
  "scope:scope_user_approved": (evidence) =>
    validateUserApprovalEvidence(evidence),
  "design:design_architecture_locked": (evidence) =>
    validateReviewLoopGateEvidence("design", evidence)
};

function validateGateEvidenceShape(stage: FlowStage, gateId: string, evidence: string): string | null {
  const validator = GATE_EVIDENCE_VALIDATORS[`${stage}:${gateId}`];
  if (!validator) return null;
  return validator(evidence.trim());
}

function reviewLoopArtifactFixHint(stage: FlowStage, gateId: string): string {
  if (AUTO_REVIEW_LOOP_GATE_BY_STAGE[stage] !== gateId) return "";
  return " Add a `## Spec Review Loop` table to the artifact with rows like `| 1 | 0.80 | 0 |` plus `- Stop reason: quality_threshold_met`, `- Target score: 0.80`, and `- Max iterations: 3`; then omit this gate from manual evidence so stage-complete can auto-hydrate it.";
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isFlowStageValue(value: unknown): value is FlowStage {
  return typeof value === "string" && (FLOW_STAGES as readonly string[]).includes(value);
}

function parseGuardEvidence(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    next[key] = trimmed;
  }
  return next;
}

function emptyGateState(): StageGateState {
  return {
    required: [],
    recommended: [],
    conditional: [],
    triggered: [],
    passed: [],
    blocked: []
  };
}

function parseCandidateGateCatalog(
  value: unknown,
  fallback: FlowState["stageGateCatalog"]
): FlowState["stageGateCatalog"] {
  const next = {} as FlowState["stageGateCatalog"];
  for (const stage of FLOW_STAGES) {
    // Guard against stale on-disk flow-state files that persisted a partial
    // stageGateCatalog (missing a stage key). Previously `fallback[stage]`
    // could be undefined and the spread below would throw at runtime.
    const base = fallback[stage] ?? emptyGateState();
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered: [...base.triggered],
      passed: [...base.passed],
      blocked: [...base.blocked]
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }
  const rawCatalog = value as Record<string, unknown>;
  for (const stage of FLOW_STAGES) {
    const rawStage = rawCatalog[stage];
    if (!rawStage || typeof rawStage !== "object" || Array.isArray(rawStage)) {
      continue;
    }
    const typed = rawStage as Record<string, unknown>;
    const base = fallback[stage] ?? emptyGateState();
    const allowed = new Set([...base.required, ...base.recommended, ...base.conditional]);
    const conditional = new Set(base.conditional);
    const passed = unique(parseStringList(typed.passed)).filter((gateId) =>
      allowed.has(gateId)
    );
    const blocked = unique(parseStringList(typed.blocked)).filter((gateId) =>
      allowed.has(gateId)
    );
    const triggered = unique([
      ...parseStringList(typed.triggered).filter((gateId) => conditional.has(gateId)),
      ...passed.filter((gateId) => conditional.has(gateId)),
      ...blocked.filter((gateId) => conditional.has(gateId))
    ]);
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered,
      passed,
      blocked
    };
  }
  return next;
}

function coerceCandidateFlowState(raw: unknown, fallback: FlowState): FlowState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const typed = raw as Record<string, unknown>;
  const track = isFlowTrack(typed.track) ? typed.track : fallback.track;
  const currentStage = isFlowStageValue(typed.currentStage)
    ? typed.currentStage
    : fallback.currentStage;
  const completedStages = unique(
    parseStringList(typed.completedStages).filter((stage): stage is FlowStage =>
      isFlowStageValue(stage)
    )
  );
  const skippedStagesRaw = parseStringList(typed.skippedStages).filter((stage): stage is FlowStage =>
    isFlowStageValue(stage)
  );
  const skippedStages = skippedStagesRaw.length > 0 ? skippedStagesRaw : fallback.skippedStages;

  // When the candidate payload omits `guardEvidence` entirely we must keep
  // the on-disk fallback — otherwise a partial update (e.g. a tooling call
  // that only passes stage + passedGateIds) would silently wipe every
  // previously recorded evidence string and fail the next
  // `verifyCurrentStageGateEvidence` check.
  const candidateEvidence = parseGuardEvidence(typed.guardEvidence);
  const guardEvidence =
    typed.guardEvidence === undefined
      ? { ...fallback.guardEvidence }
      : candidateEvidence;

  return {
    ...fallback,
    currentStage,
    completedStages,
    track,
    skippedStages,
    guardEvidence,
    stageGateCatalog: parseCandidateGateCatalog(
      typed.stageGateCatalog,
      fallback.stageGateCatalog
    )
  };
}

function stringifyGateEvidenceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "passed" : "failed";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseEvidenceByGate(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `--evidence-json must be valid JSON object: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--evidence-json must deserialize to an object.");
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalized = stringifyGateEvidenceValue(value).trim();
    if (normalized.length === 0) continue;
    next[key] = normalized;
  }
  return next;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function hydrateReviewLoopEvidenceFromArtifact(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"],
  selectedGateIds: string[],
  evidenceByGate: Record<string, string>
): Promise<void> {
  const gateId = AUTO_REVIEW_LOOP_GATE_BY_STAGE[stage];
  if (!gateId) return;
  if (!selectedGateIds.includes(gateId)) return;
  const reviewStage = stage === "scope" || stage === "design" ? stage : null;
  if (!reviewStage) return;

  const existing = evidenceByGate[gateId];
  if (typeof existing === "string" && existing.trim().length > 0) {
    const existingIssue = validateGateEvidenceShape(stage, gateId, existing);
    if (!existingIssue) return;
  }

  const resolved = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  let raw = "";
  try {
    raw = await fs.readFile(resolved.absPath, "utf8");
  } catch {
    return;
  }
  const envelope = extractReviewLoopEnvelopeFromArtifact(raw, reviewStage, resolved.relPath);
  if (!envelope) return;
  evidenceByGate[gateId] = JSON.stringify(envelope);
}

function parseAdvanceStageArgs(tokens: string[]): AdvanceStageArgs {
  const [stageRaw, ...flagTokens] = tokens;
  if (!isFlowStageValue(stageRaw)) {
    throw new Error(
      `internal advance-stage requires a stage positional argument (${FLOW_STAGES.join(", ")}).`
    );
  }
  let evidenceJson: string | undefined;
  let passed: string[] = [];
  let waiveDelegations: string[] = [];
  let waiverReason: string | undefined;
  let quiet = false;
  let json = false;

  for (let i = 0; i < flagTokens.length; i += 1) {
    const token = flagTokens[i]!;
    const nextToken = flagTokens[i + 1];
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--evidence-json") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--evidence-json requires a JSON object value.");
      }
      evidenceJson = nextToken;
      i += 1;
      continue;
    }
    if (token.startsWith("--evidence-json=")) {
      evidenceJson = token.slice("--evidence-json=".length);
      continue;
    }
    if (token === "--passed") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--passed requires a comma-separated gate list.");
      }
      passed = [...passed, ...parseCsv(nextToken)];
      i += 1;
      continue;
    }
    if (token.startsWith("--passed=")) {
      passed = [...passed, ...parseCsv(token.slice("--passed=".length))];
      continue;
    }
    if (token === "--waive-delegation") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--waive-delegation requires a comma-separated agent list.");
      }
      waiveDelegations = [...waiveDelegations, ...parseCsv(nextToken)];
      i += 1;
      continue;
    }
    if (token.startsWith("--waive-delegation=")) {
      waiveDelegations = [
        ...waiveDelegations,
        ...parseCsv(token.slice("--waive-delegation=".length))
      ];
      continue;
    }
    if (token === "--waiver-reason") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--waiver-reason requires a text value.");
      }
      waiverReason = nextToken.trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--waiver-reason=")) {
      waiverReason = token.slice("--waiver-reason=".length).trim();
      continue;
    }
    throw new Error(`Unknown flag for internal advance-stage: ${token}`);
  }

  return {
    stage: stageRaw,
    passedGateIds: unique(passed),
    evidenceByGate: parseEvidenceByGate(evidenceJson),
    waiveDelegations: unique(waiveDelegations),
    waiverReason,
    quiet,
    json
  };
}

function parseVerifyFlowStateDiffArgs(tokens: string[]): VerifyFlowStateDiffArgs {
  let afterJson: string | undefined;
  let afterFile: string | undefined;
  let quiet = false;

  for (const token of tokens) {
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token.startsWith("--after-json=")) {
      afterJson = token.replace("--after-json=", "");
      continue;
    }
    if (token.startsWith("--after-file=")) {
      afterFile = token.replace("--after-file=", "");
      continue;
    }
    throw new Error(`Unknown flag for internal verify-flow-state-diff: ${token}`);
  }

  if (!afterJson && !afterFile) {
    throw new Error(
      "internal verify-flow-state-diff requires --after-json=<json> or --after-file=<path>."
    );
  }
  return { afterJson, afterFile, quiet };
}

function parseVerifyCurrentStateArgs(tokens: string[]): VerifyCurrentStateArgs {
  let quiet = false;
  for (const token of tokens) {
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    throw new Error(`Unknown flag for internal verify-current-state: ${token}`);
  }
  return { quiet };
}

function parseHookArgs(tokens: string[]): HookArgs {
  const [hookName, ...rest] = tokens;
  const normalizedHook = typeof hookName === "string" ? hookName.trim() : "";
  if (normalizedHook.length === 0) {
    throw new Error("internal hook requires a hook name: cclaw internal hook <name>.");
  }
  if (rest.length > 0) {
    throw new Error(`Unknown arguments for internal hook: ${rest.join(" ")}`);
  }
  return { hookName: normalizedHook };
}

function parseStartFlowArgs(tokens: string[]): StartFlowArgs {
  let track: FlowTrack | undefined;
  let className: string | undefined;
  let prompt: string | undefined;
  let reason: string | undefined;
  let stack: string | undefined;
  let forceReset = false;
  let reclassify = false;
  let quiet = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const nextToken = tokens[i + 1];
    const readValue = (flag: string): string => {
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
      if (token === flag && nextToken && !nextToken.startsWith("--")) {
        i += 1;
        return nextToken;
      }
      throw new Error(`${flag} requires a value.`);
    };
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--force-reset") {
      forceReset = true;
      continue;
    }
    if (token === "--reclassify") {
      reclassify = true;
      continue;
    }
    if (token === "--track" || token.startsWith("--track=")) {
      const raw = readValue("--track").trim();
      if (!isFlowTrack(raw)) {
        throw new Error(`--track must be one of: standard, medium, quick.`);
      }
      track = raw;
      continue;
    }
    if (token === "--class" || token.startsWith("--class=")) {
      className = readValue("--class").trim();
      continue;
    }
    if (token === "--prompt" || token.startsWith("--prompt=")) {
      prompt = readValue("--prompt").trim();
      continue;
    }
    if (token === "--reason" || token.startsWith("--reason=")) {
      reason = readValue("--reason").trim();
      continue;
    }
    if (token === "--stack" || token.startsWith("--stack=")) {
      stack = readValue("--stack").trim();
      continue;
    }
    throw new Error(`Unknown flag for internal start-flow: ${token}`);
  }

  if (!track) {
    throw new Error("internal start-flow requires --track=<standard|medium|quick>.");
  }
  return { track, className, prompt, reason, stack, forceReset, reclassify, quiet };
}

async function buildValidationReport(
  projectRoot: string,
  flowState: FlowState
): Promise<InternalValidationReport> {
  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage);
  const gates = await verifyCurrentStageGateEvidence(projectRoot, flowState);
  const completedStages = verifyCompletedStagesGateClosure(flowState);
  const ok = delegation.satisfied && gates.ok && gates.complete && completedStages.ok;

  return {
    ok,
    stage: flowState.currentStage,
    delegation: {
      satisfied: delegation.satisfied,
      missing: delegation.missing,
      waived: delegation.waived,
      missingEvidence: delegation.missingEvidence,
      expectedMode: delegation.expectedMode
    },
    gates: {
      ok: gates.ok,
      complete: gates.complete,
      issues: gates.issues,
      missingRequired: gates.missingRequired,
      missingTriggeredConditional: gates.missingTriggeredConditional
    },
    completedStages: {
      ok: completedStages.ok,
      issues: completedStages.issues
    }
  };
}

interface HarvestLearningsResult {
  ok: boolean;
  markerWritten: boolean;
  parsedEntries: number;
  appendedEntries: number;
  skippedDuplicates: number;
  details: string;
}

const LEARNINGS_HARVEST_MARKER_PREFIX = "<!-- cclaw:learnings-harvested:";

function withLearningsHarvestMarker(
  artifactMarkdown: string,
  appendedEntries: number,
  skippedDuplicates: number
): string {
  const suffix = artifactMarkdown.endsWith("\n") ? "" : "\n";
  return `${artifactMarkdown}${suffix}${LEARNINGS_HARVEST_MARKER_PREFIX}${new Date().toISOString()} appended=${appendedEntries} skipped=${skippedDuplicates} -->\n`;
}

async function harvestStageLearnings(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"]
): Promise<HarvestLearningsResult> {
  const resolvedArtifact = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  const artifactPath = resolvedArtifact.absPath;
  let raw = "";
  try {
    raw = await fs.readFile(artifactPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: `Unable to read artifact for learnings harvest (${artifactPath}): ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  }

  if (raw.includes(LEARNINGS_HARVEST_MARKER_PREFIX)) {
    return {
      ok: true,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: "Learnings already harvested for this artifact."
    };
  }

  const learningsBody = extractMarkdownSectionBody(raw, "Learnings");
  if (learningsBody === null) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: 'Artifact is missing required "## Learnings" section.'
    };
  }

  const parsed = parseLearningsSection(learningsBody);
  if (!parsed.ok) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: parsed.details
    };
  }

  const appendResult = await appendKnowledge(projectRoot, parsed.entries, {
    stage,
    originStage: stage,
    originRun: null,
    project: path.basename(projectRoot)
  });
  if (appendResult.invalid > 0) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: parsed.entries.length,
      appendedEntries: appendResult.appended,
      skippedDuplicates: appendResult.skippedDuplicates,
      details: `Learnings append failed schema checks: ${appendResult.errors.join(" | ")}`
    };
  }

  const withMarker = withLearningsHarvestMarker(
    raw,
    appendResult.appended,
    appendResult.skippedDuplicates
  );
  await fs.writeFile(artifactPath, withMarker, "utf8");

  return {
    ok: true,
    markerWritten: true,
    parsedEntries: parsed.entries.length,
    appendedEntries: appendResult.appended,
    skippedDuplicates: appendResult.skippedDuplicates,
    details: parsed.none
      ? "Learnings section marked none; harvest marker recorded."
      : `Harvested ${appendResult.appended} learning entr${appendResult.appended === 1 ? "y" : "ies"} (${appendResult.skippedDuplicates} duplicate skipped).`
  };
}

async function runAdvanceStage(
  projectRoot: string,
  args: AdvanceStageArgs,
  io: InternalIo
): Promise<number> {
  const flowState = await readFlowState(projectRoot);
  if (flowState.currentStage !== args.stage) {
    io.stderr.write(
      `cclaw internal advance-stage: current stage is "${flowState.currentStage}", not "${args.stage}".\n`
    );
    return 1;
  }

  const schema = stageSchema(args.stage, flowState.track);
  const requiredGateIds = schema.requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const transitionTargets = getAvailableTransitions(args.stage, flowState.track).map((rule) => rule.to);
  const allowedGateIds = new Set(
    schema.requiredGates.map((gate) => gate.id)
  );
  const transitionGuardIds = new Set(
    transitionTargets
      .flatMap((target) => getTransitionGuards(args.stage, target, flowState.track))
      .filter((guardId) => !allowedGateIds.has(guardId))
  );
  const selectableGateIds = new Set([...allowedGateIds, ...transitionGuardIds]);
  const selectedGateIds =
    args.passedGateIds.length > 0
      ? args.passedGateIds.filter((gateId) => selectableGateIds.has(gateId))
      : requiredGateIds;
  const selectedGateIdSet = new Set(selectedGateIds);
  const selectedTransitionGuards = selectedGateIds.filter((gateId) => transitionGuardIds.has(gateId));
  const missingRequired = requiredGateIds.filter((gateId) => !selectedGateIdSet.has(gateId));
  if (missingRequired.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: required gates not selected as passed: ${missingRequired.join(", ")}.\n`
    );
    return 1;
  }

  const mandatory = new Set(schema.mandatoryDelegations);
  for (const agent of args.waiveDelegations) {
    if (!mandatory.has(agent)) {
      io.stderr.write(
        `cclaw internal advance-stage: cannot waive "${agent}" for stage "${args.stage}" (not mandatory).\n`
      );
      return 1;
    }
  }

  if (args.waiveDelegations.length > 0) {
    const waiverReason = args.waiverReason && args.waiverReason.length > 0
      ? args.waiverReason
      : "manual_waiver";
    for (const agent of args.waiveDelegations) {
      await appendDelegation(projectRoot, {
        stage: args.stage,
        agent,
        mode: "mandatory",
        status: "waived",
        waiverReason,
        fulfillmentMode: "role-switch",
        ts: new Date().toISOString()
      });
    }
  }

  await hydrateReviewLoopEvidenceFromArtifact(
    projectRoot,
    args.stage,
    flowState.track,
    selectedGateIds,
    args.evidenceByGate
  );

  const catalog = flowState.stageGateCatalog[args.stage];
  const nextPassed = unique([...catalog.passed, ...selectedGateIds]).filter((gateId) =>
    allowedGateIds.has(gateId)
  );
  const nextPassedSet = new Set(nextPassed);
  const nextBlocked = unique(catalog.blocked.filter((gateId) => !nextPassedSet.has(gateId))).filter(
    (gateId) => allowedGateIds.has(gateId)
  );
  const conditional = new Set(catalog.conditional);
  const nextTriggered = unique([
    ...catalog.triggered.filter((gateId) => conditional.has(gateId)),
    ...nextPassed.filter((gateId) => conditional.has(gateId)),
    ...nextBlocked.filter((gateId) => conditional.has(gateId))
  ]);
  const guardEvidenceGateIds = unique([...nextPassed, ...selectedTransitionGuards]);
  const missingGuardEvidence = guardEvidenceGateIds.filter((gateId) => {
    const existing = flowState.guardEvidence[gateId];
    if (typeof existing === "string" && existing.trim().length > 0) {
      return false;
    }
    const provided = args.evidenceByGate[gateId];
    return !(typeof provided === "string" && provided.trim().length > 0);
  });
  if (missingGuardEvidence.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: missing --evidence-json entries for passed gates: ${missingGuardEvidence.join(", ")}.\n`
    );
    return 1;
  }
  const malformedGateEvidence = nextPassed.flatMap((gateId) => {
    const provided = args.evidenceByGate[gateId];
    const existing = flowState.guardEvidence[gateId];
    const effectiveEvidence =
      typeof provided === "string" && provided.trim().length > 0
        ? provided
        : typeof existing === "string" && existing.trim().length > 0
          ? existing
          : "";
    const issue = validateGateEvidenceShape(args.stage, gateId, effectiveEvidence);
    return issue ? [`${gateId}: ${issue}${reviewLoopArtifactFixHint(args.stage, gateId)}`] : [];
  });
  if (malformedGateEvidence.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: gate evidence format check failed: ${malformedGateEvidence.join(" | ")}.\n`
    );
    return 1;
  }
  const nextGuardEvidence: Record<string, string> = { ...flowState.guardEvidence };
  for (const gateId of guardEvidenceGateIds) {
    const provided = args.evidenceByGate[gateId];
    if (typeof provided === "string" && provided.trim().length > 0) {
      nextGuardEvidence[gateId] = provided.trim();
    }
  }
  await ensureProactiveDelegationTrace(projectRoot, args.stage);

  const nextStageCatalog: StageGateState = {
    required: [...catalog.required],
    recommended: [...catalog.recommended],
    conditional: [...catalog.conditional],
    triggered: nextTriggered,
    passed: nextPassed,
    blocked: nextBlocked
  };
  const candidateState: FlowState = {
    ...flowState,
    guardEvidence: nextGuardEvidence,
    stageGateCatalog: {
      ...flowState.stageGateCatalog,
      [args.stage]: nextStageCatalog
    }
  };

  const validation = await buildValidationReport(projectRoot, candidateState);
  if (!validation.ok) {
    if (args.json) {
      io.stdout.write(`${JSON.stringify({
        ok: false,
        command: "advance-stage",
        stage: args.stage,
        kind: "validation-failed",
        delegation: validation.delegation,
        gates: validation.gates,
        completedStages: validation.completedStages,
        nextActions: [
          ...(validation.delegation.missing.length > 0
            ? [`Complete or waive mandatory delegation(s): ${validation.delegation.missing.join(", ")}.`]
            : []),
          ...(validation.delegation.missingEvidence.length > 0
            ? ["Add evidenceRefs for role-switch delegation completion or use an explicit waiver reason."]
            : []),
          ...(validation.gates.issues.length > 0
            ? ["Fix the artifact/gate issue shown in gates.issues, then rerun stage-complete."]
            : []),
          ...(validation.completedStages.issues.length > 0
            ? ["Repair previously completed stage gate closure before advancing."]
            : [])
        ]
      })}\n`);
    }
    io.stderr.write(
      `cclaw internal advance-stage: validation failed for stage "${args.stage}".\n`
    );
    if (validation.delegation.missing.length > 0) {
      io.stderr.write(`- missing delegations: ${validation.delegation.missing.join(", ")}\n`);
      io.stderr.write(
        `  next action: complete the delegation, or rerun with --waive-delegation=${validation.delegation.missing.join(",")} --waiver-reason="<why safe>".\n`
      );
    }
    if (validation.delegation.missingEvidence.length > 0) {
      io.stderr.write(
        `- role-switch evidence missing: ${validation.delegation.missingEvidence.join(", ")}\n`
      );
    }
    if (validation.gates.issues.length > 0) {
      io.stderr.write(`- gate issues: ${validation.gates.issues.join(" | ")}\n`);
    }
    if (validation.completedStages.issues.length > 0) {
      io.stderr.write(
        `- completed-stage closure issues: ${validation.completedStages.issues.join(" | ")}\n`
      );
    }
    return 1;
  }

  const learningsHarvest = await harvestStageLearnings(
    projectRoot,
    args.stage,
    flowState.track
  );
  if (!learningsHarvest.ok) {
    io.stderr.write(
      `cclaw internal advance-stage: learnings harvest failed for "${schema.artifactFile}". ${learningsHarvest.details}\n`
    );
    return 1;
  }

  const satisfiedGuards = new Set<string>([...nextPassed, ...selectedTransitionGuards]);
  const successor = resolveSuccessorTransition(
    args.stage,
    flowState.track,
    transitionTargets,
    satisfiedGuards,
    new Set(selectedTransitionGuards)
  );
  const completedStages = flowState.completedStages.includes(args.stage)
    ? [...flowState.completedStages]
    : [...flowState.completedStages, args.stage];
  const finalState: FlowState = {
    ...candidateState,
    completedStages,
    currentStage: successor ?? args.stage
  };

  await writeFlowState(projectRoot, finalState);

  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: true,
      command: "advance-stage",
      stage: args.stage,
      nextStage: successor,
      currentStage: finalState.currentStage,
      completedStages: finalState.completedStages,
      learnings: {
        parsed: learningsHarvest.parsedEntries,
        appended: learningsHarvest.appendedEntries,
        skippedDuplicates: learningsHarvest.skippedDuplicates,
        markerWritten: learningsHarvest.markerWritten,
        details: learningsHarvest.details
      }
    }, null, 2)}\n`);
  }
  return 0;
}

async function runVerifyFlowStateDiff(
  projectRoot: string,
  args: VerifyFlowStateDiffArgs,
  io: InternalIo
): Promise<number> {
  let raw = args.afterJson;
  if (!raw && args.afterFile) {
    raw = await fs.readFile(args.afterFile, "utf8");
  }
  if (!raw) {
    io.stderr.write("cclaw internal verify-flow-state-diff: no candidate state payload.\n");
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    io.stderr.write(
      `cclaw internal verify-flow-state-diff: invalid JSON payload (${
        err instanceof Error ? err.message : String(err)
      }).\n`
    );
    return 1;
  }

  const current = await readFlowState(projectRoot);
  const candidate = coerceCandidateFlowState(parsed, current);
  const validation = await buildValidationReport(projectRoot, candidate);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  }
  if (!validation.ok) {
    io.stderr.write(
      `cclaw internal verify-flow-state-diff: candidate state is invalid for stage "${validation.stage}".\n`
    );
  }
  return validation.ok ? 0 : 1;
}

async function runVerifyCurrentState(
  projectRoot: string,
  args: VerifyCurrentStateArgs,
  io: InternalIo
): Promise<number> {
  const current = await readFlowState(projectRoot);
  const validation = await buildValidationReport(projectRoot, current);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  }
  if (!validation.ok) {
    const unmetDelegations =
      validation.delegation.missing.length + validation.delegation.missingEvidence.length;
    const gatesWithoutEvidence = validation.gates.issues.filter((issue) =>
      issue.includes("missing guardEvidence entry")
    ).length;
    io.stderr.write(
      `cclaw: current stage has ${unmetDelegations} unmet mandatory delegations and ${gatesWithoutEvidence} gates without evidence.\n`
    );
    io.stderr.write(
      `cclaw internal verify-current-state: unresolved stage constraints for "${validation.stage}".\n`
    );
  }
  return validation.ok ? 0 : 1;
}

function firstIncompleteStageForTrack(track: FlowTrack, completedStages: FlowStage[]): FlowStage {
  const completed = new Set(completedStages);
  const stages = TRACK_STAGES[track];
  return stages.find((stage) => !completed.has(stage)) ?? stages[stages.length - 1] ?? "brainstorm";
}

async function ensureProactiveDelegationTrace(projectRoot: string, stage: FlowStage): Promise<void> {
  const proactiveRules = stageAutoSubagentDispatch(stage).filter((rule) => rule.mode === "proactive");
  if (proactiveRules.length === 0) return;

  const ledger = await readDelegationLedger(projectRoot);
  const currentRunEntries = ledger.entries.filter((entry) => entry.runId === ledger.runId);
  for (const rule of proactiveRules) {
    const alreadyRecorded = currentRunEntries.some(
      (entry) => entry.stage === stage && entry.agent === rule.agent && entry.mode === "proactive"
    );
    if (alreadyRecorded) continue;
    await appendDelegation(projectRoot, {
      stage,
      agent: rule.agent,
      mode: "proactive",
      status: "waived",
      waiverReason: "auto-recorded: proactive delegation was not explicitly triggered before stage completion",
      conditionTrigger: rule.when,
      skill: rule.skill,
      ts: new Date().toISOString()
    });
  }
}

async function pathExists(projectRoot: string, relPath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(projectRoot, relPath));
    return true;
  } catch {
    return false;
  }
}

async function listExistingFiles(projectRoot: string, relPaths: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const relPath of relPaths) {
    try {
      const stat = await fs.stat(path.join(projectRoot, relPath));
      if (stat.isFile()) matches.push(relPath);
    } catch {
      // continue
    }
  }
  return matches;
}

async function listFilesUnder(projectRoot: string, relDir: string, limit = 20): Promise<string[]> {
  const root = path.join(projectRoot, relDir);
  const out: string[] = [];
  async function walk(absDir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(projectRoot, abs).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return out;
}

async function discoverStartFlowContext(projectRoot: string): Promise<string[]> {
  const lines: string[] = [];

  const seedFiles = (await listFilesUnder(projectRoot, path.join(RUNTIME_ROOT, "seeds"), 10))
    .filter((relPath) => /^\.cclaw\/seeds\/SEED-.*\.md$/u.test(relPath));
  lines.push(
    seedFiles.length > 0
      ? `- Seed shelf scanned: ${seedFiles.join(", ")}.`
      : "- Seed shelf scanned: no `.cclaw/seeds/SEED-*.md` files found."
  );

  const originDirs = ["docs/prd", "docs/rfcs", "docs/adr", "docs/design", "specs", "prd", "rfc", "design"];
  const originRootFiles = ["PRD.md", "SPEC.md", "DESIGN.md", "REQUIREMENTS.md", "ROADMAP.md"];
  const originFiles = [
    ...(await listExistingFiles(projectRoot, originRootFiles)),
    ...(await Promise.all(originDirs.map((dir) => listFilesUnder(projectRoot, dir, 6)))).flat()
  ].slice(0, 20);
  lines.push(
    originFiles.length > 0
      ? `- Origin docs scanned: found ${originFiles.join(", ")}.`
      : "- Origin docs scanned: no PRD/RFC/ADR/design/spec files found in configured locations."
  );

  const stackMarkers = await listExistingFiles(projectRoot, [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    ".python-version",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".gitlab-ci.yml"
  ]);
  if (await pathExists(projectRoot, ".github/workflows")) {
    stackMarkers.push(".github/workflows/");
  }
  lines.push(
    stackMarkers.length > 0
      ? `- Stack markers scanned: found ${stackMarkers.join(", ")}.`
      : "- Stack markers scanned: no root stack markers found."
  );

  return lines;
}

async function appendIdeaArtifact(projectRoot: string, args: StartFlowArgs, previous?: FlowState): Promise<void> {
  const artifactPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "00-idea.md");
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const now = new Date().toISOString();
  if (args.reclassify) {
    const entry = [
      "",
      `Reclassification: ${now}`,
      `- From: ${previous?.track ?? "unknown"}`,
      `- To: ${args.track}`,
      `- Class: ${args.className || "unspecified"}`,
      `- Reason: ${args.reason || "unspecified"}`
    ].join("\n") + "\n";
    await fs.appendFile(artifactPath, entry, "utf8");
    return;
  }
  const discoveredContext = await discoverStartFlowContext(projectRoot);
  const body = [
    "# Idea",
    `Class: ${args.className || "unspecified"}`,
    `Track: ${args.track}${args.reason ? ` (${args.reason})` : ""}`,
    `Stack: ${args.stack || "unknown"}`,
    "",
    "## User prompt",
    args.prompt || "(not provided)",
    "",
    "## Discovered context",
    ...discoveredContext
  ].join("\n") + "\n";
  await fs.writeFile(artifactPath, body, "utf8");
}

async function runStartFlow(
  projectRoot: string,
  args: StartFlowArgs,
  io: InternalIo
): Promise<number> {
  const current = await readFlowState(projectRoot);
  const hasProgress = current.completedStages.length > 0;
  if (!args.reclassify && hasProgress && !args.forceReset) {
    io.stderr.write(
      "cclaw internal start-flow: refusing to reset an active flow with completed stages without --force-reset. Ask the user before resetting.\n"
    );
    return 1;
  }

  let nextState: FlowState;
  if (args.reclassify) {
    const completedInNewTrack = current.completedStages.filter((stage) =>
      TRACK_STAGES[args.track].includes(stage)
    );
    const fresh = createInitialFlowState({ activeRunId: current.activeRunId, track: args.track });
    nextState = {
      ...fresh,
      completedStages: completedInNewTrack,
      currentStage: firstIncompleteStageForTrack(args.track, completedInNewTrack),
      rewinds: current.rewinds,
      staleStages: current.staleStages
    };
  } else {
    nextState = createInitialFlowState({ track: args.track });
  }

  await writeFlowState(projectRoot, nextState, { allowReset: true });
  await appendIdeaArtifact(projectRoot, args, current);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: true,
      command: "start-flow",
      reclassify: args.reclassify,
      track: nextState.track,
      currentStage: nextState.currentStage,
      skippedStages: nextState.skippedStages,
      activeRunId: nextState.activeRunId
    }, null, 2)}\n`);
  }
  return 0;
}

async function runHookCommand(
  projectRoot: string,
  args: HookArgs,
  io: InternalIo
): Promise<number> {
  const runHookPath = path.join(projectRoot, RUNTIME_ROOT, "hooks", "run-hook.mjs");
  try {
    await fs.access(runHookPath);
  } catch {
    io.stderr.write(
      `cclaw internal hook: missing hook runtime at ${runHookPath}. Run \`cclaw sync\` first.\n`
    );
    return 1;
  }

  return await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [runHookPath, args.hookName], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      io.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      io.stderr.write(chunk);
    });
    child.on("error", (err) => {
      io.stderr.write(
        `cclaw internal hook: failed to launch runtime (${err instanceof Error ? err.message : String(err)}).\n`
      );
      resolve(1);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        io.stderr.write(`cclaw internal hook: runtime terminated by signal ${signal}.\n`);
        resolve(1);
        return;
      }
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

export async function runInternalCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const [subcommand, ...tokens] = argv;
  if (!subcommand) {
    io.stderr.write(
      "cclaw internal requires a subcommand: advance-stage | start-flow | verify-flow-state-diff | verify-current-state | envelope-validate | tdd-red-evidence | tdd-loop-status | compound-readiness | hook-manifest | hook\n"
    );
    return 1;
  }

  try {
    if (subcommand === "advance-stage") {
      return await runAdvanceStage(projectRoot, parseAdvanceStageArgs(tokens), io);
    }
    if (subcommand === "start-flow") {
      return await runStartFlow(projectRoot, parseStartFlowArgs(tokens), io);
    }
    if (subcommand === "verify-flow-state-diff") {
      return await runVerifyFlowStateDiff(projectRoot, parseVerifyFlowStateDiffArgs(tokens), io);
    }
    if (subcommand === "verify-current-state") {
      return await runVerifyCurrentState(projectRoot, parseVerifyCurrentStateArgs(tokens), io);
    }
    if (subcommand === "envelope-validate") {
      return await runEnvelopeValidateCommand(projectRoot, tokens, io);
    }
    if (subcommand === "tdd-red-evidence") {
      return await runTddRedEvidenceCommand(projectRoot, tokens, io);
    }
    if (subcommand === "tdd-loop-status") {
      return await runTddLoopStatusCommand(projectRoot, tokens, io);
    }
    if (subcommand === "compound-readiness") {
      return await runCompoundReadinessCommand(projectRoot, tokens, io);
    }
    if (subcommand === "hook-manifest") {
      return await runHookManifestCommand(projectRoot, tokens, io);
    }
    if (subcommand === "hook") {
      return await runHookCommand(projectRoot, parseHookArgs(tokens), io);
    }
    io.stderr.write(
      `Unknown internal subcommand: ${subcommand}. Expected advance-stage | start-flow | verify-flow-state-diff | verify-current-state | envelope-validate | tdd-red-evidence | tdd-loop-status | compound-readiness | hook-manifest | hook\n`
    );
    return 1;
  } catch (err) {
    io.stderr.write(
      `cclaw internal ${subcommand} failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
}
