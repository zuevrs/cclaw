/**
 * Shared one-line pointer to `.cclaw/lib/cclaw-ethos.md`
 * (the cross-cutting cclaw principles file written by install).
 *
 * Every specialist prompt imports this single constant so:
 *
 *  - they all cite the same text verbatim (no drift on phrasing
 *    / principle order);
 *  - a future change to the disclaimer (e.g. an extra principle
 *    or a renamed file path) is a one-place edit.
 *
 * The five principles are the canonical cclaw ethos:
 *
 *   1. Boil the Lake          (read enough surface to be honest)
 *   2. Search Before Building (reach for the existing helper first)
 *   3. Surgical Edits         (smallest correct change only)
 *   4. User Sovereignty       (the user is the source of truth)
 *   5. 3 knowledge layers     (ambient rules / on-disk runbooks /
 *                              dispatch envelopes — see `cclaw-ethos.md`)
 *
 * The file the constant points at is written into
 * `.cclaw/lib/cclaw-ethos.md` by `syncCclaw` at install time;
 * cclaw's dispatch envelope prepends the file body verbatim as
 * the "Required ethos read" header so the sub-agent sees it
 * before the specialist prompt body.
 */
export const ETHOS_DISCLAIMER =
  "The five cross-cutting cclaw principles (Boil the Lake / Search Before Building / Surgical Edits / User Sovereignty / 3 knowledge layers) live in `.cclaw/lib/cclaw-ethos.md` — auto-prepended to your dispatch envelope as the Required ethos read; do not restate them here.";
