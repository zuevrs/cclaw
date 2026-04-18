/**
 * Rule-based verifier: deterministic, zero-LLM checks that are richer than
 * structural heading/length assertions. Each rule produces exactly one
 * `VerifierResult` so baselines diff at the check level, and authoring a
 * rule sideways in YAML never silently skips.
 *
 * Semantics:
 *
 * - All substring matching is case-insensitive. Regex matching uses the
 *   flags declared on the rule (default `"i"`).
 * - Rules operate on the artifact BODY (frontmatter stripped), mirroring
 *   the structural verifier so min/max counts and length checks agree on
 *   what "body" means.
 * - `uniqueBulletsInSection` scans every section (heading, case-insensitive
 *   substring match) and flags duplicate top-level bullets ("- item"). The
 *   search stops at the next heading of equal or lower depth.
 */
import type { RulesExpected, RuleRegex, VerifierResult } from "../types.js";
import { splitFrontmatter } from "./structural.js";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 64) || "rule"
  );
}

function result(
  id: string,
  ok: boolean,
  message: string,
  details?: Record<string, unknown>
): VerifierResult {
  return {
    kind: "rules",
    id,
    ok,
    score: ok ? 1 : 0,
    message,
    ...(details !== undefined ? { details } : {})
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let index = 0;
  let count = 0;
  while (true) {
    const at = haystack.indexOf(needle, index);
    if (at < 0) return count;
    count += 1;
    index = at + needle.length;
  }
}

function compileRegex(rule: RuleRegex): RegExp {
  const flags = rule.flags ?? "i";
  try {
    return new RegExp(rule.pattern, flags);
  } catch (err) {
    throw new Error(
      `Invalid regex for rule "${rule.description ?? rule.pattern}" ` +
        `(pattern=${JSON.stringify(rule.pattern)}, flags=${JSON.stringify(flags)}): ` +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

function ruleLabel(rule: RuleRegex): string {
  return rule.description?.trim() || rule.pattern;
}

function checkMustContain(needles: string[], body: string): VerifierResult[] {
  const bodyLower = body.toLowerCase();
  return needles.map((needle) => {
    const found = bodyLower.includes(needle.toLowerCase());
    return result(
      `rules:contains:${slugify(needle)}`,
      found,
      found
        ? `Required phrase "${needle}" present.`
        : `Required phrase "${needle}" missing from body.`,
      { phrase: needle }
    );
  });
}

function checkMustNotContain(needles: string[], body: string): VerifierResult[] {
  const bodyLower = body.toLowerCase();
  return needles.map((needle) => {
    const lowered = needle.toLowerCase();
    const occurrences = countOccurrences(bodyLower, lowered);
    const ok = occurrences === 0;
    return result(
      `rules:not-contains:${slugify(needle)}`,
      ok,
      ok
        ? `Forbidden phrase "${needle}" absent (as required).`
        : `Forbidden phrase "${needle}" appears ${occurrences} time(s).`,
      { phrase: needle, occurrences }
    );
  });
}

function checkRegexRequired(rules: RuleRegex[], body: string): VerifierResult[] {
  return rules.map((rule) => {
    const label = ruleLabel(rule);
    const regex = compileRegex(rule);
    const matches = body.match(new RegExp(regex.source, withGlobal(regex.flags)));
    const count = matches ? matches.length : 0;
    const ok = count > 0;
    return result(
      `rules:regex-required:${slugify(label)}`,
      ok,
      ok
        ? `Required pattern /${rule.pattern}/ matched ${count} time(s).`
        : `Required pattern /${rule.pattern}/ did not match.`,
      { pattern: rule.pattern, flags: rule.flags ?? "i", matches: count }
    );
  });
}

function checkRegexForbidden(rules: RuleRegex[], body: string): VerifierResult[] {
  return rules.map((rule) => {
    const label = ruleLabel(rule);
    const regex = compileRegex(rule);
    const matches = body.match(new RegExp(regex.source, withGlobal(regex.flags)));
    const count = matches ? matches.length : 0;
    const ok = count === 0;
    return result(
      `rules:regex-forbidden:${slugify(label)}`,
      ok,
      ok
        ? `Forbidden pattern /${rule.pattern}/ absent.`
        : `Forbidden pattern /${rule.pattern}/ matched ${count} time(s).`,
      { pattern: rule.pattern, flags: rule.flags ?? "i", matches: count }
    );
  });
}

function withGlobal(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}

function checkMinOccurrences(
  bounds: Record<string, number>,
  body: string
): VerifierResult[] {
  const bodyLower = body.toLowerCase();
  return Object.entries(bounds).map(([needle, min]) => {
    const occurrences = countOccurrences(bodyLower, needle.toLowerCase());
    const ok = occurrences >= min;
    return result(
      `rules:min-occurrences:${slugify(needle)}`,
      ok,
      ok
        ? `Phrase "${needle}" appears ${occurrences} time(s) (>= ${min}).`
        : `Phrase "${needle}" appears ${occurrences} time(s); expected at least ${min}.`,
      { phrase: needle, occurrences, min }
    );
  });
}

function checkMaxOccurrences(
  bounds: Record<string, number>,
  body: string
): VerifierResult[] {
  const bodyLower = body.toLowerCase();
  return Object.entries(bounds).map(([needle, max]) => {
    const occurrences = countOccurrences(bodyLower, needle.toLowerCase());
    const ok = occurrences <= max;
    return result(
      `rules:max-occurrences:${slugify(needle)}`,
      ok,
      ok
        ? `Phrase "${needle}" appears ${occurrences} time(s) (<= ${max}).`
        : `Phrase "${needle}" appears ${occurrences} time(s); expected at most ${max}.`,
      { phrase: needle, occurrences, max }
    );
  });
}

interface SectionSlice {
  heading: string;
  depth: number;
  body: string;
}

function sliceBySection(body: string): SectionSlice[] {
  const lines = body.split(/\r?\n/);
  const slices: SectionSlice[] = [];
  let current: { heading: string; depth: number; body: string[] } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimStart();
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) {
      if (current) {
        slices.push({
          heading: current.heading,
          depth: current.depth,
          body: current.body.join("\n")
        });
      }
      current = { heading: match[2]!.trim(), depth: match[1]!.length, body: [] };
    } else if (current) {
      current.body.push(rawLine);
    }
  }
  if (current) {
    slices.push({
      heading: current.heading,
      depth: current.depth,
      body: current.body.join("\n")
    });
  }
  return slices;
}

function extractTopLevelBullets(sectionBody: string): string[] {
  const bullets: string[] = [];
  for (const rawLine of sectionBody.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const leading = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (!leading) continue;
    if (leading[1]!.length > 0) continue;
    bullets.push(leading[2]!.trim());
  }
  return bullets;
}

function checkUniqueBulletsInSection(
  sections: string[],
  body: string
): VerifierResult[] {
  const slices = sliceBySection(body);
  return sections.map((needle) => {
    const lowerNeedle = needle.toLowerCase();
    const slice = slices.find((s) => s.heading.toLowerCase().includes(lowerNeedle));
    if (!slice) {
      return result(
        `rules:unique-in-section:${slugify(needle)}`,
        false,
        `Section matching "${needle}" not found; cannot check uniqueness.`,
        { section: needle, found: false }
      );
    }
    const bullets = extractTopLevelBullets(slice.body);
    const seen = new Map<string, number>();
    for (const bullet of bullets) {
      const key = bullet.toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([entry, count]) => ({ entry, count }));
    const ok = duplicates.length === 0;
    return result(
      `rules:unique-in-section:${slugify(needle)}`,
      ok,
      ok
        ? `Section "${slice.heading}" has ${bullets.length} unique bullet(s).`
        : `Section "${slice.heading}" has duplicate bullet(s): ${duplicates
            .map((d) => `"${d.entry}" x${d.count}`)
            .join(", ")}.`,
      {
        section: slice.heading,
        bullets: bullets.length,
        duplicates
      }
    );
  });
}

/**
 * Run every configured rule check against the artifact body. Returns `[]`
 * when `expected` is undefined or empty so the runner can distinguish
 * "no rules declared" from "all rules passed".
 */
export function verifyRules(
  artifact: string,
  expected: RulesExpected | undefined
): VerifierResult[] {
  if (!expected) return [];
  const split = splitFrontmatter(artifact);
  const body = split.body;
  const results: VerifierResult[] = [];
  if (expected.mustContain?.length) {
    results.push(...checkMustContain(expected.mustContain, body));
  }
  if (expected.mustNotContain?.length) {
    results.push(...checkMustNotContain(expected.mustNotContain, body));
  }
  if (expected.regexRequired?.length) {
    results.push(...checkRegexRequired(expected.regexRequired, body));
  }
  if (expected.regexForbidden?.length) {
    results.push(...checkRegexForbidden(expected.regexForbidden, body));
  }
  if (expected.minOccurrences && Object.keys(expected.minOccurrences).length) {
    results.push(...checkMinOccurrences(expected.minOccurrences, body));
  }
  if (expected.maxOccurrences && Object.keys(expected.maxOccurrences).length) {
    results.push(...checkMaxOccurrences(expected.maxOccurrences, body));
  }
  if (expected.uniqueBulletsInSection?.length) {
    results.push(...checkUniqueBulletsInSection(expected.uniqueBulletsInSection, body));
  }
  return results;
}
