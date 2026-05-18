/**
 * Assumption-validation lite (v8.85).
 *
 * Closes the v8.80 loop on `plan.md > ## Key assumptions to validate`.
 * The architect's Phase 7.5 authors 2-5 bullets each leading with a
 * stable `KA-N` id (Key Assumption N) and pairing a bet with a
 * validation method + `unvalidated | validated | invalidated` status.
 * The builder's `verify(AC-N): passing` commits MAY carry an optional
 * `validates: KA-N [KA-M ...]` payload in the commit message body when
 * the AC's verification evidence ALSO proves the matching KA bullet's
 * bet. The post-build flow-state validator (this module) reads the
 * commit messages, extracts the payload, and flips the matching KA-N
 * rows in `plan.md` to `Status: validated by <sha>`.
 *
 * Three exports:
 *
 *  - {@link parseValidatesPayload}: given a single commit message,
 *    returns the array of `KA-N` ids the commit claims to validate.
 *    Returns the empty array when the commit subject is not a
 *    `verify(AC-*): passing` subject OR when the body carries no
 *    `validates:` line. Tolerant of trailing whitespace, comma
 *    separators, and case-insensitive `validates:` markers.
 *
 *  - {@link parseAssumptionRows}: given the full `plan.md` body,
 *    extracts the `## Key assumptions to validate` section's rows
 *    as a structured array. Each row carries the KA-N id, the
 *    assumption clause, the validation method, the current status,
 *    and (when status is `validated`) the optional sha citation.
 *    Tolerant of bullets without ids (legacy pre-v8.85 plans) — those
 *    are returned with `id: null` so the reviewer can surface the
 *    gap without crashing.
 *
 *  - {@link flipAssumptionRows}: given `plan.md` body + a list of
 *    `{ kaId, sha }` validations, rewrites the matching KA-N rows to
 *    `Status: validated by <sha>` and returns the updated `plan.md`
 *    body. Rows whose status is already `validated` or `invalidated`
 *    are NOT re-written (preserves the original SHA citation; first
 *    validation wins). Unknown KA-N ids in the validations list are
 *    silently ignored (the reviewer's `assumption-coverage` axis
 *    surfaces unmatched payloads at review time).
 *
 * Pure functions; no disk I/O. The orchestrator wires this module
 * into the ship-stage flow-state validator by reading `plan.md`,
 * parsing the build range's `git log --grep="^verify(AC-"` output for
 * `validates:` payloads, calling {@link flipAssumptionRows}, and
 * writing the result back to `plan.md`. The validator is idempotent
 * — re-running it on an already-flipped plan.md is a no-op.
 */

/**
 * Structured representation of one row in
 * `plan.md > ## Key assumptions to validate`.
 *
 * `id` is `null` on legacy / malformed bullets that lack the `KA-N`
 * leading bold token. The reviewer's `assumption-coverage` axis
 * surfaces those gaps as `key-assumptions-no-id` findings (see
 * plan-critic §6.5) — runtime callers tolerate the null id rather
 * than crash.
 */
export interface AssumptionRow {
  /** `KA-1`, `KA-2`, ..., or `null` on legacy bullets without an id. */
  id: string | null;
  /** the assumption clause (no leading id, no trailing method). */
  assumption: string;
  /** the validation method clause (text after `Validate by:`). */
  validateMethod: string;
  /** `unvalidated` | `validated` | `invalidated` (lowercased). */
  status: AssumptionStatus;
  /**
   * commit SHA cited in the row when `status === "validated"` and the
   * row was flipped by a prior {@link flipAssumptionRows} pass.
   * `null` when status is `unvalidated` / `invalidated` OR when
   * `validated` was set manually without a SHA citation.
   */
  sha: string | null;
  /** whether the row carries the `(high-stakes)` label after the assumption. */
  highStakes: boolean;
  /** the raw bullet line (preserved for round-trip rewriting). */
  raw: string;
}

export type AssumptionStatus =
  | "unvalidated"
  | "validated"
  | "invalidated";

const KA_ID_PATTERN = /^KA-\d+$/u;
const SECTION_HEADING = /^##\s+Key assumptions to validate\s*$/mu;

/**
 * Match a commit subject line that is shaped like
 * `verify(AC-<digits>): passing`. The builder writes one of these per
 * AC after every slice in `plan.md > ## Plan / Slices` has landed.
 * Tolerant of extra whitespace; rejects subjects with anything after
 * `passing` (e.g. `verify(AC-3): passing on staging` is NOT a v8.85
 * verify subject and gets ignored by the validator).
 */
const VERIFY_SUBJECT = /^verify\(AC-\d+\):\s*passing\s*$/mu;

/**
 * Match a `validates:` payload line in a commit message body. The
 * line may sit anywhere after the subject (separated by a blank line
 * or directly following). Tolerant of case, leading whitespace, and
 * comma or space separators inside the value list.
 *
 * Captured group 1 is the raw value string after the colon (the
 * caller splits on whitespace + commas to extract individual ids).
 */
const VALIDATES_LINE = /^[ \t]*validates:[ \t]*([^\r\n]+)$/imu;

/**
 * Match a single bullet inside the `## Key assumptions to validate`
 * section. Tolerant of the v8.85 canonical shape
 * (`- **KA-N** — <assumption>. Validate by: <method>. Status: <s>.`)
 * AND the legacy pre-v8.85 shape (`- **<assumption>** — Validate by:
 * <method>. Status: <s>.`) where the bold token IS the assumption,
 * not a KA-N id. The capture groups expose:
 *
 *   1. bold-token (KA-N id, OR the legacy assumption clause)
 *   2. rest-of-line (everything after the first em-dash separator)
 *
 * The caller then runs a second probe on the bold-token to decide
 * whether the bullet is v8.85-shaped (id captured) or legacy-shaped
 * (assumption captured; id is null).
 */
const BULLET = /^-[ \t]+\*\*([^*]+)\*\*[ \t]*[—-][ \t]*(.+)$/mu;

/**
 * Match the `Status:` clause inside a bullet's tail. Captures the
 * raw value (lowercased + trimmed by the caller). Tolerant of the
 * `Status: validated by <sha>` post-flip shape.
 */
const STATUS_CLAUSE = /\bStatus:\s*([^.]+?)(?:\.|$)/iu;

/**
 * Match the `Validate by:` clause inside a bullet's tail. Captures
 * the method string up to the next sentence boundary.
 */
const VALIDATE_BY_CLAUSE = /\bValidate by:\s*([^.]+?)(?:\.|$)/iu;

/**
 * Match the `(high-stakes)` label inside the assumption clause. The
 * label is optional and may appear anywhere in the assumption text;
 * v8.85 conventionally places it directly after the assumption clause
 * (e.g. `search p95 stays under 200ms (high-stakes)`).
 */
const HIGH_STAKES_LABEL = /\(high-stakes\)/iu;

/**
 * Parse `validates: KA-N [KA-M ...]` ids out of a single commit
 * message. Returns the deduplicated list of KA-N ids the commit
 * claims to validate; returns the empty array when:
 *
 *  - the message's first non-empty line is NOT a
 *    `verify(AC-<digits>): passing` subject (the payload only fires
 *    on verify commits — slice commits with a stray `validates:`
 *    line are ignored), OR
 *  - the body carries no `validates:` line, OR
 *  - every captured token in the `validates:` line fails the
 *    `KA-N` pattern (silent garbage rejection).
 *
 * The function is pure + total: no throws, no I/O. Tolerant of CRLF
 * line endings, leading whitespace inside the payload line, comma
 * separators, and trailing punctuation on individual tokens
 * (`KA-2,` is normalised to `KA-2`).
 *
 * Example:
 *
 * ```ts
 * parseValidatesPayload(
 *   "verify(AC-3): passing\n\nvalidates: KA-2 KA-4\nbench: 142ms"
 * )
 * // → ["KA-2", "KA-4"]
 * ```
 */
export function parseValidatesPayload(commitMessage: string): string[] {
  if (typeof commitMessage !== "string" || commitMessage.length === 0) {
    return [];
  }
  const normalised = commitMessage.replace(/\r\n/gu, "\n");
  const firstLine = normalised.split("\n", 1)[0] ?? "";
  if (!VERIFY_SUBJECT.test(firstLine)) return [];
  const match = VALIDATES_LINE.exec(normalised);
  if (match === null) return [];
  const raw = match[1] ?? "";
  const tokens = raw
    .split(/[\s,]+/u)
    .map((tok) => tok.replace(/[.,;]+$/u, "").trim())
    .filter((tok) => tok.length > 0 && KA_ID_PATTERN.test(tok));
  return Array.from(new Set(tokens));
}

/**
 * Parse the `## Key assumptions to validate` section out of `plan.md`
 * and return the rows as structured records. Returns the empty array
 * when the section is absent OR empty (no bullets between the
 * heading and the next heading / EOF).
 *
 * Tolerant of:
 *
 *  - legacy pre-v8.85 bullets (bold-token is the assumption; `id`
 *    field is `null`),
 *  - the template placeholder bullet (`- **<assumption>** — ...`) —
 *    treated like any other bullet; the caller filters placeholders
 *    by checking whether the assumption text starts with `<`,
 *  - the post-flip `Status: validated by <sha>` shape (sha captured
 *    into the row's `sha` field).
 *
 * Bullets without a `Validate by:` clause OR without a `Status:`
 * clause are still returned, with the missing fields set to empty
 * string ("") or `"unvalidated"` respectively — the caller decides
 * how to surface those gaps.
 */
export function parseAssumptionRows(planMd: string): AssumptionRow[] {
  if (typeof planMd !== "string" || planMd.length === 0) return [];
  const sectionMatch = SECTION_HEADING.exec(planMd);
  if (sectionMatch === null) return [];
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  // The section ends at the next `^## ` heading, or at EOF.
  const tail = planMd.slice(sectionStart);
  const nextHeading = /\n##\s+/u.exec(tail);
  const sectionBody = nextHeading === null ? tail : tail.slice(0, nextHeading.index);
  const rows: AssumptionRow[] = [];
  // Reset the regex state by allocating a fresh RegExp per call —
  // BULLET is declared with the `m` flag so `.exec` scans the body
  // line-by-line; re-allocating keeps the function pure (no shared
  // lastIndex state across callers).
  const bulletScanner = new RegExp(BULLET.source, "gmu");
  let match: RegExpExecArray | null;
  while ((match = bulletScanner.exec(sectionBody)) !== null) {
    const boldToken = (match[1] ?? "").trim();
    const tail = (match[2] ?? "").trim();
    const raw = match[0];
    const isKaId = KA_ID_PATTERN.test(boldToken);
    let id: string | null = null;
    let assumptionPrefix = "";
    if (isKaId) {
      id = boldToken;
    } else {
      // Legacy shape — the bold token is the assumption clause.
      assumptionPrefix = boldToken;
    }
    // Pull `Validate by:` and `Status:` out of the tail.
    const validateMatch = VALIDATE_BY_CLAUSE.exec(tail);
    const statusMatch = STATUS_CLAUSE.exec(tail);
    const validateMethod = validateMatch === null ? "" : (validateMatch[1] ?? "").trim();
    const statusRaw = statusMatch === null ? "" : (statusMatch[1] ?? "").trim().toLowerCase();
    let status: AssumptionStatus = "unvalidated";
    let sha: string | null = null;
    if (statusRaw.startsWith("validated")) {
      status = "validated";
      // Match `validated by <sha>` — sha is a hex-like token of >=4
      // chars. Tolerant of `validated by abc123` / `validated by
      // abc123de`.
      const shaMatch = /validated\s+by\s+([0-9a-f]{4,40})/iu.exec(statusRaw);
      if (shaMatch !== null) {
        sha = (shaMatch[1] ?? "").trim();
      }
    } else if (statusRaw.startsWith("invalidated")) {
      status = "invalidated";
    } else {
      status = "unvalidated";
    }
    // Pull the assumption text out of the tail when the row is
    // v8.85-shaped (bold token = KA-N id). The assumption is the
    // text up to the first `Validate by:` clause; tolerant of `—`
    // or `-` separators.
    let assumption: string;
    if (isKaId) {
      const cutIdx = validateMatch === null ? tail.length : validateMatch.index;
      assumption = tail
        .slice(0, cutIdx)
        .replace(/^[—\-\s.]+/u, "")
        .replace(/[.\s]+$/u, "")
        .trim();
    } else {
      // Legacy — the bold token already carries the assumption.
      assumption = assumptionPrefix.trim();
    }
    const highStakes = HIGH_STAKES_LABEL.test(assumption);
    rows.push({
      id,
      assumption,
      validateMethod,
      status,
      sha,
      highStakes,
      raw
    });
  }
  return rows;
}

/**
 * Per-commit validation record. Each entry pairs a single KA-N id
 * with the SHA of the `verify(AC-N): passing` commit that carried
 * the matching `validates:` payload. The orchestrator builds the
 * array by iterating the build-range git log and collecting one
 * record per (sha, ka-id) pair.
 */
export interface AssumptionValidation {
  kaId: string;
  sha: string;
}

/**
 * Rewrite the `## Key assumptions to validate` section of `plan.md`
 * so every KA-N row referenced by an {@link AssumptionValidation}
 * record flips to `Status: validated by <sha>`. Returns the updated
 * `plan.md` body string; the input is treated as immutable.
 *
 * Rules:
 *
 *  - Rows whose current status is `validated` or `invalidated` are
 *    NEVER re-written — the first validation wins, and an
 *    invalidation manually authored by the reviewer / critic must
 *    not be silently overridden by a later builder commit.
 *  - Unknown KA-N ids in the validations list (rows that don't
 *    exist in the plan) are silently ignored. The reviewer's
 *    `assumption-coverage` axis surfaces the gap as a separate
 *    finding at review time.
 *  - Multiple validations for the same KA-N id collapse to the
 *    first one in the input order (deterministic deduplication).
 *
 * The function is pure: no I/O, no global state mutation.
 *
 * Idempotence: re-running this function on its own output is a
 * no-op (the validated rows now match the "already validated" skip
 * rule).
 */
export function flipAssumptionRows(
  planMd: string,
  validations: ReadonlyArray<AssumptionValidation>
): string {
  if (typeof planMd !== "string" || planMd.length === 0) return planMd;
  if (!Array.isArray(validations) || validations.length === 0) return planMd;
  // Build a kaId → sha map; first one wins on duplicates.
  const firstShaByKaId = new Map<string, string>();
  for (const v of validations) {
    if (typeof v?.kaId !== "string" || typeof v?.sha !== "string") continue;
    if (v.kaId.length === 0 || v.sha.length === 0) continue;
    if (!KA_ID_PATTERN.test(v.kaId)) continue;
    if (!firstShaByKaId.has(v.kaId)) firstShaByKaId.set(v.kaId, v.sha);
  }
  if (firstShaByKaId.size === 0) return planMd;
  const rows = parseAssumptionRows(planMd);
  let result = planMd;
  for (const row of rows) {
    if (row.id === null) continue;
    if (row.status === "validated" || row.status === "invalidated") continue;
    const sha = firstShaByKaId.get(row.id);
    if (sha === undefined) continue;
    // Rewrite the row's `Status:` clause. We replace the literal
    // raw bullet text in `result` with the same bullet but with
    // the `Status:` clause re-shaped. The bullet substring is
    // unique inside the section (every bullet starts on its own
    // line; the body is rewritten verbatim).
    const oldRaw = row.raw;
    let newRaw: string;
    const statusMatch = STATUS_CLAUSE.exec(oldRaw);
    if (statusMatch !== null) {
      // The capture group bounds run [match.index, match.index + match[0].length).
      // Restore the trailing delimiter (`.` or empty-at-EOL) verbatim so
      // we don't drop punctuation when rewriting; the regex captures the
      // delimiter implicitly via `(?:\.|$)`, so we recompute it from the
      // matched substring's tail.
      const matched = statusMatch[0];
      const trailingDelim = matched.endsWith(".") ? "." : "";
      newRaw =
        oldRaw.slice(0, statusMatch.index) +
        `Status: validated by ${sha}${trailingDelim}` +
        oldRaw.slice(statusMatch.index + matched.length);
    } else {
      // No `Status:` clause at all — append one. Trim trailing
      // whitespace + period so we don't double-stack punctuation.
      newRaw = `${oldRaw.replace(/[.\s]+$/u, "")}. Status: validated by ${sha}.`;
    }
    if (newRaw !== oldRaw) {
      result = result.replace(oldRaw, newRaw);
    }
  }
  return result;
}

/**
 * Convenience: parse the build-range commit messages and return the
 * deduplicated list of {@link AssumptionValidation} records ready
 * to feed into {@link flipAssumptionRows}.
 *
 * The orchestrator obtains the commit list via
 * `git log --grep="^verify(AC-" --format="%H%n%B%n---END---" <range>`
 * and splits on the `---END---` sentinel, then maps each entry
 * through this helper. The helper does not invoke git itself
 * (keeps the module pure + testable).
 */
export function collectValidations(
  commits: ReadonlyArray<{ sha: string; message: string }>
): AssumptionValidation[] {
  if (!Array.isArray(commits) || commits.length === 0) return [];
  const out: AssumptionValidation[] = [];
  const seen = new Set<string>();
  for (const commit of commits) {
    if (typeof commit?.sha !== "string" || commit.sha.length === 0) continue;
    if (typeof commit?.message !== "string" || commit.message.length === 0) continue;
    const ids = parseValidatesPayload(commit.message);
    for (const kaId of ids) {
      const key = `${kaId}\u0000${commit.sha}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kaId, sha: commit.sha });
    }
  }
  return out;
}

/**
 * Convenience: read the assumption rows in `plan.md` and return the
 * IDs of rows whose status is still `unvalidated` at the time of the
 * call. The ship template's `## Unvalidated assumptions` section is
 * populated from this list (v8.85). Legacy bullets without a KA-N
 * id are NOT returned (the section keys off ids), but they are
 * surfaced separately by the reviewer's `assumption-coverage` axis
 * via the `key-assumptions-no-id` finding class.
 */
export function unvalidatedKaIds(planMd: string): string[] {
  const rows = parseAssumptionRows(planMd);
  return rows
    .filter((row) => row.id !== null && row.status === "unvalidated")
    .map((row) => row.id as string);
}
