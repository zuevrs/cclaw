import { describe, expect, it } from "vitest";
import {
  claudeHooksJsonWithObservation,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation
} from "../../src/content/observe.js";
import { validateHookDocument } from "../../src/hook-schema.js";

describe("hook schema validation", () => {
  it("accepts generated harness hook documents", () => {
    const claude = JSON.parse(claudeHooksJsonWithObservation()) as unknown;
    const cursor = JSON.parse(cursorHooksJsonWithObservation()) as unknown;
    const codex = JSON.parse(codexHooksJsonWithObservation()) as unknown;

    expect(validateHookDocument("claude", claude).ok).toBe(true);
    expect(validateHookDocument("cursor", cursor).ok).toBe(true);
    expect(validateHookDocument("codex", codex).ok).toBe(true);
  });

  it("rejects documents without schema version marker", () => {
    const claude = JSON.parse(claudeHooksJsonWithObservation()) as Record<string, unknown>;
    delete claude.cclawHookSchemaVersion;
    const result = validateHookDocument("claude", claude);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("expected cclawHookSchemaVersion=1");
  });
});
