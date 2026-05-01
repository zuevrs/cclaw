import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Wave 22 (Phase E6): the `interactionHints[stage].skipQuestions` flag must
 * round-trip through the standard flow-state write path so it can be read by
 * the linter via `readFlowState` regardless of the host OS.
 *
 * `writeFileSafe` (used by `writeFlowState`) writes to a temp file and
 * renames atomically, with EPERM/EBUSY/EACCES retry and EXDEV copy+unlink
 * fallback for Windows / cross-volume setups, so this test covers both the
 * happy path and the structural shape required by `lintArtifact`.
 */

describe("interactionHints round-trip + atomic write", () => {
  it("persists skipQuestions flag and reads it back via readFlowState", async () => {
    const root = await createTempProject("flow-state-hint-roundtrip");
    await ensureRunSystem(root);

    const before = await readFlowState(root);
    await writeFlowState(root, {
      ...before,
      interactionHints: {
        ...(before.interactionHints ?? {}),
        scope: {
          skipQuestions: true,
          sourceStage: "brainstorm",
          recordedAt: new Date().toISOString()
        }
      }
    });

    const after = await readFlowState(root);
    expect(after.interactionHints?.scope?.skipQuestions).toBe(true);
    expect(after.interactionHints?.scope?.sourceStage).toBe("brainstorm");

    // Atomic-write breadcrumb: no leftover temp files.
    const stateDir = path.join(root, ".cclaw/state");
    const entries = await fs.readdir(stateDir);
    const tempLeftovers = entries.filter((name) => name.startsWith(".flow-state.json.tmp-"));
    expect(tempLeftovers).toEqual([]);
  });

  it("clears skipQuestions hint when overwritten with empty interactionHints", async () => {
    const root = await createTempProject("flow-state-hint-clear");
    await ensureRunSystem(root);

    const initial = await readFlowState(root);
    await writeFlowState(root, {
      ...initial,
      interactionHints: {
        scope: { skipQuestions: true, sourceStage: "brainstorm" }
      }
    });
    const reread = await readFlowState(root);
    await writeFlowState(root, {
      ...reread,
      interactionHints: {}
    });
    const afterClear = await readFlowState(root);
    expect(afterClear.interactionHints?.scope).toBeUndefined();
  });
});

/**
 * Wave 24 follow-up (v6.1.1): `taskClass` was declared on `FlowState`
 * (Wave 25 W25-A) and is read by the artifact-linter and the mandatory
 * delegation gate, but `coerceFlowState` in `src/run-persistence.ts`
 * silently dropped it during read AND write — making both Wave 24's
 * `software-bugfix` mandatory-delegation skip and Wave 25's
 * artifact-validation demotion dead in practice for any flow-state file
 * carrying the classification. This regression locks the round-trip.
 */
describe("taskClass round-trip (Wave 24 follow-up, v6.1.1)", () => {
  it("persists taskClass=software-bugfix through writeFlowState + readFlowState", async () => {
    const root = await createTempProject("flow-state-task-class-roundtrip");
    await ensureRunSystem(root);

    const before = await readFlowState(root);
    expect(before.taskClass).toBeUndefined();

    await writeFlowState(root, {
      ...before,
      taskClass: "software-bugfix"
    });

    const after = await readFlowState(root);
    expect(after.taskClass).toBe("software-bugfix");
  });

  it("preserves taskClass on a manually-edited flow-state.json (read-only path)", async () => {
    const root = await createTempProject("flow-state-task-class-manual");
    await ensureRunSystem(root);

    const initial = await readFlowState(root);
    const statePath = path.join(root, ".cclaw/state/flow-state.json");
    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
    persisted.taskClass = "software-trivial";
    await fs.writeFile(statePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const reread = await readFlowState(root);
    expect(reread.activeRunId).toBe(initial.activeRunId);
    expect(reread.taskClass).toBe("software-trivial");
  });

  it("rejects unknown taskClass values rather than letting them leak through", async () => {
    const root = await createTempProject("flow-state-task-class-invalid");
    await ensureRunSystem(root);

    const statePath = path.join(root, ".cclaw/state/flow-state.json");
    const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
    persisted.taskClass = "speculative-future-class";
    await fs.writeFile(statePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const reread = await readFlowState(root);
    expect(reread.taskClass).toBeUndefined();
  });
});
