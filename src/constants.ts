import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  version?: unknown;
}

/**
 * Read `cclaw-cli`'s shipped version from the package.json that lives one
 * directory above the compiled module.
 *
 * Layout in dev:   `<repo>/src/constants.ts`         → `<repo>/package.json`
 * Layout in dist:  `<repo>/dist/constants.js`        → `<repo>/package.json`
 * Layout in npm:   `node_modules/cclaw-cli/dist/...` → `node_modules/cclaw-cli/package.json`
 *
 * `npm pack` always includes `package.json` in the published tarball
 * regardless of the `files` allow-list, so this works at runtime for the
 * published package too. We hard-fail with a clear error if the read goes
 * sideways instead of papering it over with a fake `0.0.0` — a wrong
 * version string lying to the user is worse than a startup crash that
 * surfaces a real packaging bug.
 */
function readCclawVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, "..", "package.json");
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cclaw: failed to read ${pkgPath} for version (${reason})`);
  }
  let parsed: PackageManifest;
  try {
    parsed = JSON.parse(raw) as PackageManifest;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cclaw: failed to parse ${pkgPath} for version (${reason})`);
  }
  const version = parsed.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`cclaw: ${pkgPath} has no string \`version\` field`);
  }
  return version;
}

export const CCLAW_VERSION = readCclawVersion();
export const RUNTIME_ROOT = ".cclaw";

export const STATE_REL_PATH = `${RUNTIME_ROOT}/state`;
export const HOOKS_REL_PATH = `${RUNTIME_ROOT}/hooks`;
export const FLOWS_ROOT = `${RUNTIME_ROOT}/flows`;
export const LIB_ROOT = `${RUNTIME_ROOT}/lib`;

export const FLOW_STATE_REL_PATH = `${STATE_REL_PATH}/flow-state.json`;
/**
 * v8.44 — append-only audit log for write-only triage telemetry.
 *
 * One JSONL line per triage decision capturing fields that used to be
 * stuffed into `flow-state.json > triage` (userOverrode, autoExecuted,
 * iterationOverride). Routing state stays clean; downstream "why did
 * this slug take 7 review iterations / take the fast path / override
 * the orchestrator's recommendation?" audits read the log instead of
 * re-scanning the flow state.
 *
 * Write contract: `appendTriageAudit` in `src/triage-audit.ts`. Reader
 * contract: none — the log is write-only by design (the orchestrator
 * never branches on its contents).
 */
export const TRIAGE_AUDIT_REL_PATH = `${STATE_REL_PATH}/triage-audit.jsonl`;
export const KNOWLEDGE_LOG_REL_PATH = `${RUNTIME_ROOT}/knowledge.jsonl`;
export const IDEAS_REL_PATH = `${RUNTIME_ROOT}/ideas.md`;

export const SHIPPED_DIR_REL_PATH = `${FLOWS_ROOT}/shipped`;
export const CANCELLED_DIR_REL_PATH = `${FLOWS_ROOT}/cancelled`;

export const LIB_DIRS = [
  "agents",
  "skills",
  "templates",
  "runbooks",
  "patterns",
  "research",
  "recovery"
] as const;
