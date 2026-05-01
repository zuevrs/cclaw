import path from "node:path";
import { exists } from "./fs-utils.js";

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

export async function validateTddVerificationEvidence(
  projectRoot: string,
  evidence: string,
  options: TddVerificationEvidenceOptions = {}
): Promise<TddVerificationEvidenceResult> {
  const normalized = evidence.trim();
  const mode: TddVerificationRefMode = "auto";
  const gitPresent = await exists(path.join(projectRoot, ".git"));
  const issues: string[] = [];

  if (options.requireCommand !== false && !TEST_COMMAND_HINT_PATTERN.test(normalized)) {
    issues.push("GREEN repair needed: include the fresh verification command that was run (for example `npm test`, `pytest`, `go test`, or equivalent).");
  }
  if (options.requirePassStatus !== false && !PASS_STATUS_PATTERN.test(normalized)) {
    issues.push("GREEN repair needed: include explicit success status (for example `PASS` or `GREEN`).");
  }

  const hasSha = SHA_WITH_LABEL_PATTERN.test(normalized);
  const hasNoVcs = NO_VCS_ATTESTATION_PATTERN.test(normalized);
  if (mode === "auto" && gitPresent && !hasSha) {
    issues.push("must include a commit SHA token prefixed with `sha` or `commit` (for example `sha: abc1234`).");
  } else if (mode === "auto" && !gitPresent && !hasSha && !hasNoVcs) {
    issues.push("must include either a commit SHA or an explicit no-VCS attestation (for example `no-vcs: project has no .git directory`).");
  } else if (mode === "auto" && !gitPresent && hasNoVcs && !NO_VCS_HASH_PATTERN.test(normalized)) {
    issues.push("NO_VCS_MODE repair needed: include a content/artifact hash for no-VCS TDD evidence (for example `artifact-hash: sha256:<hash>`).");
  }

  return { ok: issues.length === 0, issues, mode, gitPresent };
}
