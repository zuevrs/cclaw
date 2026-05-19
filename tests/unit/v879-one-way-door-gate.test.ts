import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import {
  ONE_WAY_DOOR_CHOICES,
  RECOMMENDED_NEXT,
  type OneWayDoorChoice,
  type OneWayDoorConfirmation
} from "../../src/types.js";
import { assertFlowStateV82, createInitialFlowState } from "../../src/flow-state.js";

/**
 * v8.79 — One-way door gate. Slimmed in v8.99 test-slim-down A2 to one
 * WIRING + one BEHAVIOR + one SECTION CONTRACT test covering the gate's
 * type surface, flow-state shape, and orchestrator wiring.
 */

describe("v8.79 — one-way door gate wiring", () => {
  it("WIRING — RECOMMENDED_NEXT carries `awaiting-one-way-confirmation`; ONE_WAY_DOOR_CHOICES = [confirm, edit, cancel]; OneWayDoorConfirmation accepts in-flight + confirmed shapes; assertFlowStateV82 validates back-compat (absent), in-flight, confirmed, null-cleared, and rejects bad shapes (non-object / non-array decisionIds / empty string id / invalid userChoice / non-string confirmedAt)", async () => {
    expect([...RECOMMENDED_NEXT]).toContain("awaiting-one-way-confirmation");
    expect([...ONE_WAY_DOOR_CHOICES].sort()).toEqual(["cancel", "confirm", "edit"]);
    expect(ONE_WAY_DOOR_CHOICES).toHaveLength(3);

    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    expect(state.oneWayDoorConfirmation).toBeUndefined();
    expect(() => assertFlowStateV82(state)).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: { decisionIds: ["D-1", "D-4"] } as OneWayDoorConfirmation
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: {
          decisionIds: ["D-2"],
          userChoice: "confirm" as const,
          confirmedAt: "2026-05-18T01:23:45Z"
        }
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({ ...state, oneWayDoorConfirmation: null })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: "confirm" as unknown as OneWayDoorConfirmation
      })
    ).toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: { decisionIds: "D-1" } as unknown as OneWayDoorConfirmation
      })
    ).toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: { decisionIds: ["D-1", ""] } as OneWayDoorConfirmation
      })
    ).toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: {
          decisionIds: ["D-1"],
          userChoice: "accept" as unknown as OneWayDoorChoice
        }
      })
    ).toThrow();
    expect(() =>
      assertFlowStateV82({
        ...state,
        oneWayDoorConfirmation: {
          decisionIds: ["D-1"],
          userChoice: "confirm" as const,
          confirmedAt: 12345 as unknown as string
        }
      })
    ).toThrow();

    // types.ts + flow-state.ts source pins
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const typesSource = await fs.readFile(path.join(here, "../../src/types.ts"), "utf8");
    expect(typesSource).toMatch(/export const RECOMMENDED_NEXT = \[/);
    expect(typesSource).toMatch(/export const ONE_WAY_DOOR_CHOICES = \[/);
    expect(typesSource).toMatch(/export interface OneWayDoorConfirmation \{/);
    expect(typesSource).toMatch(/decisionIds:\s*string\[\];/);
    expect(typesSource).toMatch(/userChoice\?:\s*OneWayDoorChoice;/);
    const flowStateSource = await fs.readFile(path.join(here, "../../src/flow-state.ts"), "utf8");
    expect(flowStateSource).toMatch(/oneWayDoorConfirmation\?:\s*OneWayDoorConfirmation \| null;/);
  });
});

describe("v8.79 — one-way door gate behavior (orchestrator routes the gate)", () => {
  it("BEHAVIOR — start-command body wires the gate AFTER architect / BEFORE plan-critic, scans plan.md for Reversibility: one-way, presents a three-option ask (confirm | edit | cancel), routes the three transitions (architect-complete → awaiting-one-way-confirmation → plan-critic | architect-revision | aborted) including the canonical RecommendedNext-enum hard-gate row, and skips on lite/inline ceremony when triage.ceremonyMode == 'inline'", () => {
    expect(START_COMMAND_BODY).toMatch(/One-way Door Gate/);
    expect(START_COMMAND_BODY).toMatch(/v8\.79/);
    expect(START_COMMAND_BODY).toMatch(/awaiting-one-way-confirmation/);
    expect(START_COMMAND_BODY).toMatch(
      /continue\s*\|\s*review-pause\s*\|\s*fix-only\s*\|\s*cancel\s*\|\s*accept-warns-and-ship\s*\|\s*awaiting-one-way-confirmation/
    );
    expect(START_COMMAND_BODY).toMatch(/Recommended next\s*==\s*"awaiting-one-way-confirmation"/);
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);

    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    expect(gateIdx).toBeGreaterThan(0);
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/Reversibility:\s*one-way/);
    expect(after).toMatch(/plan\.md/);
    expect(after).toMatch(/architect/);
    expect(after).toMatch(/plan-critic/);
    expect(after).toMatch(/User Sovereignty/);
    expect(after).toMatch(/Choose:\s*confirm\s*\|\s*edit\s*\|\s*cancel/);
    expect(after).toMatch(/architect-complete/);
    expect(after).toMatch(/architect-revision/);
    expect(after).toMatch(/aborted/);
    expect(after).toMatch(/confirm[\s\S]{0,400}plan-critic/);
    expect(after).toMatch(/edit[\s\S]{0,400}(architect-revision|plan\.md|re-invoke)/);
    expect(after).toMatch(/cancel[\s\S]{0,400}(aborted|\/cc-cancel)/);

    // lite-ceremony / inline skip
    expect(after).toMatch(/(lite-ceremony|inline)/i);
    expect(after).toMatch(/(skip|skipped)/i);
    expect(after).toMatch(/triage\.ceremonyMode\s*==\s*"inline"/);
    expect(START_COMMAND_BODY).toMatch(
      /awaiting-one-way-confirmation[\s\S]{0,500}(inline|Lite-ceremony|lite-ceremony)/
    );
    expect(after).toMatch(/0 hits|no.*Decisions|never fires|silently pass/i);
  });
});

describe("v8.79 — one-way door gate section contract (architect prompt + structured-ask payload)", () => {
  it("SECTION CONTRACT — architect prompt declares `awaiting-one-way-confirmation` as the new Recommended next variant tied to ≥1 D-N Reversibility: one-way, names the v8.79 gate + User Sovereignty rationale + the v8.74 cross-model critic as post-build counterpart, and continues to emit `Recommended next: build` for two-way decisions; structured-ask payload renders header + D-N bullet list (title / Reversibility / Rationale) + count line + User Sovereignty + Choose: line", () => {
    // architect prompt
    expect(ARCHITECT_PROMPT).toMatch(/awaiting-one-way-confirmation/);
    expect(ARCHITECT_PROMPT).toMatch(/Reversibility:\s*one-way/);
    expect(ARCHITECT_PROMPT).toMatch(/at least one/i);
    expect(ARCHITECT_PROMPT).toMatch(/One-way Door Gate/);
    expect(ARCHITECT_PROMPT).toMatch(/v8\.79/);
    expect(ARCHITECT_PROMPT).toMatch(/two-way/);
    expect(ARCHITECT_PROMPT).toMatch(/Recommended next:\s*(<build|build)/);
    expect(ARCHITECT_PROMPT).toMatch(/User Sovereignty/);
    expect(ARCHITECT_PROMPT).toMatch(/cross-model/i);

    // Structured-ask payload (search starting from the gate header to disambiguate
    // the verbatim `## One-way door detected` header from the bullet-list reference).
    expect(START_COMMAND_BODY).toMatch(/##\s*One-way door detected/);
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const askIdx = START_COMMAND_BODY.indexOf("## One-way door detected", gateIdx);
    expect(askIdx).toBeGreaterThan(0);
    const block = START_COMMAND_BODY.slice(askIdx, askIdx + 3000);
    expect(block).toMatch(/\*\*D-N: <title>\*\*/);
    expect(block).toMatch(/Reversibility:\s*one-way/);
    expect(block).toMatch(/Rationale:/);
    expect(block).toMatch(/<count>\s*irreversible decision/);
    expect(block).toMatch(
      /User Sovereignty principle:\s*irreversible decisions deserve explicit confirmation before build burns context\./
    );
    expect(block).toMatch(/Choose:\s*confirm\s*\|\s*edit\s*\|\s*cancel/);
  });
});
