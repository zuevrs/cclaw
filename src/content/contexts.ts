export const DEFAULT_CONTEXT_MODE = "default";

/**
 * Valid context mode identifiers used by the session hooks and the
 * `context-engineering` skill. Mode bodies no longer live as separate
 * `.cclaw/contexts/<mode>.md` files — the guidance was merged into the
 * `context-engineering` skill. This list only exists so `doctor` can
 * validate that `state/context-mode.json#activeMode` references a known
 * mode name.
 */
export const AVAILABLE_CONTEXT_MODES = [
  "default",
  "execution",
  "review",
  "incident"
] as const;

/** Legacy alias: kept so existing imports keep typechecking. */
export const CONTEXT_MODES: Record<string, true> = Object.fromEntries(
  AVAILABLE_CONTEXT_MODES.map((mode) => [mode, true])
);

export interface ContextModeState {
  activeMode: string;
  updatedAt: string;
  availableModes: string[];
}

export function createInitialContextModeState(nowIso = new Date().toISOString()): ContextModeState {
  return {
    activeMode: DEFAULT_CONTEXT_MODE,
    updatedAt: nowIso,
    availableModes: [...AVAILABLE_CONTEXT_MODES]
  };
}
