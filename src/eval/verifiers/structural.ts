/**
 * Structural verifier (Wave 7.1): deterministic, zero-LLM checks against a
 * single markdown artifact. Each structural expectation produces one
 * `VerifierResult` so baselines diff cleanly at the check level rather than
 * lumping everything into a single boolean.
 *
 * Design notes:
 *
 * - All pattern matching is case-insensitive. Authoring a check as
 *   `"Directions"` matches `## Directions` and `### directions-suggested`.
 * - Frontmatter detection is permissive: it must start at byte 0 with `---\n`
 *   and close on a subsequent `---` line. Anything else is treated as "no
 *   frontmatter", which fails every `requiredFrontmatterKeys` entry
 *   deterministically.
 * - `minLines`/`maxLines` intentionally exclude frontmatter so a rewrite that
 *   adds metadata does not accidentally drop the body below the floor.
 * - Scoring: each check scores 0 or 1. The case `passed` becomes the AND of
 *   all individual `ok` flags. This keeps Wave 7.1 deterministic; the 0..1
 *   rubric scale shows up in Wave 7.3 (judge).
 */
import { parse as parseYaml } from "yaml";
import type { StructuralExpected, VerifierResult } from "../types.js";

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /\r?\n---\r?(?:\n|$)/;

export interface ArtifactSplit {
  hasFrontmatter: boolean;
  frontmatterRaw: string;
  frontmatterParsed?: Record<string, unknown>;
  body: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export function splitFrontmatter(artifact: string): ArtifactSplit {
  if (!FRONTMATTER_OPEN.test(artifact)) {
    return { hasFrontmatter: false, frontmatterRaw: "", body: artifact };
  }
  const afterOpen = artifact.replace(FRONTMATTER_OPEN, "");
  const closeMatch = afterOpen.match(FRONTMATTER_CLOSE);
  if (!closeMatch || closeMatch.index === undefined) {
    return { hasFrontmatter: false, frontmatterRaw: "", body: artifact };
  }
  const frontmatterRaw = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  let frontmatterParsed: Record<string, unknown> | undefined;
  try {
    const parsed = parseYaml(frontmatterRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatterParsed = parsed as Record<string, unknown>;
    }
  } catch {
    frontmatterParsed = undefined;
  }
  return {
    hasFrontmatter: true,
    frontmatterRaw,
    frontmatterParsed,
    body
  };
}

function extractHeadingLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trimStart())
    .filter((line) => /^#{1,6}\s+\S/.test(line));
}

function result(
  id: string,
  ok: boolean,
  message: string,
  details?: Record<string, unknown>
): VerifierResult {
  return {
    kind: "structural",
    id,
    ok,
    score: ok ? 1 : 0,
    message,
    ...(details !== undefined ? { details } : {})
  };
}

function checkRequiredSections(sections: string[], body: string): VerifierResult[] {
  const headings = extractHeadingLines(body).map((line) => line.toLowerCase());
  return sections.map((section) => {
    const needle = section.toLowerCase().trim();
    const found = headings.some((heading) => heading.includes(needle));
    return result(
      `structural:section:${slugify(section)}`,
      found,
      found
        ? `Section matching "${section}" present.`
        : `No heading contains "${section}".`,
      { pattern: section, searchedHeadings: headings.length }
    );
  });
}

function checkForbiddenPatterns(patterns: string[], body: string): VerifierResult[] {
  const bodyLower = body.toLowerCase();
  return patterns.map((pattern) => {
    const needle = pattern.toLowerCase();
    const hits = countOccurrences(bodyLower, needle);
    const ok = hits === 0;
    return result(
      `structural:forbidden:${slugify(pattern)}`,
      ok,
      ok
        ? `Pattern "${pattern}" absent (as required).`
        : `Pattern "${pattern}" appears ${hits} time(s); remove.`,
      { pattern, occurrences: hits }
    );
  });
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

function checkLengthBounds(
  expected: StructuralExpected,
  body: string
): VerifierResult[] {
  const results: VerifierResult[] = [];
  const lineCount = body.length === 0 ? 0 : body.split(/\r?\n/).length;
  const charCount = body.length;

  if (expected.minLines !== undefined || expected.maxLines !== undefined) {
    const min = expected.minLines;
    const max = expected.maxLines;
    const withinMin = min === undefined || lineCount >= min;
    const withinMax = max === undefined || lineCount <= max;
    const ok = withinMin && withinMax;
    results.push(
      result(
        "structural:length:lines",
        ok,
        ok
          ? `Body has ${lineCount} line(s), within bounds.`
          : buildOutOfRangeMessage("line", lineCount, min, max),
        { lineCount, minLines: min, maxLines: max }
      )
    );
  }

  if (expected.minChars !== undefined || expected.maxChars !== undefined) {
    const min = expected.minChars;
    const max = expected.maxChars;
    const withinMin = min === undefined || charCount >= min;
    const withinMax = max === undefined || charCount <= max;
    const ok = withinMin && withinMax;
    results.push(
      result(
        "structural:length:chars",
        ok,
        ok
          ? `Body has ${charCount} char(s), within bounds.`
          : buildOutOfRangeMessage("char", charCount, min, max),
        { charCount, minChars: min, maxChars: max }
      )
    );
  }

  return results;
}

function buildOutOfRangeMessage(
  unit: string,
  actual: number,
  min: number | undefined,
  max: number | undefined
): string {
  const lo = min === undefined ? "0" : String(min);
  const hi = max === undefined ? "∞" : String(max);
  return `Body has ${actual} ${unit}(s); expected ${lo}..${hi}.`;
}

function checkFrontmatterKeys(
  keys: string[],
  split: ArtifactSplit
): VerifierResult[] {
  if (!split.hasFrontmatter || !split.frontmatterParsed) {
    return keys.map((key) =>
      result(
        `structural:frontmatter:${slugify(key)}`,
        false,
        `Frontmatter key "${key}" missing (no parseable frontmatter).`,
        { key, frontmatterPresent: split.hasFrontmatter }
      )
    );
  }
  const present = new Set(Object.keys(split.frontmatterParsed));
  return keys.map((key) => {
    const ok = present.has(key);
    return result(
      `structural:frontmatter:${slugify(key)}`,
      ok,
      ok ? `Frontmatter key "${key}" present.` : `Frontmatter key "${key}" missing.`,
      { key }
    );
  });
}

/**
 * Run every configured structural check against the artifact text.
 * Returns [] when `expected` is undefined/empty so the runner can treat
 * "no structural expectations" as "no verifier results" rather than "pass".
 */
export function verifyStructural(
  artifact: string,
  expected: StructuralExpected | undefined
): VerifierResult[] {
  if (!expected) return [];
  const split = splitFrontmatter(artifact);
  const results: VerifierResult[] = [];
  if (expected.requiredSections?.length) {
    results.push(...checkRequiredSections(expected.requiredSections, split.body));
  }
  if (expected.forbiddenPatterns?.length) {
    results.push(...checkForbiddenPatterns(expected.forbiddenPatterns, split.body));
  }
  results.push(...checkLengthBounds(expected, split.body));
  if (expected.requiredFrontmatterKeys?.length) {
    results.push(...checkFrontmatterKeys(expected.requiredFrontmatterKeys, split));
  }
  return results;
}
