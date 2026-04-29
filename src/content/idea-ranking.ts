export type IdeaImpact = "high" | "medium" | "low";
export type IdeaEffort = "s" | "m" | "l";
export type IdeaConfidence = "high" | "medium" | "low";

export interface IdeaCandidateEvaluationInput {
  id: string;
  title: string;
  impact: IdeaImpact;
  effort: IdeaEffort;
  confidence: IdeaConfidence;
  rationaleStrength: number;
  counterArgumentStrength: number;
}

export interface IdeaCandidateEvaluation extends IdeaCandidateEvaluationInput {
  disposition: "survivor" | "critiqued-out";
  rankingScore: number;
}

export interface IdeaRankingResult {
  survivors: IdeaCandidateEvaluation[];
  critiquedOut: IdeaCandidateEvaluation[];
  recommendationId: string | null;
}

const IMPACT_POINTS: Record<IdeaImpact, number> = {
  high: 9,
  medium: 6,
  low: 3
};

const EFFORT_COST: Record<IdeaEffort, number> = {
  s: 1,
  m: 2,
  l: 3
};

const CONFIDENCE_MULTIPLIER: Record<IdeaConfidence, number> = {
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

export function scoreIdeaCandidate(
  impact: IdeaImpact,
  effort: IdeaEffort,
  confidence: IdeaConfidence
): number {
  const raw = (IMPACT_POINTS[impact] / EFFORT_COST[effort]) * CONFIDENCE_MULTIPLIER[confidence];
  return Number(raw.toFixed(3));
}

export function evaluateIdeaCandidate(
  input: IdeaCandidateEvaluationInput
): IdeaCandidateEvaluation {
  const disposition = isCritiquedOut(input.rationaleStrength, input.counterArgumentStrength)
    ? "critiqued-out"
    : "survivor";
  return {
    ...input,
    disposition,
    rankingScore: scoreIdeaCandidate(input.impact, input.effort, input.confidence)
  };
}

export function rankIdeaCandidates(
  inputs: readonly IdeaCandidateEvaluationInput[],
  maxSurvivors = 10
): IdeaRankingResult {
  const evaluated = inputs.map(evaluateIdeaCandidate);
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
