import { describe, expect, it } from "vitest";
import { renderStartCommand } from "../../src/content/start-command.js";

describe("start command (/cc) markdown", () => {
  const body = renderStartCommand();

  it("explains the four core stages plan/build/review/ship", () => {
    for (const stage of ["plan", "build", "review", "ship"]) {
      expect(body).toContain(stage);
    }
  });

  it("describes the v8.2 hop sequence: detect → triage → dispatch → pause → ship", () => {
    expect(body).toMatch(/Hop 1 — Detect/);
    expect(body).toMatch(/Hop 2 — Triage/);
    expect(body).toMatch(/Hop 3 — Dispatch/);
    expect(body).toMatch(/Hop 4 — Pause/);
    expect(body).toMatch(/Hop 5 — Compound/);
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

  it("explains the resume path when an active flow is detected", () => {
    expect(body).toMatch(/flow[- ]resume/i);
    expect(body).toMatch(/\[r\]/);
    expect(body).toMatch(/\[s\]/);
    expect(body).not.toMatch(/\[c\] Cancel/);
    expect(body).toMatch(/`\/cc-cancel` is \*\*not\*\* offered/);
    expect(body).toMatch(/conveying: resume — dispatch the next specialist/);
    expect(body).toMatch(/conveying: show — open the artifact for/);
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
