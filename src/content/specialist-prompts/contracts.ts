import { POSTURES } from "../../types.js";

/**
 * Single source of truth for cross-prompt contract strings.
 *
 * These sentences are referenced verbatim by multiple specialist prompts.
 * Defining them once — derived from the underlying type where possible —
 * means the prompt text can never drift from the contract or from each
 * other. Interpolate the export into each prompt with `${...}` rather than
 * copy-pasting the literal.
 */

/**
 * Canonical posture enumeration sentence, derived from the {@link POSTURES}
 * tuple in `src/types.ts`. The first posture is the default. Interpolated
 * into every specialist prompt that references postures (architect, builder,
 * reviewer, critic, plan-critic, qa-runner) so adding/renaming/reordering a
 * posture in the type updates every prompt automatically.
 */
export const CANONICAL_POSTURE_LINE = `Postures: ${POSTURES.map((posture, index) =>
  index === 0 ? `\`${posture}\` (default)` : `\`${posture}\``
).join(" | ")}.`;
