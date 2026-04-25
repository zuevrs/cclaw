/**
 * hook-inline-snippets.ts
 *
 * Runtime `.cclaw/hooks/run-hook.mjs` is a **standalone Node script** that
 * cannot import from `cclaw-cli` — it must work inside the end-user's
 * project even when the CLI is not installed. Two derived computations,
 * though, must remain 1:1 with the canonical TS implementations:
 *
 * 1. `computeCompoundReadinessInline` mirrors
 *    `src/knowledge-store.ts::computeCompoundReadiness`.
 * 2. `computeRalphLoopStatusInline` mirrors
 *    `src/tdd-cycle.ts::computeRalphLoopStatus`.
 *
 * Previously those bodies lived inline in `src/content/node-hooks.ts` — a
 * ~2000-line file — next to unrelated hook-handler code. Any silent drift
 * only surfaced when someone remembered to update both sides.
 *
 * This module centralizes the inline JavaScript snippets so:
 *
 * - There is exactly **one place** (this file) that holds each inline
 *   JS body.
 * - Each snippet carries an explicit "mirrors X, parity enforced by Y"
 *   header comment and is emitted into `run-hook.mjs` verbatim.
 * - `src/content/node-hooks.ts` only interpolates the snippets, it no
 *   longer owns their source code.
 *
 * Parity with the TypeScript canonical implementations is enforced by
 * `tests/unit/ralph-loop-parity.test.ts`. Any structural change to the
 * canonical TS code MUST:
 *
 * 1. Update the matching snippet below.
 * 2. Re-run `npm test tests/unit/ralph-loop-parity.test.ts`.
 *
 * DO NOT inline tests here — keep the parity check in its dedicated test
 * file.
 */

/**
 * Inline JS helpers used by both compound-readiness and ralph-loop
 * snippets. Kept small and locked: they are shared across the two inline
 * routines and must not grow into a hidden utility namespace.
 *
 * - `normalizeCompoundLastUpdatedAt` produces a stable ISO-8601 UTC
 *   timestamp so the hook-written `compound-readiness.json` is byte-equal
 *   to the CLI-written version for the same input.
 * - `countArchivedRunsInline` counts immediate subdirectories of
 *   `<root>/.cclaw/runs/` so both the hook and the CLI see the same
 *   `archivedRunsCount` for the small-project relaxation.
 * - `formatCompoundReadinessLineInline` mirrors the one-line summary shape
 *   used by `src/internal/compound-readiness.ts::formatCompoundReadinessLine`
 *   so session-start and internal CLI command stay wording-compatible.
 */
export const HOOK_INLINE_SHARED_HELPERS = `
function normalizeCompoundLastUpdatedAt(date) {
  return date.toISOString().replace(/\\.\\d{3}Z$/u, "Z");
}

// Count archived runs as sub-directories under \`.cclaw/runs/\`. Missing
// dir returns 0; unexpected errors return undefined so the caller can
// skip the small-project relaxation rather than guess.
async function countArchivedRunsInline(root) {
  const dir = path.join(root, RUNTIME_ROOT, "runs");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ENOENT") return 0;
    return undefined;
  }
}

function formatCompoundReadinessLineInline(readiness) {
  if (!readiness || typeof readiness !== "object") {
    return "";
  }
  const ready = Array.isArray(readiness.ready) ? readiness.ready : [];
  const readyCount =
    typeof readiness.readyCount === "number" && Number.isFinite(readiness.readyCount)
      ? Math.trunc(readiness.readyCount)
      : ready.length;
  const clusterCount =
    typeof readiness.clusterCount === "number" && Number.isFinite(readiness.clusterCount)
      ? Math.trunc(readiness.clusterCount)
      : 0;
  const threshold =
    typeof readiness.threshold === "number" && Number.isFinite(readiness.threshold)
      ? Math.trunc(readiness.threshold)
      : COMPOUND_RECURRENCE_THRESHOLD;
  if (readyCount === 0) {
    return "Compound readiness: no candidates (clusters=" +
      String(clusterCount) + ", threshold=" + String(threshold) + ")";
  }
  const critical = ready.filter(
    (entry) => entry && typeof entry === "object" && entry.severity === "critical"
  ).length;
  const criticalSuffix = critical > 0 ? " (critical=" + String(critical) + ")" : "";
  return "Compound readiness: clusters=" + String(clusterCount) +
    ", ready=" + String(readyCount) + criticalSuffix;
}
`;

/**
 * Inline mirror of `src/knowledge-store.ts::computeCompoundReadiness`.
 *
 * Parity enforced by
 * `tests/unit/ralph-loop-parity.test.ts::compound-readiness parity`.
 *
 * Signature contract:
 *   async function computeCompoundReadinessInline(root, options) -> CompoundReadiness
 *
 * Accepted options (all optional):
 * - prereadRaw: string | undefined — pre-read `knowledge.jsonl` contents.
 * - threshold: integer >= 1 — default recurrence threshold.
 * - archivedRunsCount: integer >= 0 — enables small-project relaxation.
 * - maxReady: integer >= 1 — cap on returned `ready` cluster count
 *   (default 10).
 *
 * Depends on: `SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD`,
 * `SMALL_PROJECT_RECURRENCE_THRESHOLD`, `COMPOUND_RECURRENCE_THRESHOLD`,
 * and `HOOK_INLINE_SHARED_HELPERS` being in the same runtime scope.
 */
export const COMPOUND_READINESS_INLINE_SOURCE = `
async function computeCompoundReadinessInline(root, options) {
  const filePath = path.join(root, RUNTIME_ROOT, "knowledge.jsonl");
  // Caller may supply pre-read raw to avoid double-reading knowledge.jsonl.
  const raw = typeof (options && options.prereadRaw) === "string"
    ? options.prereadRaw
    : await readTextFile(filePath, "");
  const baseThresholdRaw = options && options.threshold;
  const baseThreshold = Number.isInteger(baseThresholdRaw) && baseThresholdRaw >= 1
    ? baseThresholdRaw
    : COMPOUND_RECURRENCE_THRESHOLD;
  const archivedRunsCount =
    typeof (options && options.archivedRunsCount) === "number" &&
    Number.isFinite(options.archivedRunsCount) &&
    options.archivedRunsCount >= 0
      ? Math.floor(options.archivedRunsCount)
      : undefined;
  const smallProjectRelaxationApplied =
    archivedRunsCount !== undefined &&
    archivedRunsCount < SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD &&
    baseThreshold > SMALL_PROJECT_RECURRENCE_THRESHOLD;
  const threshold = smallProjectRelaxationApplied
    ? SMALL_PROJECT_RECURRENCE_THRESHOLD
    : baseThreshold;
  const maxReady = Number.isInteger(options && options.maxReady) && options.maxReady >= 1
    ? options.maxReady
    : 10;
  const normalize = (value) => String(value == null ? "" : value).trim().replace(/\\s+/gu, " ").toLowerCase();
  const severityWeight = (sev) => {
    if (sev === "critical") return 3;
    if (sev === "important") return 2;
    if (sev === "suggestion") return 1;
    return 0;
  };
  const buckets = new Map();
  for (const rawLine of raw.split(/\\r?\\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (row.maturity === "lifted-to-enforcement" || typeof row.superseded_by === "string") continue;
    const type = typeof row.type === "string" ? row.type : "";
    const trigger = typeof row.trigger === "string" ? row.trigger : "";
    const action = typeof row.action === "string" ? row.action : "";
    if (type.length === 0 || trigger.length === 0 || action.length === 0) continue;
    const key = type + "||" + normalize(trigger) + "||" + normalize(action);
    const frequency = Number.isInteger(row.frequency) && row.frequency > 0 ? Math.floor(row.frequency) : 1;
    const lastSeen = typeof row.last_seen_ts === "string" ? row.last_seen_ts : "";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        trigger,
        action,
        recurrence: frequency,
        entryCount: 1,
        severity: typeof row.severity === "string" ? row.severity : undefined,
        lastSeenTs: lastSeen,
        types: new Set([type]),
        maturity: new Set([typeof row.maturity === "string" ? row.maturity : "raw"])
      };
      buckets.set(key, bucket);
      continue;
    }
    bucket.recurrence += frequency;
    bucket.entryCount += 1;
    bucket.types.add(type);
    bucket.maturity.add(typeof row.maturity === "string" ? row.maturity : "raw");
    if (row.severity === "critical") {
      bucket.severity = "critical";
    } else if (row.severity === "important" && bucket.severity !== "critical") {
      bucket.severity = "important";
    }
    if (lastSeen && Date.parse(lastSeen) > Date.parse(bucket.lastSeenTs || "0")) {
      bucket.lastSeenTs = lastSeen;
    }
  }
  const ready = [];
  for (const bucket of buckets.values()) {
    const criticalOverride = bucket.severity === "critical";
    const meetsRecurrence = bucket.recurrence >= threshold;
    if (!criticalOverride && !meetsRecurrence) continue;
    ready.push({
      trigger: bucket.trigger,
      action: bucket.action,
      recurrence: bucket.recurrence,
      entryCount: bucket.entryCount,
      qualification: criticalOverride && !meetsRecurrence ? "critical_override" : "recurrence",
      ...(bucket.severity ? { severity: bucket.severity } : {}),
      lastSeenTs: bucket.lastSeenTs,
      types: Array.from(bucket.types).sort(),
      maturity: Array.from(bucket.maturity).sort()
    });
  }
  ready.sort((a, b) => {
    const sevDiff = severityWeight(b.severity) - severityWeight(a.severity);
    if (sevDiff !== 0) return sevDiff;
    if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;
    const recencyDiff = Date.parse(b.lastSeenTs || "0") - Date.parse(a.lastSeenTs || "0");
    if (!Number.isNaN(recencyDiff) && recencyDiff !== 0) return recencyDiff;
    return String(a.trigger).localeCompare(String(b.trigger));
  });
  return {
    schemaVersion: 2,
    threshold,
    baseThreshold,
    ...(archivedRunsCount !== undefined ? { archivedRunsCount } : {}),
    smallProjectRelaxationApplied,
    clusterCount: buckets.size,
    readyCount: ready.length,
    ready: ready.slice(0, maxReady),
    lastUpdatedAt: normalizeCompoundLastUpdatedAt(new Date())
  };
}
`;

/**
 * Inline mirror of `src/tdd-cycle.ts::computeRalphLoopStatus`.
 *
 * Parity enforced by
 * `tests/unit/ralph-loop-parity.test.ts::ralph-loop parity`.
 *
 * Signature contract:
 *   async function computeRalphLoopStatusInline(stateDir, runId) -> RalphLoopStatus
 */
export const RALPH_LOOP_INLINE_SOURCE = `
async function computeRalphLoopStatusInline(stateDir, runId) {
  const filePath = path.join(stateDir, "tdd-cycle-log.jsonl");
  const raw = await readTextFile(filePath, "");
  const sliceMap = new Map();
  const acClosed = new Set();
  const redOpenSlices = [];
  let loopIteration = 0;
  for (const rawLine of raw.split(/\\r?\\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rowRun = typeof row.runId === "string" && row.runId.length > 0 ? row.runId : runId;
    if (rowRun !== runId) continue;
    const slice = typeof row.slice === "string" && row.slice.length > 0 ? row.slice : "S-unknown";
    let state = sliceMap.get(slice);
    if (!state) {
      state = { slice, redCount: 0, greenCount: 0, refactorCount: 0, redOpen: false, acIds: [] };
      sliceMap.set(slice, state);
    }
    const exitCode = typeof row.exitCode === "number" ? row.exitCode : undefined;
    if (row.phase === "red") {
      state.redCount += 1;
      if (exitCode !== undefined && exitCode !== 0) state.redOpen = true;
    } else if (row.phase === "green") {
      state.greenCount += 1;
      state.redOpen = false;
      loopIteration += 1;
      if (Array.isArray(row.acIds)) {
        for (const acId of row.acIds) {
          if (typeof acId !== "string" || acId.length === 0) continue;
          acClosed.add(acId);
          if (!state.acIds.includes(acId)) state.acIds.push(acId);
        }
      }
    } else if (row.phase === "refactor") {
      state.refactorCount += 1;
    }
  }
  for (const state of sliceMap.values()) {
    if (state.redOpen) redOpenSlices.push(state.slice);
  }
  const slices = Array.from(sliceMap.values()).sort((a, b) => a.slice.localeCompare(b.slice, "en"));
  return {
    schemaVersion: 1,
    runId,
    loopIteration,
    redOpen: redOpenSlices.length > 0,
    redOpenSlices,
    acClosed: Array.from(acClosed).sort(),
    sliceCount: slices.length,
    slices,
    lastUpdatedAt: new Date().toISOString()
  };
}
`;
