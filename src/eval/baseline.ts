/**
 * Baseline I/O + regression comparison for the eval subsystem.
 *
 * Layout on disk (committed):
 *
 *   .cclaw/evals/baselines/<stage>.json
 *
 * Each file contains a `BaselineSnapshot` keyed by `EvalCase.id`. We compute
 * regressions by comparing per-verifier `ok` flags across runs: any verifier
 * that was `ok:true` in the baseline and is `ok:false` now counts as a
 * critical failure. A case whose aggregate `passed` flipped from true to
 * false is flagged as `case-now-failing` regardless of per-verifier churn.
 *
 * Writes are gated behind an explicit `--update-baseline --confirm` pair at
 * the CLI layer so accidental resets do not slip into PRs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { EVALS_ROOT, CCLAW_VERSION } from "../constants.js";
import { exists } from "../fs-utils.js";
import { FLOW_STAGES } from "../types.js";
import type { FlowStage } from "../types.js";
import type {
  BaselineCaseEntry,
  BaselineDelta,
  BaselineRegression,
  BaselineSnapshot,
  BaselineVerifierEntry,
  EvalCaseResult,
  EvalReport
} from "./types.js";

export const BASELINE_SCHEMA_VERSION = 1;

/**
 * Thrown when a signed baseline's on-disk digest does not match the
 * canonical encoding of its `{ schemaVersion, stage, cases }` block.
 * Callers should treat this as a hard failure: the baseline was either
 * hand-edited or corrupted and cannot be trusted for regression gating.
 */
export class BaselineSignatureError extends Error {
  readonly file: string;
  readonly expected: string;
  readonly actual: string;

  constructor(opts: { file: string; expected: string; actual: string }) {
    super(
      `Baseline signature mismatch at ${opts.file}: expected ${opts.expected}, got ${opts.actual}. ` +
        `The file was modified outside of \`cclaw eval --update-baseline\`. ` +
        `Re-run with --update-baseline --confirm to re-sign a known-good snapshot.`
    );
    this.name = "BaselineSignatureError";
    this.file = opts.file;
    this.expected = opts.expected;
    this.actual = opts.actual;
  }
}

function baselinePath(projectRoot: string, stage: FlowStage): string {
  return path.join(projectRoot, EVALS_ROOT, "baselines", `${stage}.json`);
}

/**
 * Produce a deterministic sha256 digest over the signable portion of a
 * baseline. We intentionally exclude `generatedAt` and `cclawVersion`
 * from the digest so that rebuilding the same baseline from identical
 * case results on a new CLI version doesn't invalidate the signature —
 * only changes to the observed pass/ok/score payloads do.
 */
export function computeBaselineDigest(
  snapshot: Pick<BaselineSnapshot, "schemaVersion" | "stage" | "cases">
): string {
  const canonical = canonicalJson({
    schemaVersion: snapshot.schemaVersion,
    stage: snapshot.stage,
    cases: snapshot.cases
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * JSON.stringify with object keys sorted recursively so the digest is
 * stable across filesystem / serializer variations.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return `{${parts.join(",")}}`;
}

export async function loadBaseline(
  projectRoot: string,
  stage: FlowStage
): Promise<BaselineSnapshot | null> {
  const filePath = baselinePath(projectRoot, stage);
  if (!(await exists(filePath))) return null;
  const raw = await fs.readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid baseline at ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isBaseline(parsed, stage)) {
    throw new Error(
      `Invalid baseline at ${filePath}: shape mismatch (expected schemaVersion=${BASELINE_SCHEMA_VERSION}, stage=${stage})`
    );
  }
  const signature = parsed.signature;
  if (signature) {
    if (signature.algorithm !== "sha256") {
      throw new Error(
        `Invalid baseline at ${filePath}: unsupported signature algorithm "${signature.algorithm}".`
      );
    }
    const actual = computeBaselineDigest(parsed);
    if (actual !== signature.digest) {
      throw new BaselineSignatureError({
        file: filePath,
        expected: signature.digest,
        actual
      });
    }
  }
  return parsed;
}

function isBaseline(value: unknown, stage: FlowStage): value is BaselineSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== BASELINE_SCHEMA_VERSION) return false;
  if (candidate.stage !== stage) return false;
  if (typeof candidate.generatedAt !== "string") return false;
  if (typeof candidate.cclawVersion !== "string") return false;
  if (!candidate.cases || typeof candidate.cases !== "object") return false;
  return true;
}

export async function loadBaselinesByStage(
  projectRoot: string,
  stages: readonly FlowStage[]
): Promise<Map<FlowStage, BaselineSnapshot>> {
  const out = new Map<FlowStage, BaselineSnapshot>();
  for (const stage of stages) {
    const snapshot = await loadBaseline(projectRoot, stage);
    if (snapshot) out.set(stage, snapshot);
  }
  return out;
}

function entryFromResult(result: EvalCaseResult): BaselineCaseEntry {
  const verifierResults: BaselineVerifierEntry[] = result.verifierResults.map((v) => ({
    id: v.id,
    kind: v.kind,
    ok: v.ok,
    ...(v.score !== undefined ? { score: v.score } : {})
  }));
  return { passed: result.passed, verifierResults };
}

export function buildBaselineForStage(
  stage: FlowStage,
  report: EvalReport
): BaselineSnapshot {
  const stageCases = report.cases.filter((c) => c.stage === stage);
  const cases: Record<string, BaselineCaseEntry> = {};
  for (const c of stageCases) {
    cases[c.caseId] = entryFromResult(c);
  }
  const now = new Date().toISOString();
  const unsigned: BaselineSnapshot = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    stage,
    generatedAt: now,
    cclawVersion: CCLAW_VERSION,
    cases
  };
  unsigned.signature = {
    algorithm: "sha256",
    digest: computeBaselineDigest(unsigned),
    signedAt: now
  };
  return unsigned;
}

export async function writeBaselinesFromReport(
  projectRoot: string,
  report: EvalReport
): Promise<string[]> {
  const written: string[] = [];
  const stages = new Set<FlowStage>(report.cases.map((c) => c.stage));
  for (const stage of stages) {
    const snapshot = buildBaselineForStage(stage, report);
    const file = baselinePath(projectRoot, stage);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    written.push(file);
  }
  return written.sort();
}

function verifierMap(entries: BaselineVerifierEntry[]): Map<string, BaselineVerifierEntry> {
  const out = new Map<string, BaselineVerifierEntry>();
  for (const entry of entries) {
    out.set(entry.id, entry);
  }
  return out;
}

function computePassRate(cases: EvalCaseResult[]): number {
  if (cases.length === 0) return 1;
  const passed = cases.filter((c) => c.passed).length;
  return passed / cases.length;
}

function baselinePassRate(snapshot: BaselineSnapshot): number {
  const entries = Object.values(snapshot.cases);
  if (entries.length === 0) return 1;
  const passed = entries.filter((e) => e.passed).length;
  return passed / entries.length;
}

/**
 * Compare a freshly computed report against loaded baselines. If no baseline
 * exists for a stage covered by the report, that stage contributes zero
 * regressions (first run of that stage). Current is the source of truth.
 */
export function compareAgainstBaselines(
  report: EvalReport,
  baselines: Map<FlowStage, BaselineSnapshot>
): BaselineDelta | undefined {
  if (baselines.size === 0) return undefined;

  const regressions: BaselineRegression[] = [];
  const caseResultsByStage = new Map<FlowStage, EvalCaseResult[]>();
  for (const c of report.cases) {
    const bucket = caseResultsByStage.get(c.stage) ?? [];
    bucket.push(c);
    caseResultsByStage.set(c.stage, bucket);
  }

  let baselineTotalPassRate = 0;
  let baselineStagesCounted = 0;

  for (const [stage, snapshot] of baselines) {
    const current = caseResultsByStage.get(stage) ?? [];
    baselineTotalPassRate += baselinePassRate(snapshot);
    baselineStagesCounted += 1;

    for (const caseResult of current) {
      const baselineEntry = snapshot.cases[caseResult.caseId];
      if (!baselineEntry) continue;

      if (baselineEntry.passed && !caseResult.passed) {
        regressions.push({
          caseId: caseResult.caseId,
          stage,
          verifierId: "<case>",
          reason: "case-now-failing",
          previousScore: 1,
          currentScore: 0
        });
      }

      const baselineVerifiers = verifierMap(baselineEntry.verifierResults);
      for (const currentVerifier of caseResult.verifierResults) {
        const prev = baselineVerifiers.get(currentVerifier.id);
        if (!prev) continue;
        if (prev.ok && !currentVerifier.ok) {
          regressions.push({
            caseId: caseResult.caseId,
            stage,
            verifierId: currentVerifier.id,
            reason: "newly-failing",
            previousScore: prev.score ?? 1,
            currentScore: currentVerifier.score ?? 0
          });
        } else if (
          prev.score !== undefined &&
          currentVerifier.score !== undefined &&
          currentVerifier.score < prev.score
        ) {
          regressions.push({
            caseId: caseResult.caseId,
            stage,
            verifierId: currentVerifier.id,
            reason: "score-drop",
            previousScore: prev.score,
            currentScore: currentVerifier.score
          });
        }
      }
    }
  }

  const currentPassRate = computePassRate(report.cases);
  const baselineAveragePassRate =
    baselineStagesCounted === 0 ? currentPassRate : baselineTotalPassRate / baselineStagesCounted;
  const scoreDelta = Number((currentPassRate - baselineAveragePassRate).toFixed(4));

  const criticalFailures = regressions.filter(
    (r) => r.reason === "newly-failing" || r.reason === "case-now-failing"
  ).length;

  const baselineStages = [...baselines.keys()].sort().join(",");

  return {
    baselineId: baselineStages.length > 0 ? baselineStages : "(empty)",
    scoreDelta,
    criticalFailures,
    regressions
  };
}

export function listBaselineStages(projectRoot: string): Promise<FlowStage[]> {
  const root = path.join(projectRoot, EVALS_ROOT, "baselines");
  return fs
    .readdir(root, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.replace(/\.json$/, ""))
        .filter((name): name is FlowStage =>
          (FLOW_STAGES as readonly string[]).includes(name)
        )
    )
    .catch(() => []);
}
