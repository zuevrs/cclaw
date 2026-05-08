import { describe, expect, it } from "vitest";
import { DEFAULT_HOOK_PROFILE, NODE_HOOKS } from "../../src/content/node-hooks.js";

describe("node hooks", () => {
  it("default profile is minimal", () => {
    expect(DEFAULT_HOOK_PROFILE).toBe("minimal");
  });

  it("ships only three hooks (session-start, stop-handoff, commit-helper)", () => {
    expect(NODE_HOOKS.map((hook) => hook.id)).toEqual(["session-start", "stop-handoff", "commit-helper"]);
  });

  it("every default hook is enabled by default", () => {
    for (const hook of NODE_HOOKS) {
      expect(hook.defaultEnabled).toBe(true);
    }
  });

  it("commit-helper validates AC shape and TDD phases in strict mode", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "commit-helper")!;
    expect(hook.body).toContain("AC-");
    expect(hook.body).toContain("--phase=red|green|refactor");
    expect(hook.body).toContain("schemaVersion !== 3 && state.schemaVersion !== 2");
    expect(hook.body).toContain("RED phase rejects production files");
  });

  it("commit-helper reads acMode from state.triage and is advisory in soft / inline modes", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "commit-helper")!;
    expect(hook.body).toMatch(/state\.triage\?\.acMode/);
    expect(hook.body).toMatch(/acMode !== "strict"/);
    expect(hook.body).toContain("advisory passthrough");
    expect(hook.body).toContain("no AC trace recorded");
  });

  it("commit-helper requires --message and a non-empty stage in soft mode", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "commit-helper")!;
    expect(hook.body).toContain("nothing staged. Stage your changes");
    expect(hook.body).toMatch(/--message=\\"\.\.\.\\" is required/);
  });

  it("session-start prints a mode-aware summary (strict shows AC progress; soft shows just slug+stage)", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "session-start")!;
    expect(hook.body).toMatch(/mode=strict/);
    expect(hook.body).toMatch(/mode=\$\{acMode\}/);
    expect(hook.body).toContain("AC committed");
  });

  it("stop-handoff is silent in soft mode when no pending AC apply, but prints a stage reminder", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "stop-handoff")!;
    expect(hook.body).toContain("acMode === \"strict\"");
    expect(hook.body).toContain("stopping mid-flow");
  });
});
