import { FLOW_TRACKS } from "./types.js";
import type { FlowTrack, TrackHeuristicRule, TrackHeuristicsConfig } from "./types.js";

export interface TrackResolution {
  track: FlowTrack;
  reason: string;
  matchedTokens: string[];
}

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
};

const DEFAULT_PRIORITY: FlowTrack[] = ["standard", "medium", "quick"];
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
  for (const pattern of rule.patterns ?? []) {
    try {
      const regex = new RegExp(pattern, "iu");
      if (regex.test(promptLower)) {
        matches.push(`/${pattern}/`);
      }
    } catch {
      // Ignore invalid custom regex entries; config validation should catch these.
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
      patterns: rule.patterns ?? merged[track].patterns,
      veto: rule.veto ?? merged[track].veto
    };
  }
  return merged;
}

function resolvePriority(config: TrackHeuristicsConfig | undefined): FlowTrack[] {
  const configured = config?.priority ?? [];
  const filtered = configured.filter((track): track is FlowTrack => isValidTrack(track));
  const unique = [...new Set(filtered)];
  if (unique.length === 0) return [...DEFAULT_PRIORITY];

  // Ensure all tracks are still represented in deterministic order.
  for (const track of FLOW_TRACKS) {
    if (!unique.includes(track)) unique.push(track);
  }
  return unique;
}

function resolveFallback(config: TrackHeuristicsConfig | undefined): FlowTrack {
  return config?.fallback && isValidTrack(config.fallback) ? config.fallback : DEFAULT_FALLBACK;
}

export function resolveTrackFromPrompt(
  prompt: string,
  config: TrackHeuristicsConfig | undefined
): TrackResolution {
  const promptLower = prompt.toLowerCase();
  const rules = mergeRules(DEFAULT_RULES, config);
  const priority = resolvePriority(config);
  const fallback = resolveFallback(config);

  for (const track of priority) {
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
  priority: DEFAULT_PRIORITY,
  tracks: DEFAULT_RULES
} as const;
