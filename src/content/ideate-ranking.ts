export type IdeateImpact = "high" | "medium" | "low";
export type IdeateEffort = "s" | "m" | "l";
export type IdeateConfidence = "high" | "medium" | "low";

export interface IdeateCandidateEvaluationInput {
  id: string;
  title: string;
  impact: IdeateImpact;
  effort: IdeateEffort;
  confidence: IdeateConfidence;
  rationaleStrength: number;
  counterArgumentStrength: number;
}

export interface IdeateCandidateEvaluation extends IdeateCandidateEvaluationInput {
  disposition: "survivor" | "critiqued-out";
  rankingScore: number;
}

export interface IdeateRankingResult {
  survivors: IdeateCandidateEvaluation[];
  critiquedOut: IdeateCandidateEvaluation[];
  recommendationId: string | null;
}

const IMPACT_POINTS: Record<IdeateImpact, number> = {
  high: 9,
  medium: 6,
  low: 3
};

const EFFORT_COST: Record<IdeateEffort, number> = {
  s: 1,
  m: 2,
  l: 3
};

const CONFIDENCE_MULTIPLIER: Record<IdeateConfidence, number> = {
  high: 1,
  medium: 0.75,
  low: 0.5
};

function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function isCritiquedOut(
  rationaleStrength: number,
  counterArgumentStrength: number
): boolean {
  return clampStrength(counterArgumentStrength) > clampStrength(rationaleStrength);
}

export function scoreIdeateCandidate(
  impact: IdeateImpact,
  effort: IdeateEffort,
  confidence: IdeateConfidence
): number {
  const raw = (IMPACT_POINTS[impact] / EFFORT_COST[effort]) * CONFIDENCE_MULTIPLIER[confidence];
  return Number(raw.toFixed(3));
}

export function evaluateIdeateCandidate(
  input: IdeateCandidateEvaluationInput
): IdeateCandidateEvaluation {
  const disposition = isCritiquedOut(input.rationaleStrength, input.counterArgumentStrength)
    ? "critiqued-out"
    : "survivor";
  return {
    ...input,
    disposition,
    rankingScore: scoreIdeateCandidate(input.impact, input.effort, input.confidence)
  };
}

export function rankIdeateCandidates(
  inputs: readonly IdeateCandidateEvaluationInput[],
  maxSurvivors = 10
): IdeateRankingResult {
  const evaluated = inputs.map(evaluateIdeateCandidate);
  const survivors = evaluated
    .filter((candidate) => candidate.disposition === "survivor")
    .sort((left, right) => {
      if (right.rankingScore !== left.rankingScore) {
        return right.rankingScore - left.rankingScore;
      }
      if (right.rationaleStrength !== left.rationaleStrength) {
        return right.rationaleStrength - left.rationaleStrength;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, maxSurvivors));
  const survivorIds = new Set(survivors.map((candidate) => candidate.id));
  const critiquedOut = evaluated
    .filter((candidate) => candidate.disposition === "critiqued-out" || !survivorIds.has(candidate.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    survivors,
    critiquedOut,
    recommendationId: survivors[0]?.id ?? null
  };
}
