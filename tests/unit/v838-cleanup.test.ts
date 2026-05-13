import { describe, expect, it } from "vitest";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * v8.38 — hooks cleanup (post-v8.40).
 *
 * v8.38 originally tightened the surviving hook source. v8.40 retires
 * the hook system entirely (no more session-start, no commit-helper, no
 * `.cclaw/hooks/` directory). The v8.38 invariants about hook content
 * shape (`flowArtifactBytes` / `pressureAdvice` / bootstrap escape inside
 * the hook body) are obsolete; this file keeps the v8.38 invariants that
 * are still meaningful AFTER v8.40 (no esbuild dep, no runtime entry, no
 * build:hook-bundle script, no stop-handoff or session.stop wiring in
 * the install pipeline or plugin-manifest script).
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

describe("v8.38 — AC-3: stop-handoff hook retired (still applies in v8.40)", () => {
  it("scripts/build-plugin-manifests.mjs no longer wires session.stop or stop-handoff", async () => {
    const source = await readRepoFile("scripts/build-plugin-manifests.mjs");
    expect(source).not.toContain("session.stop");
    expect(source).not.toContain("stop-handoff");
  });

  it("src/install.ts no longer wires session.stop into the harness hooks config", async () => {
    const source = await readRepoFile("src/install.ts");
    expect(source).not.toContain("session.stop");
    // v8.40 keeps `stop-handoff.mjs` in `RETIRED_HOOK_FILES` so existing
    // installs scrub it on upgrade, but the active wiring is gone — no
    // `writeHookFile` helper and no `STOP_HANDOFF_HOOK_SPEC` reference.
    expect(source).not.toContain("STOP_HANDOFF_HOOK_SPEC");
    expect(source).not.toContain("writeHookFile");
  });

  it("v8.40+: src/install.ts no longer references session-start or commit-helper either", async () => {
    const source = await readRepoFile("src/install.ts");
    // The retired-hooks cleanup list mentions the filenames so existing
    // installs remove them on upgrade; the wiring code does NOT live in
    // install.ts anymore. Assert no `writeHookFile` or NODE_HOOKS loops.
    expect(source).not.toContain("writeHookFile");
    expect(source).not.toContain("NODE_HOOKS");
  });
});
