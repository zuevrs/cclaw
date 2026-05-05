import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { readConfig, resolveTddCommitMode } from "./config.js";
import { readDelegationLedger, type DelegationEntry } from "./delegation.js";
import { exists } from "./fs-utils.js";

const execFileAsync = promisify(execFile);

export const TEST_COMMAND_HINT_PATTERN = /\b(?:npm test|npm run test(?::[\w:-]+)?|pnpm test|pnpm [\w:-]*test[\w:-]*|yarn test|yarn [\w:-]*test[\w:-]*|bun test|bun run test(?::[\w:-]+)?|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|\.\/gradlew test|dotnet test)\b/iu;
export const SHA_WITH_LABEL_PATTERN = /\b(?:sha|commit)(?:\s*[:=]|\s+)\s*[0-9a-f]{7,40}\b/iu;
export const PASS_STATUS_PATTERN = /\b(?:pass|passed|green|ok)\b/iu;
export const NO_VCS_ATTESTATION_PATTERN = /\b(?:no[-_ ]?vcs|no git|not a git repo|vcs\s*[:=]\s*none)\b/iu;
export const NO_VCS_HASH_PATTERN = /\b(?:content|artifact)[-_ ]?hash\s*[:=]\s*(?:sha256:)?[0-9a-f]{16,64}\b|\bsha256\s*[:=]\s*[0-9a-f]{16,64}\b/iu;

export type TddVerificationRefMode = "auto" | "required" | "disabled";

export interface TddVerificationEvidenceOptions {
  requireCommand?: boolean;
  requirePassStatus?: boolean;
}

export interface TddVerificationEvidenceResult {
  ok: boolean;
  issues: string[];
  mode: TddVerificationRefMode;
  gitPresent: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasRefactorCoverage(entries: DelegationEntry[]): boolean {
  const phases = new Set(
    entries
      .filter((e) => e.status === "completed" && typeof e.phase === "string")
      .map((e) => e.phase as string)
  );
  if (phases.has("refactor") || phases.has("refactor-deferred")) {
    return true;
  }
  const greenWithOutcome = entries.find((entry) =>
    entry.status === "completed" &&
    entry.phase === "green" &&
    entry.refactorOutcome &&
    (entry.refactorOutcome.mode === "inline" || entry.refactorOutcome.mode === "deferred")
  );
  if (!greenWithOutcome?.refactorOutcome) return false;
  if (greenWithOutcome.refactorOutcome.mode === "inline") return true;
  const rationale = greenWithOutcome.refactorOutcome.rationale;
  if (typeof rationale === "string" && rationale.trim().length > 0) return true;
  if (!Array.isArray(greenWithOutcome.evidenceRefs)) return false;
  return greenWithOutcome.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0);
}

function collectClosedSlices(entries: DelegationEntry[], runId: string): string[] {
  const bySlice = new Map<string, Map<string, DelegationEntry[]>>();
  for (const entry of entries) {
    if (entry.runId !== runId) continue;
    if (entry.stage !== "tdd") continue;
    if (entry.status !== "completed") continue;
    if (typeof entry.sliceId !== "string" || entry.sliceId.length === 0) continue;
    if (typeof entry.spanId !== "string" || entry.spanId.length === 0) continue;
    const bySpan = bySlice.get(entry.sliceId) ?? new Map<string, DelegationEntry[]>();
    const rows = bySpan.get(entry.spanId) ?? [];
    rows.push(entry);
    bySpan.set(entry.spanId, rows);
    bySlice.set(entry.sliceId, bySpan);
  }

  const closedSlices = new Set<string>();
  for (const [sliceId, bySpan] of bySlice.entries()) {
    for (const rows of bySpan.values()) {
      const phases = new Set(
        rows
          .filter((row) => row.status === "completed" && typeof row.phase === "string")
          .map((row) => row.phase as string)
      );
      const hasRed = phases.has("red");
      const hasGreen = phases.has("green");
      const hasDoc = phases.has("doc");
      if (hasRed && hasGreen && hasDoc && hasRefactorCoverage(rows)) {
        closedSlices.add(sliceId);
        break;
      }
    }
  }
  return [...closedSlices].sort();
}

async function hasManagedCommitForSlice(projectRoot: string, sliceId: string): Promise<boolean> {
  const grep = `^${escapeRegex(sliceId)}/`;
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--format=%s%n%b", "--grep", grep],
    { cwd: projectRoot }
  );
  return stdout.trim().length > 0;
}

export async function validateTddVerificationEvidence(
  projectRoot: string,
  evidence: string,
  options: TddVerificationEvidenceOptions = {}
): Promise<TddVerificationEvidenceResult> {
  const normalized = evidence.trim();
  const config = await readConfig(projectRoot).catch(() => null);
  const commitMode = resolveTddCommitMode(config);
  const mode: TddVerificationRefMode = commitMode === "off" ? "disabled" : "auto";
  const gitPresent = await exists(path.join(projectRoot, ".git"));
  const issues: string[] = [];

  if (options.requireCommand !== false && !TEST_COMMAND_HINT_PATTERN.test(normalized)) {
    issues.push("GREEN repair needed: include the fresh verification command that was run (for example `npm test`, `pytest`, `go test`, or equivalent).");
  }
  if (options.requirePassStatus !== false && !PASS_STATUS_PATTERN.test(normalized)) {
    issues.push("GREEN repair needed: include explicit success status (for example `PASS` or `GREEN`).");
  }

  if (mode !== "disabled" && commitMode === "managed-per-slice" && gitPresent) {
    const ledger = await readDelegationLedger(projectRoot).catch(() => null);
    if (ledger && typeof ledger.runId === "string" && ledger.runId.length > 0) {
      const closedSlices = collectClosedSlices(ledger.entries, ledger.runId);
      const missing: string[] = [];
      for (const sliceId of closedSlices) {
        const hasCommit = await hasManagedCommitForSlice(projectRoot, sliceId).catch(() => false);
        if (!hasCommit) {
          missing.push(sliceId);
        }
      }
      if (missing.length > 0) {
        issues.push(
          `managed-per-slice commit check failed: missing git commit(s) for closed slice(s): ${missing.join(", ")}.`
        );
      }
    }
  } else if (mode === "auto") {
    const hasSha = SHA_WITH_LABEL_PATTERN.test(normalized);
    const hasNoVcs = NO_VCS_ATTESTATION_PATTERN.test(normalized);
    if (gitPresent && !hasSha) {
      issues.push("must include a commit SHA token prefixed with `sha` or `commit` (for example `sha: abc1234`).");
    } else if (!gitPresent && !hasSha && !hasNoVcs) {
      issues.push("must include either a commit SHA or an explicit no-VCS attestation (for example `no-vcs: project has no .git directory`).");
    } else if (!gitPresent && hasNoVcs && !NO_VCS_HASH_PATTERN.test(normalized)) {
      issues.push("NO_VCS_MODE repair needed: include a content/artifact hash for no-VCS TDD evidence (for example `artifact-hash: sha256:<hash>`).");
    }
  }

  return { ok: issues.length === 0, issues, mode, gitPresent };
}
