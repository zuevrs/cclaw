import { describe, expect, it } from "vitest";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as nodeHooks from "../../src/content/node-hooks.js";
import {
  NODE_HOOKS,
  RETIRED_HOOK_FILES,
  SESSION_START_HOOK_SPEC,
  COMMIT_HELPER_HOOK_SPEC
} from "../../src/content/node-hooks.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.38 — hooks cleanup.
 *
 * One tripwire test per AC so a single regression flips exactly one
 * assertion. Source: the audit notes that survived implementation, not
 * the "I'll know it when I see it" rubric.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readRepoFile(rel: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, rel), "utf8");
}

async function fileExists(rel: string): Promise<boolean> {
  try {
    await access(path.join(REPO_ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

describe("v8.38 — AC-1: dead run-hook loader removed", () => {
  it("src/runtime/run-hook.entry.ts no longer exists on disk", async () => {
    expect(await fileExists("src/runtime/run-hook.entry.ts")).toBe(false);
  });

  it("src/runtime/ directory is gone (the only file in it was run-hook.entry.ts)", async () => {
    expect(await fileExists("src/runtime")).toBe(false);
  });

  it("package.json carries no `build:hook-bundle` script", async () => {
    const pkgRaw = await readRepoFile("package.json");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts ?? {}).not.toHaveProperty("build:hook-bundle");
  });

  it("package.json `build` script no longer chains `npm run build:hook-bundle`", async () => {
    const pkgRaw = await readRepoFile("package.json");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.build ?? "").not.toContain("build:hook-bundle");
  });

  it("package.json does not list `esbuild` in devDependencies (no other repo file references it)", async () => {
    const pkgRaw = await readRepoFile("package.json");
    const pkg = JSON.parse(pkgRaw) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("esbuild");
    expect(pkg.dependencies ?? {}).not.toHaveProperty("esbuild");
  });

  it("vitest.config.ts no longer excludes src/runtime/run-hook.entry.ts from coverage", async () => {
    const config = await readRepoFile("vitest.config.ts");
    expect(config).not.toContain("src/runtime/run-hook.entry.ts");
  });
});

describe("v8.38 — AC-2: dead hook schema fields removed", () => {
  it("NodeHookSpec interface source declares no `events` field", async () => {
    const source = await readRepoFile("src/content/node-hooks.ts");
    const interfaceMatch = source.match(/export interface NodeHookSpec \{([\s\S]*?)\}/);
    expect(interfaceMatch, "NodeHookSpec interface must be present").toBeTruthy();
    expect(interfaceMatch![1]).not.toMatch(/\bevents\s*:/);
  });

  it("NodeHookSpec interface source declares no `defaultEnabled` field", async () => {
    const source = await readRepoFile("src/content/node-hooks.ts");
    const interfaceMatch = source.match(/export interface NodeHookSpec \{([\s\S]*?)\}/);
    expect(interfaceMatch, "NodeHookSpec interface must be present").toBeTruthy();
    expect(interfaceMatch![1]).not.toMatch(/\bdefaultEnabled\s*:/);
  });

  it("every shipped hook spec has no `events` or `defaultEnabled` property at runtime", () => {
    for (const spec of NODE_HOOKS) {
      expect((spec as Record<string, unknown>).events, `${spec.id} carries a stale events field`).toBeUndefined();
      expect(
        (spec as Record<string, unknown>).defaultEnabled,
        `${spec.id} carries a stale defaultEnabled field`
      ).toBeUndefined();
    }
  });

  it("DEFAULT_HOOK_PROFILE is no longer exported from src/content/node-hooks.ts", () => {
    expect((nodeHooks as Record<string, unknown>).DEFAULT_HOOK_PROFILE).toBeUndefined();
  });

  it("HookProfile type and `hooks.profile` field are no longer present in src/config.ts", async () => {
    const source = await readRepoFile("src/config.ts");
    expect(source).not.toMatch(/export type HookProfile\b/);
    expect(source).not.toMatch(/^\s*hooks\s*:\s*\{[^}]*profile/m);
  });

  it("renderConfig output does not include a `hooks:` block (canonical default config has no profile)", async () => {
    const source = await readRepoFile("src/config.ts");
    const renderMatch = source.match(/export function renderConfig[\s\S]*?\n\}/);
    expect(renderMatch, "renderConfig must be present").toBeTruthy();
    expect(renderMatch![0]).not.toMatch(/hooks:\s*$|hooks:\s*\n|hooks:\s*\{/);
  });
});

describe("v8.38 — AC-3: stop-handoff hook retired", () => {
  it("STOP_HANDOFF_HOOK is not exported from src/content/node-hooks.ts", () => {
    expect((nodeHooks as Record<string, unknown>).STOP_HANDOFF_HOOK).toBeUndefined();
  });

  it("STOP_HANDOFF_HOOK_SPEC is not exported from src/content/node-hooks.ts", () => {
    expect((nodeHooks as Record<string, unknown>).STOP_HANDOFF_HOOK_SPEC).toBeUndefined();
  });

  it("NODE_HOOKS lists exactly session-start and commit-helper, in that order", () => {
    expect(NODE_HOOKS.map((spec) => spec.id)).toEqual(["session-start", "commit-helper"]);
  });

  it("RETIRED_HOOK_FILES names stop-handoff.mjs so existing installs clean it up on upgrade", () => {
    expect(RETIRED_HOOK_FILES).toContain("stop-handoff.mjs");
  });

  it("scripts/build-plugin-manifests.mjs no longer wires session.stop or stop-handoff", async () => {
    const source = await readRepoFile("scripts/build-plugin-manifests.mjs");
    expect(source).not.toContain("session.stop");
    expect(source).not.toContain("stop-handoff");
  });

  it("src/install.ts no longer wires session.stop into the harness hooks config", async () => {
    const source = await readRepoFile("src/install.ts");
    expect(source).not.toContain("session.stop");
    expect(source).not.toContain("stop-handoff.mjs");
  });
});

describe("v8.38 — AC-4: session-start.mjs slimmed to a minimal ping", () => {
  const body = SESSION_START_HOOK_SPEC.body;

  it("body has no `flowArtifactBytes` helper", () => {
    expect(body).not.toContain("flowArtifactBytes");
  });

  it("body has no `pressureAdvice` helper", () => {
    expect(body).not.toContain("pressureAdvice");
  });

  it("body has no `PRESSURE_LOW` threshold", () => {
    expect(body).not.toContain("PRESSURE_LOW");
  });

  it("body has no `PRESSURE_HIGH` threshold", () => {
    expect(body).not.toContain("PRESSURE_HIGH");
  });

  it("body has no schemaVersion-1 migration nag (only commit-helper guarded against it, and that is gone too)", () => {
    expect(body).not.toContain("schemaVersion === 1");
    expect(body).not.toContain("schemaVersion !== 3");
  });

  it("body still prints the [cclaw] active: line for an active flow", () => {
    expect(body).toContain("[cclaw] active:");
  });

  it("body still prints the no-active-flow ping when state is missing or empty", () => {
    expect(body).toContain("[cclaw] no active flow. Use /cc <task> to start.");
  });

  it("body still surfaces strict-mode AC progress (committed N/M)", () => {
    expect(body).toContain("AC committed");
  });

  it("body fits inside ~30 lines (target was ~25; assert ≤30 as a soft ceiling)", () => {
    const lines = body.split("\n").length;
    expect(lines).toBeLessThanOrEqual(30);
  });
});

describe("v8.38 — AC-5: commit-helper.mjs tightened + bootstrap escape named", () => {
  const body = COMMIT_HELPER_HOOK_SPEC.body;

  it("commit-helper body no longer carries the schemaVersion-1 migration nag", () => {
    expect(body).not.toContain("schemaVersion !== 3 && state.schemaVersion !== 2");
    expect(body).not.toContain("unsupported flow-state schemaVersion");
  });

  it("commit-helper body still recognises `posture: bootstrap` (the escape stays wired)", () => {
    expect(body).toContain("bootstrap");
    expect(body).toContain("buildProfile");
  });

  it("tdd-and-verification skill body names the bootstrap escape in its own subsection", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.fileName === "tdd-and-verification.md");
    expect(skill, "tdd-and-verification.md skill must be registered").toBeDefined();
    expect(skill!.body).toContain("Bootstrap escape");
    expect(skill!.body).toMatch(/posture:\s*bootstrap/i);
    expect(skill!.body).toContain("AC-1");
  });

  it("tdd-and-verification skill calls out the legacy buildProfile fallback in the bootstrap subsection", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.fileName === "tdd-and-verification.md");
    expect(skill!.body).toMatch(/buildProfile\s*===\s*["']bootstrap["']/);
  });
});
