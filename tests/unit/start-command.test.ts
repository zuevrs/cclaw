import { describe, expect, it } from "vitest";
import { renderStartCommand } from "../../src/content/start-command.js";

describe("start command (/cc) markdown", () => {
  const body = renderStartCommand();

  it("explains the four core stages plan/build/review/ship", () => {
    for (const stage of ["plan", "build", "review", "ship"]) {
      expect(body).toContain(stage);
    }
  });

  it("describes the v8.45 stage sequence: detect → triage → dispatch → pause → compound", () => {
    expect(body).toMatch(/^## Detect$/m);
    expect(body).toMatch(/^## Triage/m);
    expect(body).toMatch(/^## Dispatch$/m);
    expect(body).toMatch(/^## Pause and resume$/m);
    expect(body).toMatch(/^## Compound/m);
  });

  it("requires the triage gate on every fresh /cc and persists the decision", () => {
    expect(body).toMatch(/triage[- ]gate/i);
    expect(body).toMatch(/triage decision is \*\*immutable\*\*/i);
    expect(body).toMatch(/userOverrode/);
  });

  it("describes per-stage sub-agent dispatch with a slim summary contract (v8.22: envelope shape in runbook)", () => {
    expect(body).toMatch(/Slim summary/i);
    expect(body).toContain("dispatch-envelope.md");
    expect(body).toMatch(/Dispatch envelope/);
  });

  it("v8.61 — describes the deterministic /cc dispatch matrix that replaced the resume picker", () => {
    expect(body).toMatch(/Detect — `\/cc` invocation matrix \(v8\.61\)/);
    // No more r/s/n picker — the resume decision is silent on /cc no-args.
    expect(body).not.toMatch(/\[r\]/);
    expect(body).not.toMatch(/\[s\]/);
    expect(body).not.toMatch(/\[c\] Cancel/);
    // The matrix must enumerate the four entry-point shapes (no-args, task, research, extend) for both active and non-active flow states.
    expect(body).toMatch(/Continue silently/);
    expect(body).toMatch(/Active flow: <slug>/);
    expect(body).toMatch(/No active flow\. Start with/);
    expect(body).toMatch(/No active flow to cancel/);
  });

  it("documents the three AC modes (inline/soft/strict) at the build stage", () => {
    expect(body).toMatch(/inline/);
    expect(body).toMatch(/soft/);
    expect(body).toMatch(/strict/);
  });

  it("requires explicit user approval for push and PR", () => {
    expect(body).toMatch(/git push/i);
    expect(body).toMatch(/explicit/i);
  });

  it("describes the automatic compound + shipped move", () => {
    expect(body).toMatch(/Compound \(automatic\)/);
    expect(body).toMatch(/shipped/);
  });

  it("references the failure-mode loop and the hard cap of 5 review iterations", () => {
    expect(body).toMatch(/Failure Modes/i);
    expect(body).toMatch(/5 review/);
  });
});
