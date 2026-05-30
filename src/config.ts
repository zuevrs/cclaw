import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { HARNESS_IDS, type HarnessId } from "./types.js";

/**
 * Logical model tier for a specialist. The harness maps the tier to a
 * concrete model (or ignores it, falling back to the harness default):
 *   - "fast"     — short-context, quick turn-around.
 *   - "balanced" — default mid-tier.
 *   - "powerful" — deep-context, slow but high-quality.
 */
export type ModelTier = "fast" | "balanced" | "powerful";

/**
 * Optional per-specialist {@link ModelTier} hints for the
 * `.cclaw/config.yaml > modelPreferences` block. Absent fields fall back to
 * the harness default; read by the orchestrator via the dispatch envelope.
 */
export interface ModelPreferences {
  // live specialists (from `SPECIALISTS` in `types.ts`)
  triage?: ModelTier;
  investigator?: ModelTier;
  architect?: ModelTier;
  builder?: ModelTier;
  "plan-critic"?: ModelTier;
  "qa-runner"?: ModelTier;
  reviewer?: ModelTier;
  critic?: ModelTier;

  // read-only research helpers (dispatched, not in `SPECIALISTS`)
  "learnings-research"?: ModelTier;
  "repo-research"?: ModelTier;
}

/**
 * Pre-plan clarify-phase tunables (`.cclaw/config.yaml > clarify`).
 */
export interface ClarifyConfig {
  /**
   * The architect opens its Clarify phase when
   * `triage.ambiguityScore >= this` AND `ceremonyMode != "inline"`.
   * Default `60`; integer in `[0, 100]` (out-of-range falls back to default).
   */
  ambiguity_threshold?: number;
}

/**
 * Critic phase tunables (`.cclaw/config.yaml > critic`).
 */
export interface CriticConfig {
  /**
   * Allow the critic to run a second adversarial pass via a different model
   * (through an available MCP cross-model tool) on high-stakes slugs.
   * Default `false`; gracefully skips with a one-line note when no MCP tool
   * is wired.
   */
  cross_model?: boolean;
  /**
   * Minimum context budget (in chars; ~4 chars/token) the second-opinion
   * model must support before the cross-model dispatch fires without
   * trimming. Over budget: priority-drop trim, then refuse-and-skip if the
   * minimum set still overflows (never blocks ship). Default `16000`.
   */
  cross_model_min_context?: number;
}

export interface CclawConfig {
  version: string;
  flowVersion: "8";
  harnesses: HarnessId[];
  /** Optional per-specialist model-tier hints; absent fields use the harness default. */
  modelPreferences?: ModelPreferences;
  /**
   * How often the compound-refresh sub-step runs over `.cclaw/knowledge.jsonl`
   * (dedup / keep / update / consolidate / replace). Every 5th capture by
   * default; set `0` to disable.
   */
  compoundRefreshEvery?: number;
  /** Minimum knowledge.jsonl entries before compound-refresh fires (default 10). */
  compoundRefreshFloor?: number;
  /**
   * Skip the learnings-capture hard-stop ask — useful for autonomous
   * pipelines that can't surface an interruption.
   */
  captureLearningsBypass?: boolean;
  /** Pre-plan clarify-phase tunables. */
  clarify?: ClarifyConfig;
  /** Critic phase tunables. */
  critic?: CriticConfig;
}

export function createDefaultConfig(harnesses: HarnessId[] = ["cursor"]): CclawConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: "8",
    harnesses
  };
}

export function validateHarnesses(value: string[]): HarnessId[] {
  if (value.length === 0) {
    throw new Error("At least one harness must be selected.");
  }
  const invalid = value.filter((item) => !HARNESS_IDS.includes(item as HarnessId));
  if (invalid.length > 0) {
    throw new Error(`Unknown harnesses: ${invalid.join(", ")}. Supported: ${HARNESS_IDS.join(", ")}`);
  }
  return value as HarnessId[];
}

export function renderConfig(config: CclawConfig): string {
  return YAML.stringify(config);
}

export async function readConfig(projectRoot: string): Promise<CclawConfig | null> {
  const configPath = path.join(projectRoot, RUNTIME_ROOT, "config.yaml");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = YAML.parse(raw) as CclawConfig & { hooks?: unknown };
    if (parsed && typeof parsed === "object" && "hooks" in parsed) delete parsed.hooks;
    return parsed as CclawConfig;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}
