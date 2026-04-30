import { SHIP_FINALIZATION_MODES } from "../../constants.js";
import {
  PASS_STATUS_PATTERN,
  TEST_COMMAND_HINT_PATTERN,
  validateTddVerificationEvidence
} from "../../tdd-verification-evidence.js";
import type { FlowStage } from "../../types.js";
import { asRecord } from "./helpers.js";

export const AUTO_REVIEW_LOOP_GATE_BY_STAGE: Partial<Record<FlowStage, string>> = {
  design: "design_architecture_locked"
};

const SHIP_FINALIZATION_MODE_PATTERN =
  new RegExp(`\\b(?:${SHIP_FINALIZATION_MODES.join("|")})\\b`, "u");
const SHIP_FINALIZATION_MODE_HINT = SHIP_FINALIZATION_MODES.join(", ");
const REVIEW_LOOP_STOP_REASONS = new Set([
  "quality_threshold_met",
  "max_iterations_reached",
  "user_opt_out"
]);

export function pickReviewLoopEnvelope(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (!direct) return null;
  if (direct.type === "review-loop") return direct;
  const payload = asRecord(direct.payload);
  if (payload?.type === "review-loop") return payload;
  const nested = asRecord(direct.reviewLoop);
  if (nested?.type === "review-loop") return nested;
  return null;
}

export function validateReviewLoopGateEvidence(stage: "scope" | "design", evidence: string): string | null {
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

export function validateUserApprovalEvidence(evidence: string): string | null {
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

export async function validateGateEvidenceShape(
  projectRoot: string,
  stage: FlowStage,
  gateId: string,
  evidence: string
): Promise<string | null> {
  const normalized = evidence.trim();
  if (stage === "tdd" && gateId === "tdd_verified_before_complete") {
    const result = await validateTddVerificationEvidence(projectRoot, normalized);
    return result.ok ? null : result.issues.join(" ");
  }
  const validator = GATE_EVIDENCE_VALIDATORS[`${stage}:${gateId}`];
  if (!validator) return null;
  return validator(normalized);
}

export function reviewLoopArtifactFixHint(stage: FlowStage, gateId: string): string {
  if (AUTO_REVIEW_LOOP_GATE_BY_STAGE[stage] !== gateId) return "";
  return ` Add a \`## ${stage === "scope" ? "Scope Outside Voice Loop" : "Design Outside Voice Loop"}\` table to the artifact with rows like \`| 1 | 0.80 | 0 |\` plus \`- Stop reason: quality_threshold_met\`, \`- Target score: 0.80\`, and \`- Max iterations: 3\`; then omit this gate from manual evidence so stage-complete can auto-hydrate it.`;
}
