import { describe, expect, it, vi } from "vitest";
import {
  __resetLegacyWarningForTests,
  modeToLegacyTier,
  parseModeInput
} from "../../src/eval/mode.js";

describe("eval mode compatibility helpers", () => {
  it("parses modern mode names without warnings", () => {
    const warn = vi.fn();
    expect(parseModeInput("fixture", { source: "cli", raw: "--mode=fixture" }, warn)).toBe("fixture");
    expect(parseModeInput("agent", { source: "config", raw: "agent" }, warn)).toBe("agent");
    expect(parseModeInput("workflow", { source: "env", raw: "workflow" }, warn)).toBe("workflow");
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts legacy tier names and warns once per process", () => {
    __resetLegacyWarningForTests();
    const warn = vi.fn();

    expect(parseModeInput("A", { source: "cli", raw: "--tier=A" }, warn)).toBe("fixture");
    expect(parseModeInput("B", { source: "config", raw: "defaultTier: B" }, warn)).toBe("agent");
    expect(parseModeInput("C", { source: "env", raw: "CCLAW_EVAL_MODE=C" }, warn)).toBe("workflow");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("legacy tier name");
  });

  it("reset helper re-enables deprecation warnings for tests", () => {
    __resetLegacyWarningForTests();
    const warn = vi.fn();
    parseModeInput("A", { source: "cli", raw: "--tier=A" }, warn);
    expect(warn).toHaveBeenCalledTimes(1);

    __resetLegacyWarningForTests();
    parseModeInput("A", { source: "cli", raw: "--tier=A" }, warn);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("throws on empty and unknown values", () => {
    expect(() => parseModeInput(" ", { source: "cli", raw: "--mode=" })).toThrow(/must be one of/);
    expect(() => parseModeInput("turbo", { source: "cli", raw: "--mode=turbo" })).toThrow(/must be one of/);
  });

  it("maps modern modes back to legacy tiers", () => {
    expect(modeToLegacyTier("fixture")).toBe("A");
    expect(modeToLegacyTier("agent")).toBe("B");
    expect(modeToLegacyTier("workflow")).toBe("C");
  });
});
