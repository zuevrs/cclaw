import { describe, expect, it } from "vitest";
import {
  claudeHooksJsonWithObservation,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation
} from "../../src/content/observe.js";
import { nodeHookRuntimeScript, stageCompleteScript } from "../../src/content/hooks.js";
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

  it("rejects claude hook docs missing PreCompact wiring", () => {
    const claude = JSON.parse(claudeHooksJsonWithObservation()) as {
      hooks: Record<string, unknown>;
    };
    delete claude.hooks.PreCompact;
    const result = validateHookDocument("claude", claude);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('missing required event array "PreCompact"');
  });

  it("rejects malformed claude hook payload shapes", () => {
    const claude = JSON.parse(claudeHooksJsonWithObservation()) as {
      hooks: Record<string, unknown>;
    };
    claude.hooks.PreToolUse = [{ matcher: "*" }];
    const result = validateHookDocument("claude", claude);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("hooks.PreToolUse[0].hooks must be a non-empty array");
  });

  it("rejects malformed cursor hook payload shapes", () => {
    const cursor = JSON.parse(cursorHooksJsonWithObservation()) as {
      hooks: Record<string, unknown>;
    };
    cursor.hooks.preToolUse = [{ matcher: "*" }];
    const result = validateHookDocument("cursor", cursor);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("hooks.preToolUse[0].command must be a non-empty string");
  });

  it("rejects codex hook docs missing UserPromptSubmit wiring", () => {
    const codex = JSON.parse(codexHooksJsonWithObservation()) as {
      hooks: Record<string, unknown>;
    };
    delete codex.hooks.UserPromptSubmit;
    const result = validateHookDocument("codex", codex);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('missing required event array "UserPromptSubmit"');
  });

  it("generated runtime hooks do not fallback to npx cclaw-cli", () => {
    const codex = codexHooksJsonWithObservation();
    expect(codex).not.toContain("npx -y cclaw-cli");
    expect(stageCompleteScript()).not.toContain("npx -y cclaw-cli");
    expect(nodeHookRuntimeScript()).not.toContain("npx -y cclaw-cli");
  });
});
