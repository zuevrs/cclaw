/**
 * Slice-ID helpers.
 *
 * 7.6.0 — relaxed strict `/^S-\d+$/` to allow lettered sub-slices
 * (`S-36a`, `S-36b`, …) so plan amendments can insert work between
 * existing numeric slices without renumbering.
 *
 * Canonical shape: `S-<integer>(<lowercase-letter>[<lowercase-or-digit>...])?`
 *
 * Sort order (used everywhere we list slice ids):
 *   1. numeric chunk ascending
 *   2. lexical suffix ascending (no suffix sorts before any suffix)
 *
 * So: `S-1 < S-2 < S-10 < S-36 < S-36a < S-36b < S-37`.
 *
 * Surface:
 *   - `SLICE_ID_PATTERN`   — anchored regex source string for embedding
 *   - `SLICE_ID_REGEX`     — anchored RegExp for tests
 *   - `parseSliceId`       — strict parse → `{ numeric, suffix }` or null
 *   - `isSliceId`          — boolean shape check
 *   - `compareSliceIds`    — sort comparator
 *   - `sortSliceIds`       — convenience wrapper around `compareSliceIds`
 */

/** Anchored, case-insensitive regex source for slice ids. */
export const SLICE_ID_PATTERN = "^S-(\\d+)([a-z][a-z0-9]*)?$";

/** Anchored, case-insensitive RegExp instance for slice ids. */
export const SLICE_ID_REGEX = new RegExp(SLICE_ID_PATTERN, "iu");

export interface ParsedSliceId {
  /** Canonical normalized form, e.g. `S-36a`. */
  id: string;
  /** Numeric chunk as a number (e.g. `S-36a` → `36`). */
  numeric: number;
  /** Lowercase suffix (e.g. `S-36a` → `"a"`). Empty string when absent. */
  suffix: string;
}

/**
 * Strict parse of a slice id token.
 *
 * Returns `null` when the input is not a slice id. Whitespace and
 * surrounding markdown decorations (backticks, brackets, quotes) are
 * stripped before parsing so callers can pass cells from markdown
 * tables verbatim.
 */
export function parseSliceId(raw: unknown): ParsedSliceId | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.trim().replace(/^[`"'[\]()]+|[`"'[\]()]+$/gu, "");
  const match = SLICE_ID_REGEX.exec(stripped);
  if (!match) return null;
  const numericPart = match[1] ?? "";
  const suffixPart = (match[2] ?? "").toLowerCase();
  const numeric = Number(numericPart);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null;
  const id = suffixPart.length > 0 ? `S-${numericPart}${suffixPart}` : `S-${numericPart}`;
  return { id, numeric, suffix: suffixPart };
}

/**
 * Boolean shape check. Lowercase-or-uppercase `S-` prefix accepted; the
 * canonical form is uppercase.
 */
export function isSliceId(raw: unknown): boolean {
  return parseSliceId(raw) !== null;
}

/**
 * Comparator that orders slice ids by numeric chunk first, then by
 * suffix (no-suffix sorts before any suffix). Non-slice tokens fall
 * back to a stable lexical comparison so callers can pass mixed input
 * without crashing.
 */
export function compareSliceIds(a: string, b: string): number {
  const pa = parseSliceId(a);
  const pb = parseSliceId(b);
  if (pa && pb) {
    if (pa.numeric !== pb.numeric) return pa.numeric - pb.numeric;
    if (pa.suffix === pb.suffix) return 0;
    if (pa.suffix === "") return -1;
    if (pb.suffix === "") return 1;
    return pa.suffix < pb.suffix ? -1 : 1;
  }
  if (pa) return -1;
  if (pb) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Convenience wrapper: returns a new sorted array using `compareSliceIds`. */
export function sortSliceIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareSliceIds);
}
