import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";
import {
  computeRalphLoopStatus,
  parseTddCycleLog,
  type TddCycleEntry
} from "../../src/tdd-cycle.js";
import {
  computeCompoundReadiness,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";

async function runHook(root: string, scriptBody: string, hookName: string, payload: unknown): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const scriptPath = path.join(root, "run-hook.mjs");
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, hookName], {
      cwd: root,
      env: { ...process.env, CCLAW_PROJECT_ROOT: root }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += String(c); });
    child.stderr.on("data", (c) => { stderr += String(c); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Parity test: the inline `computeRalphLoopStatusInline` / the inline
 * `computeCompoundReadinessInline` in the generated run-hook.mjs must
 * produce the same result as the canonical implementations in
 * src/tdd-cycle.ts and src/knowledge-store.ts for the same input.
 *
 * These tests close a long-standing hazard where the hook inline
 * implementation could silently drift from the CLI source of truth.
 */
describe("ralph-loop + compound-readiness parity (inline hook vs main)", () => {
  const CYCLE_LINES = [
    { runId: "run-parity", stage: "tdd", ts: "2026-04-01T00:00:01Z", slice: "S-1", phase: "red", command: "vitest", exitCode: 1 },
    { runId: "run-parity", stage: "tdd", ts: "2026-04-01T00:00:02Z", slice: "S-1", phase: "green", command: "vitest", exitCode: 0, acIds: ["AC-1"] },
    { runId: "run-parity", stage: "tdd", ts: "2026-04-01T00:00:03Z", slice: "S-2", phase: "red", command: "vitest", exitCode: 1 },
    { runId: "run-parity", stage: "tdd", ts: "2026-04-01T00:00:04Z", slice: "S-2", phase: "green", command: "vitest", exitCode: 0, acIds: ["AC-2"] },
    { runId: "run-parity", stage: "tdd", ts: "2026-04-01T00:00:05Z", slice: "S-2", phase: "refactor", command: "vitest", exitCode: 0 },
    { runId: "run-parity", stage: "tdd", ts: "2026-04-01T00:00:06Z", slice: "S-3", phase: "red", command: "vitest", exitCode: 1 }
  ];

  it("computeRalphLoopStatusInline matches computeRalphLoopStatus for a seeded cycle log", async () => {
    const root = await createTempProject("ralph-loop-parity");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-parity",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const raw = CYCLE_LINES.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), raw, "utf8");

    const result = await runHook(root, nodeHookRuntimeScript(), "session-start", {});
    expect(result.code).toBe(0);

    const inlineStatus = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/ralph-loop.json"), "utf8")
    ) as { [key: string]: unknown };

    const entries: TddCycleEntry[] = parseTddCycleLog(raw);
    const mainStatus = computeRalphLoopStatus(entries, { runId: "run-parity" });

    expect(inlineStatus.schemaVersion).toBe(mainStatus.schemaVersion);
    expect(inlineStatus.runId).toBe(mainStatus.runId);
    expect(inlineStatus.loopIteration).toBe(mainStatus.loopIteration);
    expect(inlineStatus.redOpen).toBe(mainStatus.redOpen);
    expect(inlineStatus.redOpenSlices).toEqual(mainStatus.redOpenSlices);
    expect(inlineStatus.acClosed).toEqual(mainStatus.acClosed);
    expect(inlineStatus.sliceCount).toBe(mainStatus.sliceCount);
    expect(inlineStatus.slices).toEqual(mainStatus.slices);
  });

  it("computeCompoundReadinessInline matches computeCompoundReadiness for a seeded knowledge file", async () => {
    const root = await createTempProject("compound-readiness-parity");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-parity",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const baseRow: Omit<KnowledgeEntry, "trigger" | "action" | "frequency" | "severity"> = {
      type: "pattern",
      confidence: "medium",
      domain: null,
      stage: "review",
      origin_stage: "review",
      origin_run: null,
      project: "cclaw",
      source: "stage",
      universality: "project",
      maturity: "raw",
      created: "2026-04-15T00:00:00Z",
      first_seen_ts: "2026-04-15T00:00:00Z",
      last_seen_ts: "2026-04-15T00:00:00Z"
    };
    const rows: KnowledgeEntry[] = [
      { ...baseRow, trigger: "swallowed errors", action: "rethrow with context", frequency: 2 },
      { ...baseRow, trigger: "swallowed errors", action: "rethrow with context", frequency: 1 },
      { ...baseRow, trigger: "auth bypass", action: "validate signature", severity: "critical", frequency: 1 },
      { ...baseRow, trigger: "unique", action: "skip", frequency: 1 },
      { ...baseRow, trigger: "already promoted", action: "do not recount", frequency: 5, maturity: "lifted-to-enforcement" },
      { ...baseRow, trigger: "superseded workaround", action: "do not recount", frequency: 5, superseded_by: "new-workaround" },
      { ...baseRow, trigger: "refreshed workaround", action: "count refreshed guidance", frequency: 3, supersedes: ["superseded-workaround"] }
    ];
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8"
    );

    // Seed archived runs so both sides see the same archivedRunsCount. The
    // hook counts directories under `.cclaw/archive/`; without this seed the
    // small-project relaxation would fire on the hook side only.
    const archiveDir = path.join(root, ".cclaw/archive");
    await fs.mkdir(archiveDir, { recursive: true });
    for (const name of ["run-a", "run-b", "run-c", "run-d", "run-e", "run-f"]) {
      await fs.mkdir(path.join(archiveDir, name), { recursive: true });
    }

    const result = await runHook(root, nodeHookRuntimeScript(), "session-start", {});
    expect(result.code).toBe(0);

    const inlineStatus = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/compound-readiness.json"), "utf8")
    ) as { [key: string]: unknown };

    const mainStatus = computeCompoundReadiness(rows, {
      now: new Date("2026-04-20T00:00:00Z"),
      archivedRunsCount: 6
    });

    expect(inlineStatus.schemaVersion).toBe(mainStatus.schemaVersion);
    expect(inlineStatus.threshold).toBe(mainStatus.threshold);
    expect(inlineStatus.baseThreshold).toBe(mainStatus.baseThreshold);
    expect(inlineStatus.archivedRunsCount).toBe(mainStatus.archivedRunsCount);
    expect(inlineStatus.smallProjectRelaxationApplied).toBe(mainStatus.smallProjectRelaxationApplied);
    expect(inlineStatus.clusterCount).toBe(mainStatus.clusterCount);
    expect(inlineStatus.readyCount).toBe(mainStatus.readyCount);
    expect(inlineStatus.ready).toEqual(mainStatus.ready);
  });

  it("session-start compound summary line matches internal formatter shape", async () => {
    const root = await createTempProject("compound-summary-line-parity");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-summary",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const base: Omit<KnowledgeEntry, "trigger" | "action" | "frequency" | "severity"> = {
      type: "pattern",
      confidence: "medium",
      domain: null,
      stage: "review",
      origin_stage: "review",
      origin_run: null,
      project: "cclaw",
      source: "stage",
      universality: "project",
      maturity: "raw",
      created: "2026-04-15T00:00:00Z",
      first_seen_ts: "2026-04-15T00:00:00Z",
      last_seen_ts: "2026-04-15T00:00:00Z"
    };
    const rows: KnowledgeEntry[] = [
      { ...base, trigger: "swallowed errors", action: "rethrow with context", frequency: 2 },
      { ...base, trigger: "swallowed errors", action: "rethrow with context", frequency: 1 },
      { ...base, trigger: "auth bypass", action: "validate signature", severity: "critical", frequency: 1 },
      { ...base, trigger: "low signal", action: "skip", frequency: 1 }
    ];
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8"
    );
    await fs.mkdir(path.join(root, ".cclaw/archive/run-a"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/archive/run-b"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/archive/run-c"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/archive/run-d"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/archive/run-e"), { recursive: true });

    const result = await runHook(root, nodeHookRuntimeScript(), "session-start", {});
    expect(result.code).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context = payload.hookSpecificOutput?.additionalContext ?? payload.additional_context ?? "";

    const mainStatus = computeCompoundReadiness(rows, {
      now: new Date("2026-04-20T00:00:00Z"),
      archivedRunsCount: 5
    });
    const criticalCount = mainStatus.ready.filter((cluster) => cluster.severity === "critical").length;
    const expectedLine = mainStatus.readyCount === 0
      ? `Compound readiness: no candidates (clusters=${mainStatus.clusterCount}, threshold=${mainStatus.threshold})`
      : `Compound readiness: clusters=${mainStatus.clusterCount}, ready=${mainStatus.readyCount}${criticalCount > 0 ? ` (critical=${criticalCount})` : ""}`;
    expect(context).toContain(expectedLine);
  });

  it("small-project relaxation: inline applies when archive count < 5", async () => {
    const root = await createTempProject("compound-readiness-small-project");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-small",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
    // A single cluster with recurrence=2 would fail the default threshold=3
    // but the small-project relaxation (<5 archived runs -> min(3,2)=2)
    // should let it through.
    const base: Omit<KnowledgeEntry, "trigger" | "action" | "frequency"> = {
      type: "pattern",
      confidence: "medium",
      domain: null,
      stage: "review",
      origin_stage: "review",
      origin_run: null,
      project: "cclaw",
      source: "stage",
      universality: "project",
      maturity: "raw",
      created: "2026-04-15T00:00:00Z",
      first_seen_ts: "2026-04-15T00:00:00Z",
      last_seen_ts: "2026-04-15T00:00:00Z"
    };
    const rows: KnowledgeEntry[] = [
      { ...base, trigger: "review gap", action: "add regression", frequency: 1 },
      { ...base, trigger: "review gap", action: "add regression", frequency: 1 }
    ];
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8"
    );
    // Exactly 2 archived runs -> small-project relaxation fires.
    await fs.mkdir(path.join(root, ".cclaw/archive/run-a"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/archive/run-b"), { recursive: true });

    const result = await runHook(root, nodeHookRuntimeScript(), "session-start", {});
    expect(result.code).toBe(0);
    const inlineStatus = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/compound-readiness.json"), "utf8")
    ) as {
      baseThreshold: number;
      threshold: number;
      archivedRunsCount: number;
      smallProjectRelaxationApplied: boolean;
      readyCount: number;
    };
    expect(inlineStatus.baseThreshold).toBe(3);
    expect(inlineStatus.threshold).toBe(2);
    expect(inlineStatus.archivedRunsCount).toBe(2);
    expect(inlineStatus.smallProjectRelaxationApplied).toBe(true);
    expect(inlineStatus.readyCount).toBe(1);
  });
});
