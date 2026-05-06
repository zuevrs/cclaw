import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { HARNESS_IDS } from "./types.js";
import type {
  CclawConfig,
  ExecutionStrictnessProfile,
  ExecutionTopology,
  FlowTrack,
  HarnessId,
  LanguageRulePack,
  LockfileTwinPolicy,
  PlanMicroTaskPolicy,
  PlanSliceGranularity,
  TddCommitMode,
  TddIsolationMode
} from "./types.js";

const CONFIG_PATH = `${RUNTIME_ROOT}/config.yaml`;
const HARNESS_ID_SET = new Set<string>(HARNESS_IDS);
const ALLOWED_CONFIG_KEYS = new Set<string>([
  "version",
  "flowVersion",
  "harnesses",
  "tdd",
  "execution",
  "plan"
]);
const SUPPORTED_HARNESSES_TEXT = HARNESS_IDS.join(", ");
export const TDD_COMMIT_MODES = [
  "managed-per-slice",
  "agent-required",
  "checkpoint-only",
  "off"
] as const;
const TDD_COMMIT_MODE_SET = new Set<string>(TDD_COMMIT_MODES);
export const DEFAULT_TDD_COMMIT_MODE: TddCommitMode = "managed-per-slice";
export const TDD_ISOLATION_MODES = ["worktree", "in-place", "auto"] as const;
const TDD_ISOLATION_MODE_SET = new Set<string>(TDD_ISOLATION_MODES);
export const DEFAULT_TDD_ISOLATION_MODE: TddIsolationMode = "worktree";
export const DEFAULT_TDD_WORKTREE_ROOT = `${RUNTIME_ROOT}/worktrees`;
export const LOCKFILE_TWIN_POLICIES = ["auto-include", "auto-revert", "strict-fence"] as const;
const LOCKFILE_TWIN_POLICY_SET = new Set<string>(LOCKFILE_TWIN_POLICIES);
export const DEFAULT_LOCKFILE_TWIN_POLICY: LockfileTwinPolicy = "auto-include";
export const EXECUTION_TOPOLOGIES = [
  "auto",
  "inline",
  "single-builder",
  "parallel-builders",
  "strict-micro"
] as const;
const EXECUTION_TOPOLOGY_SET = new Set<string>(EXECUTION_TOPOLOGIES);
export const DEFAULT_EXECUTION_TOPOLOGY: ExecutionTopology = "auto";
export const EXECUTION_STRICTNESS_PROFILES = ["fast", "balanced", "strict"] as const;
const EXECUTION_STRICTNESS_PROFILE_SET = new Set<string>(EXECUTION_STRICTNESS_PROFILES);
export const DEFAULT_EXECUTION_STRICTNESS: ExecutionStrictnessProfile = "balanced";
export const DEFAULT_MAX_BUILDERS = 5;
export const PLAN_SLICE_GRANULARITIES = ["feature-atomic", "strict-micro"] as const;
const PLAN_SLICE_GRANULARITY_SET = new Set<string>(PLAN_SLICE_GRANULARITIES);
export const DEFAULT_PLAN_SLICE_GRANULARITY: PlanSliceGranularity = "feature-atomic";
export const PLAN_MICRO_TASK_POLICIES = ["advisory", "strict"] as const;
const PLAN_MICRO_TASK_POLICY_SET = new Set<string>(PLAN_MICRO_TASK_POLICIES);
export const DEFAULT_PLAN_MICRO_TASK_POLICY: PlanMicroTaskPolicy = "advisory";

// Kept for runtime modules that use these defaults directly.
export const DEFAULT_TDD_TEST_PATH_PATTERNS: readonly string[] = [
  "**/*.test.*",
  "**/tests/**",
  "**/__tests__/**"
];
export const DEFAULT_TDD_TEST_GLOBS: readonly string[] = [...DEFAULT_TDD_TEST_PATH_PATTERNS];
export const DEFAULT_TDD_PRODUCTION_PATH_PATTERNS: readonly string[] = [];
export const DEFAULT_COMPOUND_RECURRENCE_THRESHOLD = 3;
export const DEFAULT_EARLY_LOOP_MAX_ITERATIONS = 3;

export interface ConfigWarningState {
  emitted: Set<string>;
}

export interface ReadConfigOptions {
  warningState?: ConfigWarningState;
}

export function createConfigWarningState(): ConfigWarningState {
  return { emitted: new Set<string>() };
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}

function configFixExample(): string {
  return `harnesses:
  - claude
  - cursor
tdd:
  commitMode: managed-per-slice
  isolationMode: worktree
  worktreeRoot: .cclaw/worktrees
execution:
  topology: auto
  strictness: balanced
  maxBuilders: 5
plan:
  sliceGranularity: feature-atomic
  microTaskPolicy: advisory`;
}

function configValidationError(configFilePath: string, reason: string): InvalidConfigError {
  return new InvalidConfigError(
    `Invalid cclaw config at ${configFilePath}: ${reason}\n` +
      `Supported harnesses: ${SUPPORTED_HARNESSES_TEXT}\n` +
      `Example config:\n${configFixExample()}\n` +
      `After fixing, run: cclaw sync`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_PATH);
}

export function createDefaultConfig(
  harnesses: HarnessId[] = DEFAULT_HARNESSES,
  _defaultTrack: FlowTrack = "standard"
): CclawConfig {
  return {
    version: CCLAW_VERSION,
    flowVersion: FLOW_VERSION,
    harnesses: [...new Set(harnesses)],
    tdd: {
      commitMode: DEFAULT_TDD_COMMIT_MODE,
      isolationMode: DEFAULT_TDD_ISOLATION_MODE,
      worktreeRoot: DEFAULT_TDD_WORKTREE_ROOT,
      lockfileTwinPolicy: DEFAULT_LOCKFILE_TWIN_POLICY
    },
    execution: {
      topology: DEFAULT_EXECUTION_TOPOLOGY,
      strictness: DEFAULT_EXECUTION_STRICTNESS,
      maxBuilders: DEFAULT_MAX_BUILDERS
    },
    plan: {
      sliceGranularity: DEFAULT_PLAN_SLICE_GRANULARITY,
      microTaskPolicy: DEFAULT_PLAN_MICRO_TASK_POLICY
    }
  };
}

export function resolveTddCommitMode(
  config: Pick<CclawConfig, "tdd"> | null | undefined
): TddCommitMode {
  const raw = config?.tdd?.commitMode;
  if (typeof raw === "string" && TDD_COMMIT_MODE_SET.has(raw)) {
    return raw as TddCommitMode;
  }
  return DEFAULT_TDD_COMMIT_MODE;
}

export function resolveTddIsolationMode(
  config: Pick<CclawConfig, "tdd"> | null | undefined
): TddIsolationMode {
  const raw = config?.tdd?.isolationMode;
  if (typeof raw === "string" && TDD_ISOLATION_MODE_SET.has(raw)) {
    return raw as TddIsolationMode;
  }
  return DEFAULT_TDD_ISOLATION_MODE;
}

export function resolveTddWorktreeRoot(
  config: Pick<CclawConfig, "tdd"> | null | undefined
): string {
  const raw = config?.tdd?.worktreeRoot;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return DEFAULT_TDD_WORKTREE_ROOT;
}

export function resolveLockfileTwinPolicy(
  config: Pick<CclawConfig, "tdd"> | null | undefined
): LockfileTwinPolicy {
  const raw = config?.tdd?.lockfileTwinPolicy;
  if (typeof raw === "string" && LOCKFILE_TWIN_POLICY_SET.has(raw)) {
    return raw as LockfileTwinPolicy;
  }
  return DEFAULT_LOCKFILE_TWIN_POLICY;
}

export function resolveExecutionTopology(
  config: Pick<CclawConfig, "execution"> | null | undefined
): ExecutionTopology {
  const raw = config?.execution?.topology;
  if (typeof raw === "string" && EXECUTION_TOPOLOGY_SET.has(raw)) {
    return raw as ExecutionTopology;
  }
  return DEFAULT_EXECUTION_TOPOLOGY;
}

export function resolveExecutionStrictness(
  config: Pick<CclawConfig, "execution"> | null | undefined
): ExecutionStrictnessProfile {
  const raw = config?.execution?.strictness;
  if (typeof raw === "string" && EXECUTION_STRICTNESS_PROFILE_SET.has(raw)) {
    return raw as ExecutionStrictnessProfile;
  }
  return DEFAULT_EXECUTION_STRICTNESS;
}

export function resolveMaxBuilders(
  config: Pick<CclawConfig, "execution"> | null | undefined
): number {
  const raw = config?.execution?.maxBuilders;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  return DEFAULT_MAX_BUILDERS;
}

export function resolvePlanSliceGranularity(
  config: Pick<CclawConfig, "plan"> | null | undefined
): PlanSliceGranularity {
  const raw = config?.plan?.sliceGranularity;
  if (typeof raw === "string" && PLAN_SLICE_GRANULARITY_SET.has(raw)) {
    return raw as PlanSliceGranularity;
  }
  return DEFAULT_PLAN_SLICE_GRANULARITY;
}

export function resolvePlanMicroTaskPolicy(
  config: Pick<CclawConfig, "plan"> | null | undefined
): PlanMicroTaskPolicy {
  const raw = config?.plan?.microTaskPolicy;
  if (typeof raw === "string" && PLAN_MICRO_TASK_POLICY_SET.has(raw)) {
    return raw as PlanMicroTaskPolicy;
  }
  return DEFAULT_PLAN_MICRO_TASK_POLICY;
}

function assertOnlySupportedKeys(parsed: Record<string, unknown>, fullPath: string): void {
  const unknownKeys = Object.keys(parsed).filter((key) => !ALLOWED_CONFIG_KEYS.has(key));
  if (unknownKeys.length === 0) return;
  const keyList = unknownKeys.join(", ");
  throw configValidationError(
    fullPath,
    `key(s) ${keyList} are no longer supported in cclaw 3.0.0; see CHANGELOG.md`
  );
}

export async function detectLanguageRulePacks(_projectRoot: string): Promise<LanguageRulePack[]> {
  // Harness-only config. Language packs are no longer configurable.
  return [];
}

export async function readConfig(
  projectRoot: string,
  _options: ReadConfigOptions = {}
): Promise<CclawConfig> {
  const fullPath = configPath(projectRoot);
  if (!(await exists(fullPath))) {
    return createDefaultConfig();
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = parse(await fs.readFile(fullPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    throw configValidationError(fullPath, `failed to parse YAML (${reason})`);
  }

  if (parsedUnknown !== null && parsedUnknown !== undefined && !isRecord(parsedUnknown)) {
    throw configValidationError(fullPath, "top-level config must be a YAML mapping/object");
  }

  const parsed = (isRecord(parsedUnknown) ? parsedUnknown : {}) as Record<string, unknown>;
  assertOnlySupportedKeys(parsed, fullPath);

  if (
    Object.prototype.hasOwnProperty.call(parsed, "harnesses") &&
    !Array.isArray(parsed.harnesses)
  ) {
    throw configValidationError(fullPath, `"harnesses" must be an array`);
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, "tdd") &&
    !isRecord(parsed.tdd)
  ) {
    throw configValidationError(fullPath, `"tdd" must be an object when provided`);
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, "execution") &&
    !isRecord(parsed.execution)
  ) {
    throw configValidationError(fullPath, `"execution" must be an object when provided`);
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, "plan") &&
    !isRecord(parsed.plan)
  ) {
    throw configValidationError(fullPath, `"plan" must be an object when provided`);
  }

  const rawHarnesses = Array.isArray(parsed.harnesses) ? parsed.harnesses : DEFAULT_HARNESSES;
  const normalizedHarnesses: HarnessId[] = [];
  for (const harness of rawHarnesses) {
    if (typeof harness !== "string" || !HARNESS_ID_SET.has(harness)) {
      throw configValidationError(
        fullPath,
        `unknown harness id "${String(harness)}"`
      );
    }
    if (!normalizedHarnesses.includes(harness as HarnessId)) {
      normalizedHarnesses.push(harness as HarnessId);
    }
  }
  if (normalizedHarnesses.length === 0) {
    throw configValidationError(fullPath, `"harnesses" must include at least one harness`);
  }

  const version =
    typeof parsed.version === "string" && parsed.version.trim().length > 0
      ? parsed.version
      : CCLAW_VERSION;
  const flowVersion =
    typeof parsed.flowVersion === "string" && parsed.flowVersion.trim().length > 0
      ? parsed.flowVersion
      : FLOW_VERSION;
  const parsedTdd = isRecord(parsed.tdd) ? parsed.tdd : {};
  const rawCommitMode = parsedTdd.commitMode;
  const rawIsolationMode = parsedTdd.isolationMode;
  const rawWorktreeRoot = parsedTdd.worktreeRoot;
  const rawLockfileTwinPolicy = parsedTdd.lockfileTwinPolicy;
  const parsedExecution = isRecord(parsed.execution) ? parsed.execution : {};
  const rawExecutionTopology = parsedExecution.topology;
  const rawExecutionStrictness = parsedExecution.strictness;
  const rawMaxBuilders = parsedExecution.maxBuilders;
  const parsedPlan = isRecord(parsed.plan) ? parsed.plan : {};
  const rawPlanSliceGranularity = parsedPlan.sliceGranularity;
  const rawPlanMicroTaskPolicy = parsedPlan.microTaskPolicy;
  if (
    rawCommitMode !== undefined &&
    (typeof rawCommitMode !== "string" || !TDD_COMMIT_MODE_SET.has(rawCommitMode))
  ) {
    throw configValidationError(
      fullPath,
      `"tdd.commitMode" must be one of: ${TDD_COMMIT_MODES.join(", ")}`
    );
  }
  if (
    rawIsolationMode !== undefined &&
    (typeof rawIsolationMode !== "string" || !TDD_ISOLATION_MODE_SET.has(rawIsolationMode))
  ) {
    throw configValidationError(
      fullPath,
      `"tdd.isolationMode" must be one of: ${TDD_ISOLATION_MODES.join(", ")}`
    );
  }
  if (
    rawWorktreeRoot !== undefined &&
    (typeof rawWorktreeRoot !== "string" || rawWorktreeRoot.trim().length === 0)
  ) {
    throw configValidationError(
      fullPath,
      `"tdd.worktreeRoot" must be a non-empty string when provided`
    );
  }
  if (
    rawLockfileTwinPolicy !== undefined &&
    (typeof rawLockfileTwinPolicy !== "string" || !LOCKFILE_TWIN_POLICY_SET.has(rawLockfileTwinPolicy))
  ) {
    throw configValidationError(
      fullPath,
      `"tdd.lockfileTwinPolicy" must be one of: ${LOCKFILE_TWIN_POLICIES.join(", ")}`
    );
  }
  if (
    rawExecutionTopology !== undefined &&
    (typeof rawExecutionTopology !== "string" || !EXECUTION_TOPOLOGY_SET.has(rawExecutionTopology))
  ) {
    throw configValidationError(
      fullPath,
      `"execution.topology" must be one of: ${EXECUTION_TOPOLOGIES.join(", ")}`
    );
  }
  if (
    rawExecutionStrictness !== undefined &&
    (
      typeof rawExecutionStrictness !== "string" ||
      !EXECUTION_STRICTNESS_PROFILE_SET.has(rawExecutionStrictness)
    )
  ) {
    throw configValidationError(
      fullPath,
      `"execution.strictness" must be one of: ${EXECUTION_STRICTNESS_PROFILES.join(", ")}`
    );
  }
  if (
    rawMaxBuilders !== undefined &&
    (!Number.isInteger(rawMaxBuilders) || (rawMaxBuilders as number) < 1)
  ) {
    throw configValidationError(
      fullPath,
      `"execution.maxBuilders" must be an integer >= 1 when provided`
    );
  }
  if (
    rawPlanSliceGranularity !== undefined &&
    (
      typeof rawPlanSliceGranularity !== "string" ||
      !PLAN_SLICE_GRANULARITY_SET.has(rawPlanSliceGranularity)
    )
  ) {
    throw configValidationError(
      fullPath,
      `"plan.sliceGranularity" must be one of: ${PLAN_SLICE_GRANULARITIES.join(", ")}`
    );
  }
  if (
    rawPlanMicroTaskPolicy !== undefined &&
    (
      typeof rawPlanMicroTaskPolicy !== "string" ||
      !PLAN_MICRO_TASK_POLICY_SET.has(rawPlanMicroTaskPolicy)
    )
  ) {
    throw configValidationError(
      fullPath,
      `"plan.microTaskPolicy" must be one of: ${PLAN_MICRO_TASK_POLICIES.join(", ")}`
    );
  }
  const commitMode = typeof rawCommitMode === "string"
    ? rawCommitMode as TddCommitMode
    : DEFAULT_TDD_COMMIT_MODE;
  const isolationMode = typeof rawIsolationMode === "string"
    ? rawIsolationMode as TddIsolationMode
    : DEFAULT_TDD_ISOLATION_MODE;
  const worktreeRoot = typeof rawWorktreeRoot === "string" && rawWorktreeRoot.trim().length > 0
    ? rawWorktreeRoot.trim()
    : DEFAULT_TDD_WORKTREE_ROOT;
  const lockfileTwinPolicy = typeof rawLockfileTwinPolicy === "string"
    ? rawLockfileTwinPolicy as LockfileTwinPolicy
    : DEFAULT_LOCKFILE_TWIN_POLICY;
  const executionTopology = typeof rawExecutionTopology === "string"
    ? rawExecutionTopology as ExecutionTopology
    : DEFAULT_EXECUTION_TOPOLOGY;
  const executionStrictness = typeof rawExecutionStrictness === "string"
    ? rawExecutionStrictness as ExecutionStrictnessProfile
    : DEFAULT_EXECUTION_STRICTNESS;
  const maxBuilders = typeof rawMaxBuilders === "number" &&
    Number.isInteger(rawMaxBuilders) &&
    rawMaxBuilders >= 1
    ? rawMaxBuilders
    : DEFAULT_MAX_BUILDERS;
  const planSliceGranularity = typeof rawPlanSliceGranularity === "string"
    ? rawPlanSliceGranularity as PlanSliceGranularity
    : DEFAULT_PLAN_SLICE_GRANULARITY;
  const planMicroTaskPolicy = typeof rawPlanMicroTaskPolicy === "string"
    ? rawPlanMicroTaskPolicy as PlanMicroTaskPolicy
    : DEFAULT_PLAN_MICRO_TASK_POLICY;

  return {
    version,
    flowVersion,
    harnesses: normalizedHarnesses,
    tdd: {
      commitMode,
      isolationMode,
      worktreeRoot,
      lockfileTwinPolicy
    },
    execution: {
      topology: executionTopology,
      strictness: executionStrictness,
      maxBuilders
    },
    plan: {
      sliceGranularity: planSliceGranularity,
      microTaskPolicy: planMicroTaskPolicy
    }
  };
}

export interface WriteConfigOptions {
  mode?: "full" | "minimal";
  advancedKeysPresent?: ReadonlySet<never>;
}

export async function writeConfig(
  projectRoot: string,
  config: CclawConfig,
  _options: WriteConfigOptions = {}
): Promise<void> {
  const serialisable = {
    version: config.version,
    flowVersion: config.flowVersion,
    harnesses: config.harnesses,
    tdd: {
      commitMode: resolveTddCommitMode(config),
      isolationMode: resolveTddIsolationMode(config),
      worktreeRoot: resolveTddWorktreeRoot(config),
      lockfileTwinPolicy: resolveLockfileTwinPolicy(config)
    },
    execution: {
      topology: resolveExecutionTopology(config),
      strictness: resolveExecutionStrictness(config),
      maxBuilders: resolveMaxBuilders(config)
    },
    plan: {
      sliceGranularity: resolvePlanSliceGranularity(config),
      microTaskPolicy: resolvePlanMicroTaskPolicy(config)
    }
  };
  await writeFileSafe(configPath(projectRoot), stringify(serialisable));
}

export async function detectAdvancedKeys(
  _projectRoot: string
): Promise<ReadonlySet<never>> {
  return new Set<never>();
}
