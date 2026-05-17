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
  type OneWayDoorConfirmation,
  type RecommendedNext
} from "../../src/types.js";
import { assertFlowStateV82, createInitialFlowState } from "../../src/flow-state.js";

/**
 * v8.79 — One-way door gate: user-facing pause before irreversible commits.
 *
 * v8.74 introduced the mandatory `Reversibility:` field on every D-N in
 * plan.md and wired the cross-model critic to auto-fire on any `one-way`
 * decision — but that gate fires AFTER the build, looking for "did we
 * deliver on the irreversible commits?". The User Sovereignty principle
 * in the v8.74 ethos preamble says irreversible decisions deserve
 * explicit confirmation BEFORE the build burns context.
 *
 * v8.79 plugs that gap: after the architect's slim summary returns AND
 * before plan-critic dispatch, the orchestrator scans plan.md for any
 * `Reversibility: one-way` D-N. When ≥1 is found, the orchestrator
 * surfaces a structured ask with three options — `confirm` / `edit` /
 * `cancel` — and pauses the flow. The architect signals the gate via a
 * new `Recommended next: awaiting-one-way-confirmation` enum value;
 * flow-state.json gains a new `oneWayDoorConfirmation` field that
 * records the user's pick.
 *
 * Lite-ceremony (inline) skips the gate structurally — no plan stage,
 * no Decisions section, nothing to gate on.
 */

describe("v8.79 — RecommendedNext enum extends with awaiting-one-way-confirmation", () => {
  it("RECOMMENDED_NEXT array exports the canonical values plus the new one", () => {
    expect([...RECOMMENDED_NEXT]).toContain("continue");
    expect([...RECOMMENDED_NEXT]).toContain("review-pause");
    expect([...RECOMMENDED_NEXT]).toContain("fix-only");
    expect([...RECOMMENDED_NEXT]).toContain("cancel");
    expect([...RECOMMENDED_NEXT]).toContain("accept-warns-and-ship");
    expect([...RECOMMENDED_NEXT]).toContain("awaiting-one-way-confirmation");
  });

  it("RecommendedNext type accepts the new awaiting-one-way-confirmation value", () => {
    const v: RecommendedNext = "awaiting-one-way-confirmation";
    expect(v).toBe("awaiting-one-way-confirmation");
  });

  it("ONE_WAY_DOOR_CHOICES exports exactly three options (confirm / edit / cancel)", () => {
    expect([...ONE_WAY_DOOR_CHOICES].sort()).toEqual(["cancel", "confirm", "edit"]);
    expect(ONE_WAY_DOOR_CHOICES).toHaveLength(3);
  });

  it("OneWayDoorChoice type accepts confirm / edit / cancel verbatim", () => {
    const a: OneWayDoorChoice = "confirm";
    const b: OneWayDoorChoice = "edit";
    const c: OneWayDoorChoice = "cancel";
    expect([a, b, c]).toEqual(["confirm", "edit", "cancel"]);
  });
});

describe("v8.79 — OneWayDoorConfirmation flow-state shape + validator", () => {
  it("OneWayDoorConfirmation carries decisionIds (required), userChoice (optional), confirmedAt (optional)", () => {
    const inFlight: OneWayDoorConfirmation = { decisionIds: ["D-1", "D-3"] };
    expect(inFlight.userChoice).toBeUndefined();
    expect(inFlight.confirmedAt).toBeUndefined();

    const confirmed: OneWayDoorConfirmation = {
      decisionIds: ["D-2"],
      userChoice: "confirm",
      confirmedAt: "2026-05-18T01:23:45Z"
    };
    expect(confirmed.userChoice).toBe("confirm");
    expect(confirmed.confirmedAt).toBe("2026-05-18T01:23:45Z");
  });

  it("a fresh flow state validates with no oneWayDoorConfirmation (back-compat: pre-v8.79 absent)", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    expect(state.oneWayDoorConfirmation).toBeUndefined();
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });

  it("a flow state with valid in-flight oneWayDoorConfirmation validates", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const withGate = {
      ...state,
      oneWayDoorConfirmation: { decisionIds: ["D-1", "D-4"] } as OneWayDoorConfirmation
    };
    expect(() => assertFlowStateV82(withGate)).not.toThrow();
  });

  it("a flow state with userChoice=confirm + confirmedAt validates", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const withConfirm = {
      ...state,
      oneWayDoorConfirmation: {
        decisionIds: ["D-2"],
        userChoice: "confirm" as const,
        confirmedAt: "2026-05-18T01:23:45Z"
      }
    };
    expect(() => assertFlowStateV82(withConfirm)).not.toThrow();
  });

  it("a flow state with oneWayDoorConfirmation: null validates (explicit-cleared)", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const cleared = { ...state, oneWayDoorConfirmation: null };
    expect(() => assertFlowStateV82(cleared)).not.toThrow();
  });

  it("validator rejects non-object oneWayDoorConfirmation", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const bad = { ...state, oneWayDoorConfirmation: "confirm" as unknown as OneWayDoorConfirmation };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("validator rejects oneWayDoorConfirmation with non-array decisionIds", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const bad = {
      ...state,
      oneWayDoorConfirmation: { decisionIds: "D-1" } as unknown as OneWayDoorConfirmation
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("validator rejects oneWayDoorConfirmation with empty decisionId string", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const bad = {
      ...state,
      oneWayDoorConfirmation: { decisionIds: ["D-1", ""] } as OneWayDoorConfirmation
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("validator rejects oneWayDoorConfirmation with invalid userChoice", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const bad = {
      ...state,
      oneWayDoorConfirmation: {
        decisionIds: ["D-1"],
        userChoice: "accept" as unknown as OneWayDoorChoice
      }
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });

  it("validator rejects oneWayDoorConfirmation with non-string confirmedAt", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const bad = {
      ...state,
      oneWayDoorConfirmation: {
        decisionIds: ["D-1"],
        userChoice: "confirm" as const,
        confirmedAt: 12345 as unknown as string
      }
    };
    expect(() => assertFlowStateV82(bad)).toThrow();
  });
});

describe("v8.79 — architect slim summary maps one-way D-N to awaiting-one-way-confirmation", () => {
  it("architect prompt declares the awaiting-one-way-confirmation Recommended next variant", () => {
    expect(ARCHITECT_PROMPT).toMatch(/awaiting-one-way-confirmation/);
  });

  it("architect prompt documents that the one-way variant fires when ≥1 D-N has Reversibility: one-way", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Reversibility:\s*one-way/);
    expect(ARCHITECT_PROMPT).toMatch(/at least one/i);
  });

  it("architect prompt anchors the new variant against the v8.79 One-way Door Gate by name", () => {
    expect(ARCHITECT_PROMPT).toMatch(/One-way Door Gate/);
    expect(ARCHITECT_PROMPT).toMatch(/v8\.79/);
  });

  it("architect prompt continues to emit Recommended next: build when every D-N is two-way / mostly-two-way", () => {
    expect(ARCHITECT_PROMPT).toMatch(/two-way/);
    expect(ARCHITECT_PROMPT).toMatch(/Recommended next:\s*(<build|build)/);
  });

  it("architect prompt cites User Sovereignty / ethos preamble as the gate's rationale", () => {
    expect(ARCHITECT_PROMPT).toMatch(/User Sovereignty/);
  });

  it("architect prompt names the cross-model critic v8.74 trigger as the post-build counterpart", () => {
    // v8.79's gate fires BEFORE build; the v8.74 cross-model critic fires AFTER build.
    // The architect prompt cross-references them so both surfaces are wired together
    // (different lenses on the same Reversibility: one-way signal).
    expect(ARCHITECT_PROMPT).toMatch(/cross-model/i);
  });
});

describe("v8.79 — orchestrator gate is present in start-command", () => {
  it("start-command body contains the 'One-way door detected' structured-ask header", () => {
    expect(START_COMMAND_BODY).toMatch(/One-way door detected/);
  });

  it("start-command body declares the One-way Door Gate section under Dispatch", () => {
    expect(START_COMMAND_BODY).toMatch(/One-way Door Gate/);
    expect(START_COMMAND_BODY).toMatch(/v8\.79/);
  });

  it("start-command body documents the three-option structured ask (confirm | edit | cancel)", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    expect(gateIdx).toBeGreaterThan(0);
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/confirm/);
    expect(after).toMatch(/edit/);
    expect(after).toMatch(/cancel/);
    expect(after).toMatch(/Choose:\s*confirm\s*\|\s*edit\s*\|\s*cancel/);
  });

  it("start-command body declares the gate scans plan.md for Reversibility: one-way", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/Reversibility:\s*one-way/);
    expect(after).toMatch(/plan\.md/);
  });

  it("start-command body names the gate placement: AFTER architect, BEFORE plan-critic", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/architect/);
    expect(after).toMatch(/plan-critic/);
  });

  it("start-command body cites the User Sovereignty principle in the gate rationale", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/User Sovereignty/);
  });

  it("start-command's Recommended next enum block documents awaiting-one-way-confirmation", () => {
    expect(START_COMMAND_BODY).toMatch(/awaiting-one-way-confirmation/);
    // The new variant should sit in the canonical enum line alongside the existing values.
    expect(START_COMMAND_BODY).toMatch(
      /continue\s*\|\s*review-pause\s*\|\s*fix-only\s*\|\s*cancel\s*\|\s*accept-warns-and-ship\s*\|\s*awaiting-one-way-confirmation/
    );
  });

  it("start-command's hard-gate logic block routes awaiting-one-way-confirmation to the One-way Door Gate", () => {
    // The hard-gate logic enumerates how each Recommended next value flows;
    // v8.79 adds a row that routes the new variant through the gate.
    expect(START_COMMAND_BODY).toMatch(
      /Recommended next\s*==\s*"awaiting-one-way-confirmation"/
    );
  });

  it("start-command body documents flow-state transitions (architect-complete → awaiting-one-way-confirmation → plan-critic | architect-revision | aborted)", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/architect-complete/);
    expect(after).toMatch(/awaiting-one-way-confirmation/);
    expect(after).toMatch(/plan-critic/);
    expect(after).toMatch(/architect-revision/);
    expect(after).toMatch(/aborted/);
  });

  it("renderStartCommand stays identical to the exported body string (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });
});

describe("v8.79 — structured-ask payload shape", () => {
  it("ask payload header is `## One-way door detected`", () => {
    expect(START_COMMAND_BODY).toMatch(/##\s*One-way door detected/);
  });

  it("ask payload renders a D-N bulleted list with title + Reversibility: one-way + Rationale", () => {
    // The ask payload header `## One-way door detected` appears verbatim
    // inside the gate's prose example. Anchor against the section header
    // first to disambiguate from the bullet-list reference up top.
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const askIdx = START_COMMAND_BODY.indexOf("## One-way door detected", gateIdx);
    expect(askIdx).toBeGreaterThan(0);
    const block = START_COMMAND_BODY.slice(askIdx, askIdx + 3000);
    expect(block).toMatch(/\*\*D-N: <title>\*\*/);
    expect(block).toMatch(/Reversibility:\s*one-way/);
    expect(block).toMatch(/Rationale:/);
  });

  it("ask payload includes a count header that names the irreversible decision count", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const askIdx = START_COMMAND_BODY.indexOf("## One-way door detected", gateIdx);
    const block = START_COMMAND_BODY.slice(askIdx, askIdx + 3000);
    expect(block).toMatch(/<count>\s*irreversible decision/);
  });

  it("ask payload ends with the User Sovereignty rationale line + the three-option Choose: line", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const askIdx = START_COMMAND_BODY.indexOf("## One-way door detected", gateIdx);
    const block = START_COMMAND_BODY.slice(askIdx, askIdx + 3000);
    expect(block).toMatch(
      /User Sovereignty principle:\s*irreversible decisions deserve explicit confirmation before build burns context\./
    );
    expect(block).toMatch(/Choose:\s*confirm\s*\|\s*edit\s*\|\s*cancel/);
  });
});

describe("v8.79 — flow-state transitions documented (3 outcomes)", () => {
  it("transition #1: architect-complete → awaiting-one-way-confirmation (gate fires)", () => {
    expect(START_COMMAND_BODY).toMatch(
      /architect-complete[\s\S]{0,200}awaiting-one-way-confirmation/
    );
  });

  it("transition #2: awaiting-one-way-confirmation → plan-critic (on confirm)", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/confirm[\s\S]{0,400}plan-critic/);
  });

  it("transition #3a: awaiting-one-way-confirmation → architect-revision (on edit)", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/edit[\s\S]{0,400}(architect-revision|plan\.md|re-invoke)/);
  });

  it("transition #3b: awaiting-one-way-confirmation → aborted (on cancel)", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/cancel[\s\S]{0,400}(aborted|\/cc-cancel)/);
  });
});

describe("v8.79 — lite ceremony (inline) skips the gate", () => {
  it("start-command body documents the lite-ceremony exemption verbatim", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/(lite-ceremony|inline)/i);
    expect(after).toMatch(/(skip|skipped)/i);
  });

  it("start-command body anchors the inline-skip on triage.ceremonyMode == 'inline'", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    expect(after).toMatch(/triage\.ceremonyMode\s*==\s*"inline"/);
  });

  it("start-command's hard-gate logic block names the inline skip for awaiting-one-way-confirmation", () => {
    expect(START_COMMAND_BODY).toMatch(
      /awaiting-one-way-confirmation[\s\S]{0,500}(inline|Lite-ceremony|lite-ceremony)/
    );
  });

  it("start-command body names that the gate fires only when the scan returns ≥1 hit (so soft / inline plans without one-way D-Ns silently pass through)", () => {
    const gateIdx = START_COMMAND_BODY.indexOf("#### One-way Door Gate");
    const after = START_COMMAND_BODY.slice(gateIdx, gateIdx + 8000);
    // The gate is non-coercive: 0 hits = pass through silently.
    expect(after).toMatch(/0 hits|no.*Decisions|never fires|silently pass/i);
  });
});

describe("v8.79 — types + flow-state cross-references", () => {
  it("types.ts exports RecommendedNext + OneWayDoorChoice + OneWayDoorConfirmation symbols", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const typesSource = await fs.readFile(path.join(here, "../../src/types.ts"), "utf8");
    expect(typesSource).toMatch(/export const RECOMMENDED_NEXT = \[/);
    expect(typesSource).toMatch(/export type RecommendedNext = /);
    expect(typesSource).toMatch(/export const ONE_WAY_DOOR_CHOICES = \[/);
    expect(typesSource).toMatch(/export type OneWayDoorChoice = /);
    expect(typesSource).toMatch(/export interface OneWayDoorConfirmation \{/);
    expect(typesSource).toMatch(/decisionIds:\s*string\[\];/);
    expect(typesSource).toMatch(/userChoice\?:\s*OneWayDoorChoice;/);
    expect(typesSource).toMatch(/confirmedAt\?:\s*string;/);
  });

  it("flow-state.ts adds oneWayDoorConfirmation field on FlowStateV82", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const flowStateSource = await fs.readFile(
      path.join(here, "../../src/flow-state.ts"),
      "utf8"
    );
    expect(flowStateSource).toMatch(/oneWayDoorConfirmation\?:\s*OneWayDoorConfirmation \| null;/);
  });
});

describe("v8.79 — version + cross-cutting checks", () => {
  it("CHANGELOG.md contains a v8.79 entry naming the one-way door gate", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const changelog = await fs.readFile(path.join(here, "../../CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/v8\.79/);
    expect(changelog).toMatch(/one-way door/i);
    expect(changelog).toMatch(/User Sovereignty/);
  });

  it("package.json version is 8.79.x or later (the major/minor floor for the v8.79 work; package.json may be ahead due to v8.78/v8.81 race)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await fs.readFile(path.join(here, "../../package.json"), "utf8"));
    const parts = String(pkg.version).split(".");
    expect(parts).toHaveLength(3);
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(79);
  });
});
