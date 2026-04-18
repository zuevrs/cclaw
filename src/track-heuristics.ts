import { FLOW_TRACKS } from "./types.js";
import type { FlowTrack, TrackHeuristicRule, TrackHeuristicsConfig } from "./types.js";

export interface TrackResolution {
  track: FlowTrack;
  reason: string;
  matchedTokens: string[];
}

// Built-in vocabulary per track. Kept in one place so tests, docs, and the
// /cc skill prose can snapshot the exact same strings.
const DEFAULT_RULES: Record<FlowTrack, TrackHeuristicRule> = {
  quick: {
    triggers: [
      "bug",
      "bugfix",
      "fix",
      "hotfix",
      "patch",
      "typo",
      "regression",
      "copy change",
      "rename",
      "bump",
      "upgrade dep",
      "config tweak",
      "docs only",
      "comment",
      "lint",
      "format",
      "small",
      "tiny",
      "one-liner",
      "revert"
    ]
  },
  medium: {
    triggers: [
      "add endpoint",
      "add field",
      "extend existing",
      "wire integration",
      "small migration",
      "new screen following existing pattern"
    ]
  },
  standard: {
    triggers: [
      "new feature",
      "refactor",
      "migration",
      "platform",
      "architecture",
      "schema",
      "integrate",
      "workflow",
      "onboarding"
    ]
  }
} satisfies Record<FlowTrack, TrackHeuristicRule>;

// Fixed evaluation order: narrow-to-broad. Overriding this was never wired
// into runtime, so cclaw stopped offering the knob in v0.38.0.
const EVALUATION_ORDER: readonly FlowTrack[] = ["standard", "medium", "quick"];
const DEFAULT_FALLBACK: FlowTrack = "standard";

function hasToken(promptLower: string, token: string): boolean {
  return promptLower.includes(token.toLowerCase());
}

function matchRule(promptLower: string, rule: TrackHeuristicRule | undefined): string[] {
  if (!rule) return [];
  const matches: string[] = [];
  for (const trigger of rule.triggers ?? []) {
    if (hasToken(promptLower, trigger)) {
      matches.push(trigger);
    }
  }
  return [...new Set(matches)];
}

function isValidTrack(value: string): value is FlowTrack {
  return (FLOW_TRACKS as readonly string[]).includes(value);
}

function mergeRules(
  base: Record<FlowTrack, TrackHeuristicRule>,
  overrides: TrackHeuristicsConfig | undefined
): Record<FlowTrack, TrackHeuristicRule> {
  const merged: Record<FlowTrack, TrackHeuristicRule> = { ...base };
  const over = overrides?.tracks;
  if (!over) return merged;

  for (const track of FLOW_TRACKS) {
    const rule = over[track];
    if (!rule) continue;
    merged[track] = {
      triggers: rule.triggers ?? merged[track].triggers,
      veto: rule.veto ?? merged[track].veto
    };
  }
  return merged;
}

function resolveFallback(config: TrackHeuristicsConfig | undefined): FlowTrack {
  return config?.fallback && isValidTrack(config.fallback) ? config.fallback : DEFAULT_FALLBACK;
}

/**
 * Reference implementation of the track classifier the /cc skill prose
 * describes. Tests pin its behavior so the built-in defaults stay honest.
 * This function is not called from cclaw runtime — `/cc` routing happens in
 * the LLM. If you wire this in later, update README to drop the
 * "advisory" language.
 */
export function resolveTrackFromPrompt(
  prompt: string,
  config: TrackHeuristicsConfig | undefined
): TrackResolution {
  const promptLower = prompt.toLowerCase();
  const rules = mergeRules(DEFAULT_RULES, config);
  const fallback = resolveFallback(config);

  for (const track of EVALUATION_ORDER) {
    const rule = rules[track];
    const vetoes = rule.veto ?? [];
    if (vetoes.some((token) => hasToken(promptLower, token))) {
      continue;
    }
    const matched = matchRule(promptLower, rule);
    if (matched.length > 0) {
      return {
        track,
        reason: `matched ${track} heuristic`,
        matchedTokens: matched
      };
    }
  }

  return {
    track: fallback,
    reason: `no explicit match, fallback=${fallback}`,
    matchedTokens: []
  };
}

export const TRACK_HEURISTICS_DEFAULTS = {
  fallback: DEFAULT_FALLBACK,
  evaluationOrder: EVALUATION_ORDER,
  tracks: DEFAULT_RULES
} as const;
