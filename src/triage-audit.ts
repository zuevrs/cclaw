import fs from "node:fs/promises";
import path from "node:path";

import { TRIAGE_AUDIT_REL_PATH } from "./constants.js";
import { ensureDir } from "./fs-utils.js";

/**
 * write-only audit telemetry shape for a single triage
 * decision. Mirrors what used to live on `TriageDecision` as
 * `userOverrode` / `autoExecuted` / `iterationOverride` plus enough
 * routing context that a later "why did this slug …?" audit can answer
 * without re-reading the full flow-state.json.
 *
 * All fields are optional except `decidedAt`, `slug`, and `complexity`
 * — the audit log is best-effort telemetry, and an entry that captures
 * only the canonical triple is still useful. The orchestrator
 * (`start-command.ts`) emits one entry per triage decision and one
 * entry per iteration-override picker firing.
 */
export interface TriageAuditEntry {
  /** ISO timestamp the triage decision was recorded. */
  decidedAt: string;
  /** Flow slug the decision attached to. Never null — every triage opens a flow. */
  slug: string;
  /** Original classification the orchestrator returned BEFORE any user override. */
  complexity: "trivial" | "small-medium" | "large-risky";
  /** Final classification after override (often equal to `complexity`). */
  finalComplexity?: "trivial" | "small-medium" | "large-risky";
  /** Final ceremony mode after override. rename of `acMode`. */
  ceremonyMode?: "inline" | "soft" | "strict";
  /** Did the user override the orchestrator's recommendation at the triage gate? */
  userOverrode?: boolean;
  /** Was this the zero-question fast path (trivial / high-confidence auto-execute)? */
  autoExecuted?: boolean;
  /** Did the user pick `keep-iterating-anyway` at the 5-iteration review cap? */
  iterationOverride?: boolean;
  /** Free-text note pinned by the orchestrator at decision time (skip rationale, etc.). */
  notes?: string;
}

/**
 * Append a single triage audit entry to `.cclaw/state/triage-audit.jsonl`.
 *
 * Idempotent in spirit: callers stamp once per decision, the log is
 * append-only, and re-running install or `/cc` never rewrites prior
 * entries. The directory is created on demand so a brand-new project
 * can call this helper before `ensureRunSystem` finishes.
 *
 * The function never throws on a missing parent directory — it creates
 * the directory chain — but it WILL propagate filesystem errors from
 * the actual write (out-of-disk, permission). Audit-log writes are
 * best-effort telemetry; callers that want to suppress these errors
 * should wrap the call in try/catch and log the failure rather than
 * silently swallowing it. The orchestrator's prompt instructs the
 * agent to perform the write and continue regardless of the outcome.
 *
 * Serialisation contract: one JSON object per line, terminated with a
 * single `\n` (POSIX newline). Fields are emitted in the order
 * declared by `TriageAuditEntry` for grep-friendly diffing; absent
 * fields are omitted entirely (not written as `null`) so the file
 * stays compact.
 */
export async function appendTriageAudit(
  projectRoot: string,
  entry: TriageAuditEntry
): Promise<void> {
  const auditPath = path.join(projectRoot, TRIAGE_AUDIT_REL_PATH);
  await ensureDir(path.dirname(auditPath));
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(auditPath, line, "utf8");
}
