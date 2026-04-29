import fs from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { readConfig } from "../config.js";
import { RUNTIME_ROOT } from "../constants.js";
import {
  classifyCodexHooksFlag,
  codexConfigPath,
  readCodexConfig
} from "../codex-feature-flag.js";
import { exists } from "../fs-utils.js";
import { HARNESS_ADAPTERS, harnessShimFileNames, harnessShimSkillNames } from "../harness-adapters.js";
import { validateHookDocument, type HookSchemaHarness } from "../hook-schema.js";
import {
  MANAGED_RESOURCE_MANIFEST_REL_PATH,
  validateManagedResourceManifest
} from "../managed-resources.js";
import { CorruptFlowStateError, readFlowState } from "../runs.js";
import type { HarnessId } from "../types.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface RuntimeIntegrityArgs {
  json: boolean;
  quiet: boolean;
}

type IntegritySeverity = "error" | "warning";

interface RuntimeIntegrityFinding {
  id: string;
  severity: IntegritySeverity;
  ok: boolean;
  message: string;
  details?: string[];
}

interface RuntimeIntegrityReport {
  ok: boolean;
  generatedAt: string;
  findings: RuntimeIntegrityFinding[];
  summary: {
    errors: number;
    warnings: number;
  };
}

function parseArgs(tokens: string[]): RuntimeIntegrityArgs {
  const args: RuntimeIntegrityArgs = { json: false, quiet: false };
  for (const token of tokens) {
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--quiet") {
      args.quiet = true;
      continue;
    }
    throw new Error(`Unknown runtime-integrity flag: ${token}`);
  }
  return args;
}

function stripJsonCommentsOutsideStrings(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < input.length) {
    const c = input[i]!;
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === "\"") {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (c === "\"") {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    const next = input[i + 1];
    if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i = Math.min(i + 2, input.length);
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function parseJsonWithRecovery(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // Continue with comment/trailing-comma recovery.
  }
  try {
    const normalized = stripJsonCommentsOutsideStrings(raw).replace(/,\s*([}\]])/gu, "$1");
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function okFinding(id: string, message: string): RuntimeIntegrityFinding {
  return {
    id,
    severity: "error",
    ok: true,
    message
  };
}

function errorFinding(
  id: string,
  message: string,
  details?: string[]
): RuntimeIntegrityFinding {
  return {
    id,
    severity: "error",
    ok: false,
    message,
    ...(details && details.length > 0 ? { details } : {})
  };
}

function warningFinding(
  id: string,
  ok: boolean,
  message: string,
  details?: string[]
): RuntimeIntegrityFinding {
  return {
    id,
    severity: "warning",
    ok,
    message,
    ...(details && details.length > 0 ? { details } : {})
  };
}

async function checkStaleSentinel(projectRoot: string): Promise<RuntimeIntegrityFinding> {
  const sentinelPath = path.join(projectRoot, RUNTIME_ROOT, "state", ".init-in-progress");
  if (!(await exists(sentinelPath))) {
    return warningFinding("stale_init_sentinel", true, "No stale init sentinel detected.");
  }
  let startedAt = "unknown time";
  try {
    const raw = await fs.readFile(sentinelPath, "utf8");
    const parsed = JSON.parse(raw) as { startedAt?: unknown } | null;
    if (parsed && typeof parsed.startedAt === "string" && parsed.startedAt.trim().length > 0) {
      startedAt = parsed.startedAt;
    }
  } catch {
    // best-effort parse only
  }
  return warningFinding(
    "stale_init_sentinel",
    false,
    "Detected stale .init-in-progress sentinel from a previous interrupted sync/init run.",
    [`startedAt: ${startedAt}`, `path: ${sentinelPath}`]
  );
}

async function checkFlowState(projectRoot: string): Promise<RuntimeIntegrityFinding> {
  try {
    await readFlowState(projectRoot);
    return okFinding("flow_state", "Flow state is readable.");
  } catch (error) {
    if (error instanceof CorruptFlowStateError) {
      return errorFinding(
        "flow_state",
        "Corrupt flow-state detected.",
        [error.message]
      );
    }
    return errorFinding("flow_state", "Flow-state read failed.", [
      error instanceof Error ? error.message : String(error)
    ]);
  }
}

async function checkManagedManifest(projectRoot: string): Promise<RuntimeIntegrityFinding> {
  const manifestPath = path.join(projectRoot, MANAGED_RESOURCE_MANIFEST_REL_PATH);
  if (!(await exists(manifestPath))) {
    return errorFinding(
      "managed_manifest",
      "Managed resource manifest is missing.",
      [`missing: ${manifestPath}`]
    );
  }

  const rawText = await fs.readFile(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return errorFinding(
      "managed_manifest",
      "Managed resource manifest is not valid JSON.",
      [error instanceof Error ? error.message : String(error)]
    );
  }
  const issues = validateManagedResourceManifest(parsed);
  if (issues.length > 0) {
    const detail = issues.slice(0, 12).map((issue) => {
      const scope = issue.path ?? (issue.index !== undefined ? `resources[${issue.index}]` : "manifest");
      return `${scope}.${issue.field}: ${issue.message}`;
    });
    return errorFinding("managed_manifest", "Managed resource manifest schema validation failed.", detail);
  }
  return okFinding("managed_manifest", "Managed resource manifest is valid.");
}

function hookFilePath(projectRoot: string, harness: HookSchemaHarness): string {
  if (harness === "claude") return path.join(projectRoot, ".claude/hooks/hooks.json");
  if (harness === "cursor") return path.join(projectRoot, ".cursor/hooks.json");
  return path.join(projectRoot, ".codex/hooks.json");
}

async function checkHookDocument(
  projectRoot: string,
  harness: HookSchemaHarness
): Promise<RuntimeIntegrityFinding> {
  const hookPath = hookFilePath(projectRoot, harness);
  if (!(await exists(hookPath))) {
    return errorFinding(
      `hook_document_${harness}`,
      `Hook document is missing for ${harness}.`,
      [`missing: ${hookPath}`]
    );
  }

  const raw = await fs.readFile(hookPath, "utf8");
  const parsed = parseJsonWithRecovery(raw);
  if (parsed === null) {
    return errorFinding(
      `hook_document_${harness}`,
      `Hook document for ${harness} is unparseable JSON.`,
      [`path: ${hookPath}`]
    );
  }
  const validation = validateHookDocument(harness, parsed);
  if (!validation.ok) {
    return errorFinding(
      `hook_document_${harness}`,
      `Hook document for ${harness} is invalid.`,
      validation.errors
    );
  }
  return okFinding(`hook_document_${harness}`, `Hook document for ${harness} is valid.`);
}

async function checkHarnessShims(
  projectRoot: string,
  harnesses: readonly HarnessId[]
): Promise<RuntimeIntegrityFinding[]> {
  const findings: RuntimeIntegrityFinding[] = [];
  const expectedFiles = harnessShimFileNames();
  const expectedSkillFolders = harnessShimSkillNames();
  for (const harness of harnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    const base = path.join(projectRoot, adapter.commandDir);
    const missing: string[] = [];
    for (const fileName of expectedFiles) {
      const target = adapter.shimKind === "skill"
        ? path.join(base, fileName.replace(/\.md$/u, ""), "SKILL.md")
        : path.join(base, fileName);
      if (!(await exists(target))) {
        missing.push(target);
      }
    }
    if (adapter.shimKind === "skill") {
      for (const folder of expectedSkillFolders) {
        const target = path.join(base, folder, "SKILL.md");
        if (!(await exists(target))) {
          missing.push(target);
        }
      }
    }
    if (missing.length > 0) {
      findings.push(
        errorFinding(
          `shim_drift_${harness}`,
          `Harness shim drift detected for ${harness}.`,
          missing
        )
      );
    } else {
      findings.push(okFinding(`shim_drift_${harness}`, `Harness shims for ${harness} are present.`));
    }
  }
  return findings;
}

async function checkCodexHooksFlag(
  harnesses: readonly HarnessId[]
): Promise<RuntimeIntegrityFinding> {
  if (!harnesses.includes("codex")) {
    return warningFinding("codex_hooks_flag", true, "Codex harness is not enabled.");
  }
  const configTomlPath = codexConfigPath();
  let existing: string | null;
  try {
    existing = await readCodexConfig(configTomlPath);
  } catch (error) {
    return warningFinding(
      "codex_hooks_flag",
      false,
      "Could not read Codex config.toml to validate codex_hooks.",
      [error instanceof Error ? error.message : String(error)]
    );
  }

  const state = classifyCodexHooksFlag(existing);
  if (state === "enabled") {
    return warningFinding("codex_hooks_flag", true, "Codex hooks feature flag is enabled.");
  }
  return warningFinding(
    "codex_hooks_flag",
    false,
    "Codex hooks file is present, but [features] codex_hooks is not true in Codex config.",
    [`configPath: ${configTomlPath}`, `state: ${state}`]
  );
}

function buildReport(findings: RuntimeIntegrityFinding[]): RuntimeIntegrityReport {
  const errors = findings.filter((finding) => !finding.ok && finding.severity === "error").length;
  const warnings = findings.filter((finding) => !finding.ok && finding.severity === "warning").length;
  return {
    ok: errors === 0,
    generatedAt: new Date().toISOString(),
    findings,
    summary: { errors, warnings }
  };
}

function writeTextReport(io: InternalIo, report: RuntimeIntegrityReport): void {
  io.stdout.write(`runtime-integrity: ${report.ok ? "ok" : "failed"}\n`);
  io.stdout.write(`errors=${report.summary.errors} warnings=${report.summary.warnings}\n`);
  for (const finding of report.findings) {
    if (finding.ok) continue;
    io.stdout.write(`[${finding.severity}] ${finding.id}: ${finding.message}\n`);
    for (const detail of finding.details ?? []) {
      io.stdout.write(`  - ${detail}\n`);
    }
  }
}

export async function runRuntimeIntegrityCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(argv);
  const config = await readConfig(projectRoot);
  const harnesses = config.harnesses;

  const findings: RuntimeIntegrityFinding[] = [];
  findings.push(await checkStaleSentinel(projectRoot));
  findings.push(await checkFlowState(projectRoot));
  findings.push(await checkManagedManifest(projectRoot));
  findings.push(...await checkHarnessShims(projectRoot, harnesses));
  for (const harness of harnesses) {
    if (harness === "claude" || harness === "cursor" || harness === "codex") {
      findings.push(await checkHookDocument(projectRoot, harness));
    }
  }
  findings.push(await checkCodexHooksFlag(harnesses));

  const report = buildReport(findings);
  if (!args.quiet) {
    if (args.json) {
      io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      writeTextReport(io, report);
    }
  }
  return report.ok ? 0 : 1;
}
