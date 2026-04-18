/**
 * Helpers that translate between the legacy `Tier A/B/C` naming and the
 * current `EvalMode` identifiers (`fixture` / `agent` / `workflow`).
 *
 * The names we actually carry in reports, config, CLI flags, and verifier
 * messages are the `EvalMode` ones; legacy tier inputs are accepted with a
 * single deprecation warning per process so existing scripts keep working
 * through the 0.28.x line.
 */
import { EVAL_MODES, type EvalMode } from "./types.js";

const LEGACY_TIER_TO_MODE: Record<string, EvalMode> = {
  A: "fixture",
  B: "agent",
  C: "workflow"
};

const MODE_TO_LEGACY_TIER: Record<EvalMode, "A" | "B" | "C"> = {
  fixture: "A",
  agent: "B",
  workflow: "C"
};

const DEPRECATED_NAMES = new Set(Object.keys(LEGACY_TIER_TO_MODE));

let legacyWarningEmitted = false;

/**
 * Reset the per-process "already warned about legacy tier" flag. Used by
 * tests so each test file gets a deterministic warning surface.
 */
export function __resetLegacyWarningForTests(): void {
  legacyWarningEmitted = false;
}

export interface LegacyTierInput {
  source: "cli" | "env" | "config";
  raw: string;
}

/**
 * Normalize a raw string from the CLI / env / config into an `EvalMode`.
 * Accepts both new (`fixture|agent|workflow`) and legacy (`A|B|C`) names.
 * Emits a deprecation warning to stderr at most once per process when a
 * legacy tier name is seen.
 */
export function parseModeInput(
  raw: string,
  input: LegacyTierInput,
  writeWarning: (message: string) => void = defaultWriteWarning
): EvalMode {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `Evaluation mode must be one of: ${EVAL_MODES.join("|")} (or legacy A|B|C).`
    );
  }

  if ((EVAL_MODES as readonly string[]).includes(trimmed)) {
    return trimmed as EvalMode;
  }

  if (DEPRECATED_NAMES.has(trimmed)) {
    const replacement = LEGACY_TIER_TO_MODE[trimmed];
    if (!legacyWarningEmitted) {
      legacyWarningEmitted = true;
      writeWarning(
        `[cclaw] "${input.source}: ${input.raw}" is using the legacy tier name "${trimmed}". ` +
          `Please switch to --mode=${replacement} (legacy --tier=A|B|C will be removed in the next major release).`
      );
    }
    return replacement;
  }

  throw new Error(
    `Evaluation mode must be one of: ${EVAL_MODES.join("|")} (or legacy A|B|C), got: ${raw}`
  );
}

/** @deprecated kept for callers that still need to serialize as legacy. */
export function modeToLegacyTier(mode: EvalMode): "A" | "B" | "C" {
  return MODE_TO_LEGACY_TIER[mode];
}

function defaultWriteWarning(message: string): void {
  process.stderr.write(`${message}\n`);
}
