import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDelegation,
  PhaseEventRequiresTerminalStatusError,
  validatePhaseEventStatus
} from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

async function seedFlowState(root: string, runId: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "tdd";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

describe("phase-event status validation (7.6.0 — Defect 2)", () => {
  describe("validatePhaseEventStatus pure helper", () => {
    it("rejects phase=red with status=acknowledged", () => {
      expect(() =>
        validatePhaseEventStatus({
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "acknowledged",
          spanId: "dspan-test-1",
          sliceId: "S-41",
          phase: "red"
        })
      ).toThrow(PhaseEventRequiresTerminalStatusError);
    });

    it("rejects phase=doc with status=acknowledged (the hox W-08/S-41 bug)", () => {
      try {
        validatePhaseEventStatus({
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "acknowledged",
          spanId: "dspan-doc",
          sliceId: "S-41",
          phase: "doc"
        });
        throw new Error("expected validatePhaseEventStatus to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PhaseEventRequiresTerminalStatusError);
        const phaseErr = err as PhaseEventRequiresTerminalStatusError;
        expect(phaseErr.phase).toBe("doc");
        expect(phaseErr.status).toBe("acknowledged");
        expect(phaseErr.correctedCommandHint).toContain("--status=completed --phase=doc");
        expect(phaseErr.correctedCommandHint).toContain("--slice=S-41");
        expect(phaseErr.message).toContain("phase_event_requires_completed_or_failed_status");
      }
    });

    it("accepts phase=green with status=completed", () => {
      expect(() =>
        validatePhaseEventStatus({
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "completed",
          spanId: "dspan-green",
          sliceId: "S-1",
          phase: "green"
        })
      ).not.toThrow();
    });

    it("accepts phase=red with status=failed (BLOCKED outcome)", () => {
      expect(() =>
        validatePhaseEventStatus({
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "failed",
          spanId: "dspan-blocked",
          sliceId: "S-1",
          phase: "red"
        })
      ).not.toThrow();
    });

    it("accepts dispatch-level ack (no phase) with status=acknowledged", () => {
      expect(() =>
        validatePhaseEventStatus({
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "acknowledged",
          spanId: "dspan-ack",
          sliceId: "S-1"
        })
      ).not.toThrow();
    });

    it("accepts launched/scheduled/waived/stale rows that omit phase", () => {
      for (const status of ["launched", "scheduled", "waived", "stale"] as const) {
        expect(() =>
          validatePhaseEventStatus({
            stage: "tdd",
            agent: "slice-builder",
            mode: "mandatory",
            status,
            spanId: "dspan-x",
            ...(status === "waived" ? { waiverReason: "test" } : {})
          })
        ).not.toThrow();
      }
    });

    it("rejects phase=refactor-deferred with status=acknowledged", () => {
      expect(() =>
        validatePhaseEventStatus({
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "acknowledged",
          spanId: "dspan-refdef",
          sliceId: "S-2",
          phase: "refactor-deferred"
        })
      ).toThrow(PhaseEventRequiresTerminalStatusError);
    });
  });

  describe("appendDelegation integration", () => {
    it("rejects phase rows with status=acknowledged at the canonical writer", async () => {
      const root = await createTempProject("phase-event-canonical");
      await seedFlowState(root, "run-phase");
      await expect(
        appendDelegation(root, {
          stage: "tdd",
          agent: "slice-builder",
          mode: "mandatory",
          status: "acknowledged",
          spanId: "dspan-bad",
          sliceId: "S-1",
          phase: "red"
        })
      ).rejects.toThrow(PhaseEventRequiresTerminalStatusError);
    });
  });
});
