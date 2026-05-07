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

  it("commit-helper hook validates AC argument shape", () => {
    const hook = NODE_HOOKS.find((entry) => entry.id === "commit-helper")!;
    expect(hook.body).toContain("AC-");
    expect(hook.body).toContain("schemaVersion !== 2");
    expect(hook.body).toContain("commit-helper");
  });
});
