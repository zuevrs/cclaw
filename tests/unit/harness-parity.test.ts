import { describe, expect, it } from "vitest";
import { HARNESS_ADAPTERS, harnessTier } from "../../src/harness-adapters.js";

describe("harness parity model", () => {
  it("classifies harnesses into explicit tiers", () => {
    expect(harnessTier("claude")).toBe("tier1");
    expect(harnessTier("cursor")).toBe("tier2");
    expect(harnessTier("opencode")).toBe("tier2");
    // OpenCode and Codex now have full native subagent dispatch, but remain
    // tier2 overall because their hook surfaces are plugin/limited rather
    // than full.
    expect(harnessTier("codex")).toBe("tier2");
  });

  it("keeps capability metadata attached to every harness adapter", () => {
    for (const adapter of Object.values(HARNESS_ADAPTERS)) {
      expect(["full", "generic", "partial", "none"]).toContain(adapter.capabilities.nativeSubagentDispatch);
      expect([
        "AskUserQuestion",
        "AskQuestion",
        "question",
        "request_user_input",
        "plain-text"
      ]).toContain(adapter.capabilities.structuredAsk);
      expect(["full", "plugin", "limited", "none"]).toContain(adapter.capabilities.hookSurface);
      expect(["native", "generic-dispatch", "role-switch", "waiver"]).toContain(
        adapter.capabilities.subagentFallback
      );
    }
  });

  it("declares a sensible subagentFallback per harness", () => {
    expect(HARNESS_ADAPTERS.claude.capabilities.subagentFallback).toBe("native");
    expect(HARNESS_ADAPTERS.cursor.capabilities.subagentFallback).toBe("generic-dispatch");
    expect(HARNESS_ADAPTERS.opencode.capabilities.subagentFallback).toBe("native");
    expect(HARNESS_ADAPTERS.codex.capabilities.subagentFallback).toBe("native");
  });

  it("does not collapse OpenCode or Codex native subagents to role-switch", () => {
    expect(HARNESS_ADAPTERS.opencode.capabilities.nativeSubagentDispatch).toBe("full");
    expect(HARNESS_ADAPTERS.codex.capabilities.nativeSubagentDispatch).toBe("full");
    expect(HARNESS_ADAPTERS.opencode.capabilities.subagentFallback).not.toBe("role-switch");
    expect(HARNESS_ADAPTERS.codex.capabilities.subagentFallback).not.toBe("role-switch");
  });

  it("maps every harness onto its real structured-ask primitive (v0.41.0)", () => {
    // Wave Q honesty check: every shipping harness has a real
    // structured-ask tool, no `plain-text` freeloaders.
    expect(HARNESS_ADAPTERS.claude.capabilities.structuredAsk).toBe("AskUserQuestion");
    expect(HARNESS_ADAPTERS.cursor.capabilities.structuredAsk).toBe("AskQuestion");
    expect(HARNESS_ADAPTERS.opencode.capabilities.structuredAsk).toBe("question");
    expect(HARNESS_ADAPTERS.codex.capabilities.structuredAsk).toBe("request_user_input");
  });

  it("labels dispatch reality separately from declared native support", () => {
    expect(HARNESS_ADAPTERS.opencode.reality.declaredSupport).toBe("full");
    expect(HARNESS_ADAPTERS.opencode.reality.runtimeLaunch).toContain("prompt-level");
    expect(HARNESS_ADAPTERS.opencode.reality.proofRequired).toContain("dispatchId");
    expect(HARNESS_ADAPTERS.codex.reality.declaredSupport).toBe("full");
    expect(HARNESS_ADAPTERS.codex.reality.runtimeLaunch).toContain("prompt-level");
    expect(HARNESS_ADAPTERS.codex.reality.proofSource).toContain("delegation-events.jsonl");
  });

  it("exposes repair hints for native harness routing", () => {
    expect(HARNESS_ADAPTERS.opencode.reality.proofSource).toContain(".opencode/agents");
    expect(HARNESS_ADAPTERS.codex.reality.proofSource).toContain(".codex/agents");
  });

});

