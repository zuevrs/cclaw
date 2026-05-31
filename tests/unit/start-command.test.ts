import { describe, expect, it } from "vitest";
import { renderStartCommand } from "../../src/content/start-command.js";

/**
 * Slimmed in v8.101 test-slim-down A4 from 9 single-grep its() to 3
 * packed wiring tests (stage scaffolding, /cc invocation matrix,
 * approval+failure protocol). Each test packs all anchors for that
 * surface; the legacy per-anchor split was pure prompt-grep with no
 * objective mutation upside.
 */

describe("start command (/cc) markdown — stage scaffolding", () => {
  const body = renderStartCommand();

  it("BEHAVIOR — body documents the four core stages (plan/build/review/ship), the v8.45 stage sequence (Detect/Triage/Dispatch/Pause-and-resume/Compound), the triage gate (immutable decision + userOverrode), and the per-stage sub-agent dispatch contract (Slim summary + dispatch-envelope.md)", () => {
    for (const stage of ["plan", "build", "review", "ship"]) {
      expect(body).toContain(stage);
    }
    for (const heading of [
      /^## Detect$/m,
      /^## Triage/m,
      /^## Dispatch$/m,
      /^## Pause and resume$/m,
      /^## Compound/m
    ]) {
      expect(body).toMatch(heading);
    }
    expect(body).toMatch(/triage[- ]gate/i);
    expect(body).toMatch(/triage decision is \*\*immutable\*\*/i);
    expect(body).toMatch(/autoExecuted/);
    expect(body).toMatch(/Slim summary/i);
    expect(body).toContain("dispatch-envelope.md");
    expect(body).toMatch(/Dispatch envelope/);
  });
});

describe("start command (/cc) markdown — v8.61 deterministic invocation matrix + AC modes", () => {
  const body = renderStartCommand();

  it("BEHAVIOR — body documents the v8.61 Detect invocation matrix that replaced the r/s/n resume picker (no `[r]`, `[s]`, `[c] Cancel` tokens; the four entry-point shapes are enumerated for both active and non-active flow states) and names the three AC modes (inline/soft/strict)", () => {
    expect(body).toMatch(/Detect — `\/cc` invocation matrix/);
    expect(body).not.toMatch(/\[r\]/);
    expect(body).not.toMatch(/\[s\]/);
    expect(body).not.toMatch(/\[c\] Cancel/);
    for (const matrixCell of [
      /Continue silently/,
      /Active flow: <slug>/,
      /No active flow\. Start with/,
      /No active flow to cancel/
    ]) {
      expect(body).toMatch(matrixCell);
    }
    for (const mode of [/inline/, /soft/, /strict/]) {
      expect(body).toMatch(mode);
    }
  });
});

describe("start command (/cc) markdown — push approval + compound + failure-mode loop", () => {
  const body = renderStartCommand();

  it("BEHAVIOR — body requires explicit user approval for push/PR, describes the automatic compound + shipped move, and references the Failure Modes loop with the hard cap of 5 review iterations", () => {
    expect(body).toMatch(/git push/i);
    expect(body).toMatch(/explicit/i);
    expect(body).toMatch(/Compound \(automatic\)/);
    expect(body).toMatch(/shipped/);
    expect(body).toMatch(/Failure Modes/i);
    expect(body).toMatch(/5 review/);
  });
});
