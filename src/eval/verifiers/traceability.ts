/**
 * Cross-stage traceability verifier: extract a set of IDs from a source
 * fixture (e.g. `D-\d+` decisions declared during scope) and assert every
 * ID appears in the artifact-under-test and/or in other linked fixtures.
 *
 * The verifier is intentionally source-agnostic: the caller passes the
 * primary artifact plus a label → text map for any extra fixtures declared
 * on the case. `source` and entries in `requireIn` are either the string
 * `"self"` (the primary artifact) or labels present in the extras map.
 *
 * Result ids follow `traceability:<source>->:<target>:<reason>` so baselines
 * diff at the per-link granularity. A missing link produces one result with
 * a list of missing IDs in its `details` payload.
 */
import type { TraceabilityExpected, VerifierResult } from "../types.js";
import { splitFrontmatter } from "./structural.js";

export const SELF_LABEL = "self";

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

function compileIdRegex(expected: TraceabilityExpected): RegExp {
  const flags = expected.idFlags ?? "g";
  const normalized = flags.includes("g") ? flags : `${flags}g`;
  try {
    return new RegExp(expected.idPattern, normalized);
  } catch (err) {
    throw new Error(
      `Invalid traceability id_pattern ${JSON.stringify(expected.idPattern)} ` +
        `(flags=${JSON.stringify(normalized)}): ` +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

function bodyOf(text: string): string {
  return splitFrontmatter(text).body;
}

function extractIds(text: string, regex: RegExp): string[] {
  const body = bodyOf(text);
  const found = new Set<string>();
  for (const match of body.matchAll(regex)) {
    found.add(match[0]);
  }
  return [...found].sort();
}

function resolveFixture(
  label: string,
  primary: string,
  extraFixtures: Record<string, string>
): string | undefined {
  if (label === SELF_LABEL) return primary;
  return extraFixtures[label];
}

/**
 * Run traceability checks. Returns `[]` when expectations are undefined.
 * Emits a single "source-missing" result when the declared source fixture
 * has zero IDs (authoring error), and one result per `requireIn` target
 * listing any IDs absent in that fixture.
 */
export function verifyTraceability(
  primaryArtifact: string,
  extraFixtures: Record<string, string>,
  expected: TraceabilityExpected | undefined
): VerifierResult[] {
  if (!expected) return [];
  const regex = compileIdRegex(expected);

  const sourceText = resolveFixture(expected.source, primaryArtifact, extraFixtures);
  if (sourceText === undefined) {
    return [
      result(
        `traceability:source:${expected.source}:missing`,
        false,
        `Traceability source fixture "${expected.source}" not loaded.`,
        { source: expected.source }
      )
    ];
  }

  const sourceIds = extractIds(sourceText, regex);
  if (sourceIds.length === 0) {
    return [
      result(
        `traceability:source:${expected.source}:empty`,
        false,
        `Source "${expected.source}" yielded zero ids for pattern /${expected.idPattern}/.`,
        { source: expected.source, pattern: expected.idPattern }
      )
    ];
  }

  const results: VerifierResult[] = [];
  for (const target of expected.requireIn) {
    const targetText = resolveFixture(target, primaryArtifact, extraFixtures);
    if (targetText === undefined) {
      results.push(
        result(
          `traceability:target:${target}:missing`,
          false,
          `Traceability target fixture "${target}" not loaded.`,
          { target }
        )
      );
      continue;
    }
    const targetBody = bodyOf(targetText);
    const missing = sourceIds.filter((id) => !targetBody.includes(id));
    const ok = missing.length === 0;
    results.push(
      result(
        `traceability:${expected.source}->${target}`,
        ok,
        ok
          ? `Every id (${sourceIds.length}) from "${expected.source}" appears in "${target}".`
          : `Target "${target}" is missing ${missing.length}/${sourceIds.length} id(s): ${missing.join(", ")}.`,
        {
          source: expected.source,
          target,
          sourceIds,
          missing,
          pattern: expected.idPattern
        }
      )
    );
  }
  return results;
}
