import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { CCLAW_VERSION, DEFAULT_HARNESSES, FLOW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { HARNESS_IDS } from "./types.js";
import type {
  CclawConfig,
  FlowTrack,
  HarnessId,
  LanguageRulePack,
  TddCommitMode,
  TddIsolationMode
} from "./types.js";

const CONFIG_PATH = `${RUNTIME_ROOT}/config.yaml`;
const HARNESS_ID_SET = new Set<string>(HARNESS_IDS);
const ALLOWED_CONFIG_KEYS = new Set<string>(["version", "flowVersion", "harnesses", "tdd"]);
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
  worktreeRoot: .cclaw/worktrees`;
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
      worktreeRoot: DEFAULT_TDD_WORKTREE_ROOT
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
  const commitMode = typeof rawCommitMode === "string"
    ? rawCommitMode as TddCommitMode
    : DEFAULT_TDD_COMMIT_MODE;
  const isolationMode = typeof rawIsolationMode === "string"
    ? rawIsolationMode as TddIsolationMode
    : DEFAULT_TDD_ISOLATION_MODE;
  const worktreeRoot = typeof rawWorktreeRoot === "string" && rawWorktreeRoot.trim().length > 0
    ? rawWorktreeRoot.trim()
    : DEFAULT_TDD_WORKTREE_ROOT;

  return {
    version,
    flowVersion,
    harnesses: normalizedHarnesses,
    tdd: {
      commitMode,
      isolationMode,
      worktreeRoot
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
      worktreeRoot: resolveTddWorktreeRoot(config)
    }
  };
  await writeFileSafe(configPath(projectRoot), stringify(serialisable));
}

export async function detectAdvancedKeys(
  _projectRoot: string
): Promise<ReadonlySet<never>> {
  return new Set<never>();
}
