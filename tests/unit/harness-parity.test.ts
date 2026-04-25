import { describe, expect, it } from "vitest";
import { HARNESS_ADAPTERS, harnessTier } from "../../src/harness-adapters.js";

describe("harness parity model", () => {
  it("classifies harnesses into explicit tiers", () => {
    expect(harnessTier("claude")).toBe("tier1");
    expect(harnessTier("cursor")).toBe("tier2");
    expect(harnessTier("opencode")).toBe("tier2");
    // Codex regained tier2 in v0.40.0: Codex CLI ≥ v0.114 (Mar 2026)
    // exposes lifecycle hooks via `.codex/hooks.json` (gated behind the
    // `codex_hooks` feature flag). PreToolUse/PostToolUse are Bash-only,
    // hence `hookSurface: "limited"` rather than `"full"`. cclaw ships
    // skill-kind shims under `.agents/skills/cc*/` for non-hook entry.
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
    expect(HARNESS_ADAPTERS.opencode.capabilities.subagentFallback).toBe("role-switch");
    expect(HARNESS_ADAPTERS.codex.capabilities.subagentFallback).toBe("role-switch");
  });

  it("maps every harness onto its real structured-ask primitive (v0.41.0)", () => {
    // Wave Q honesty check: every shipping harness has a real
    // structured-ask tool, no `plain-text` freeloaders.
    expect(HARNESS_ADAPTERS.claude.capabilities.structuredAsk).toBe("AskUserQuestion");
    expect(HARNESS_ADAPTERS.cursor.capabilities.structuredAsk).toBe("AskQuestion");
    expect(HARNESS_ADAPTERS.opencode.capabilities.structuredAsk).toBe("question");
    expect(HARNESS_ADAPTERS.codex.capabilities.structuredAsk).toBe("request_user_input");
  });

});

