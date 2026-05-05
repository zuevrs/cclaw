import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runWaveStatus } from "../../src/internal/wave-status.js";
import {
  ensureRunSystem,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Regression — `runWaveStatus` against the markdown-table shape that
 * `cclaw-cli sync` writes for real projects. The wave heading itself
 * (`### Wave W-04 — after fan-in W-03 …`) and the per-row `dependsOn`
 * column must round-trip cleanly without surfacing a
 * `wave_plan_managed_block_missing` warning.
 */

// ---------------------------------------------------------------------------
// Realistic 60-line managed block representing a 4-wave parallel plan.
// Do NOT prettify or "tidy" — any deviation defeats the point of the test.
// ---------------------------------------------------------------------------

const MANAGED_BLOCK = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

- **Cap:** 5 parallel units per wave (conflict-aware via \`claimedPaths\`).
- **Active mode:** \`worktree-first\`.

### Wave W-02 — next \`/cc\` run (4 lanes, all disjoint)

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-13 | T-008a | [] | crates/sidecar-build/src/manifest.rs, crates/sidecar-build/Cargo.toml, crates/sidecar-build/src/main.rs, crates/foo-types/tests/sidecar_build_manifest.rs, Cargo.lock | true | low | sidecar-manifest |
| S-14 | T-008b | [] | crates/foo-types/tests/release_yml_lint.rs | true | low | release-lint |
| S-15 | T-008c | [] | .github/workflows/release.yml, crates/foo-types/tests/release_yml_job_a_sha.rs | true | standard | release-yml |
| S-16 | T-014a | [] | crates/app/src-tauri/src/lib.rs, crates/foo-types/tests/app_hello_smoke.rs | true | low | app-shell |

- Path union: 18 files. Pairwise overlap: 0. Expected cap usage: 4/5.
- All 4 lanes start together after the shared RED checkpoint.

### Wave W-03 — after fan-in W-02

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-17 | T-008d | [S-15] | .github/workflows/release.yml, crates/foo-types/tests/release_yml_job_b_embed.rs, crates/release/manifest/.gitkeep | false | standard | release-yml |

- S-17 is sequential because of the overlap with S-15 on \`release.yml\`.

### Wave W-04 — after fan-in W-03 (5 lanes, all disjoint)

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-18 | T-010 | [] | .gitignore | true | low | gitignore |
| S-19 | T-011 | [] | rustfmt.toml, .cargo/config.toml | true | low | rustfmt |
| S-20 | T-012 | [] | crates/app/.eslintrc.cjs, crates/app/tsconfig.json | true | low | app-eslint |
| S-21 | T-013 | [] | .github/workflows/ci.yml | true | standard | ci-scaffold |
| S-22 | T-015 | [] | crates/foo-types/src/redacted.rs, crates/foo-types/src/lib.rs | true | low | redacted-newtype |

- Path union: 8 files. Pairwise overlap: 0. Expected cap usage: 5/5.
- All 5 lanes start together after the shared fan-in W-03.

### Wave W-05 — continuation for overlap-tasks (after fan-in W-04)

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-23 | T-014b | [S-21] | .github/workflows/ci.yml | false | standard | tauri-toolchain-smoke |
| S-24 | T-014c | [S-23] | .github/workflows/ci.yml | false | standard | tauri-launch-smoke |
| S-25 | T-016 | [S-22] | crates/foo-types/src/distro_name.rs, crates/foo-types/src/lib.rs | false | low | distro-name |
| S-26 | T-017 | [S-25] | crates/foo-types/src/snapshot_path.rs, crates/foo-types/src/lib.rs | false | low | snapshot-path |

- Inside W-05 there are two independent serial chains.

### Backlog — needs Linux runner (currently outside parallel waves)

- T-007b-callsite — chroot/nspawn baker.

<!-- parallel-exec-managed-end -->
`;

const PLAN_HEADER = `# Plan Artifact

## Task List
- T-008a, T-008b, T-008c, T-008d, T-010, T-011, T-012, T-013, T-014a, T-014b, T-014c, T-015, T-016, T-017

## Dependency Batches
- Batch 1.

## Acceptance Mapping
- T-008a → AC-001.

## Execution Posture
- Posture: parallel.

## Learnings
- None this stage.

`;

async function seedTableShapeProject(root: string): Promise<void> {
  await ensureRunSystem(root);
  const state = await readFlowState(root);
  await writeFlowState(
    root,
    {
      ...state,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    },
    { allowReset: true }
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/05-plan.md"),
    `${PLAN_HEADER}${MANAGED_BLOCK}`,
    "utf8"
  );
}

describe("runWaveStatus against literal markdown-table managed block", () => {
  it("recognizes 4 waves (W-02..W-05) with the correct member sets and emits no `wave_plan_managed_block_missing` warning", async () => {
    const root = await createTempProject("wave-status-table-shape");
    await seedTableShapeProject(root);

    const report = await runWaveStatus(root);

    expect(report.waves).toHaveLength(4);
    expect(report.waves.map((w) => w.waveId)).toEqual([
      "W-02",
      "W-03",
      "W-04",
      "W-05"
    ]);

    const w02 = report.waves.find((w) => w.waveId === "W-02")!;
    expect(w02.members).toEqual(["S-13", "S-14", "S-15", "S-16"]);

    const w03 = report.waves.find((w) => w.waveId === "W-03")!;
    expect(w03.members).toEqual(["S-17"]);

    const w04 = report.waves.find((w) => w.waveId === "W-04")!;
    expect(w04.members).toEqual([
      "S-18",
      "S-19",
      "S-20",
      "S-21",
      "S-22"
    ]);

    const w05 = report.waves.find((w) => w.waveId === "W-05")!;
    expect(w05.members).toEqual(["S-23", "S-24", "S-25", "S-26"]);

    const hasManagedMissing = report.warnings.some((w) =>
      w.startsWith("wave_plan_managed_block_missing")
    );
    expect(hasManagedMissing).toBe(false);

    // The dependsOn `[S-21]` token in W-05 row 1 must NOT leak into W-05's
    // member list. S-21 belongs to W-04.
    expect(w05.members).not.toContain("S-21");
  });

  it("returns nextDispatch.waveId=W-02 with mode=wave-fanout and 4 ready members when no slice is closed yet", async () => {
    const root = await createTempProject(
      "wave-status-table-shape-next-dispatch"
    );
    await seedTableShapeProject(root);

    const report = await runWaveStatus(root);

    expect(report.nextDispatch.waveId).toBe("W-02");
    expect(report.nextDispatch.mode).toBe("wave-fanout");
    expect([...report.nextDispatch.readyToDispatch].sort()).toEqual([
      "S-13",
      "S-14",
      "S-15",
      "S-16"
    ]);
  });

  it("advances nextDispatch.waveId to W-04 once W-02 and W-03 are closed via stream-mode (green + refactorOutcome) events", async () => {
    const root = await createTempProject("wave-status-table-shape-w04");
    await seedTableShapeProject(root);
    const state = await readFlowState(root);

    const closeStreamMode = (sliceId: string, ts: string): Record<string, unknown> => ({
      stage: "tdd",
      agent: "slice-builder",
      mode: "mandatory",
      status: "completed",
      event: "completed",
      eventTs: ts,
      ts,
      completedTs: ts,
      spanId: `span-${sliceId}-green`,
      phase: "green",
      sliceId,
      runId: state.activeRunId,
      schemaVersion: 3,
      refactorOutcome: { mode: "deferred", rationale: "no refactor taken" },
      evidenceRefs: [`green ok ${sliceId}`]
    });

    const closedSlices = ["S-13", "S-14", "S-15", "S-16", "S-17"];
    const events = closedSlices.map((id, idx) =>
      closeStreamMode(id, `2026-05-04T16:${(40 + idx).toString().padStart(2, "0")}:00Z`)
    );

    await fs.writeFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      JSON.stringify(
        { runId: state.activeRunId, schemaVersion: 3, entries: events },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/delegation-events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8"
    );

    const report = await runWaveStatus(root);

    expect(report.nextDispatch.waveId).toBe("W-04");
    expect(report.nextDispatch.mode).toBe("wave-fanout");
    expect([...report.nextDispatch.readyToDispatch].sort()).toEqual([
      "S-18",
      "S-19",
      "S-20",
      "S-21",
      "S-22"
    ]);
    const hasManagedMissing = report.warnings.some((w) =>
      w.startsWith("wave_plan_managed_block_missing")
    );
    expect(hasManagedMissing).toBe(false);
  });
});
