import { describe, expect, it } from "vitest";
import { HARNESS_ADAPTERS, harnessTier } from "../../src/harness-adapters.js";
import { harnessIntegrationDocMarkdown } from "../../src/content/harnesses-doc.js";

describe("harness parity model", () => {
  it("classifies harnesses into explicit tiers", () => {
    expect(harnessTier("claude")).toBe("tier1");
    expect(harnessTier("cursor")).toBe("tier2");
    expect(harnessTier("opencode")).toBe("tier2");
    expect(harnessTier("codex")).toBe("tier2");
  });

  it("keeps capability metadata attached to every harness adapter", () => {
    for (const adapter of Object.values(HARNESS_ADAPTERS)) {
      expect(["full", "generic", "partial", "none"]).toContain(adapter.capabilities.nativeSubagentDispatch);
      expect(["AskUserQuestion", "AskQuestion", "plain-text"]).toContain(adapter.capabilities.structuredAsk);
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

  it("renders harness docs from capability metadata", () => {
    const markdown = harnessIntegrationDocMarkdown();
    expect(markdown).toContain("Generated from `src/harness-adapters.ts` capabilities");
    expect(markdown).toContain("`tier1` (full native automation)");
    expect(markdown).toContain("`tier2` (partial automation with waivers)");
    expect(markdown).toContain("Semantic hook event coverage");
  });
});

