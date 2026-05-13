import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MENU_ACTIONS, createMenuState, renderMenuFrame } from "../../src/main-menu.js";

/**
 * v8.39 — TUI menu cleanup + lag fix tripwires.
 *
 * One assertion per AC outcome so a single regression flips exactly one
 * test. Mirrors the v8.38 cleanup test layout: AC-1 (menu shape) gets a
 * tight set of constant + render tripwires; AC-2 (banner double-render
 * fix) gets a source-grep tripwire that pins the structural shape of
 * the fix (banner emitted by callers, not inside dispatchers) so a
 * future refactor that re-introduces the duplicate emit fails here
 * with a named assertion, not in a user bug report.
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

async function readSrc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("v8.39 cleanup — AC-1: MENU_ACTIONS collapsed to three rows", () => {
  it("MENU_ACTIONS contains exactly install / uninstall / quit, in that order", () => {
    expect([...MENU_ACTIONS]).toEqual(["install", "uninstall", "quit"]);
    expect(MENU_ACTIONS).toHaveLength(3);
  });

  it("MENU_ACTIONS does NOT contain the retired v8.37-era TUI rows", () => {
    const retiredRows = ["sync", "upgrade", "knowledge", "version"];
    for (const retired of retiredRows) {
      expect(
        (MENU_ACTIONS as readonly string[]).includes(retired),
        `MENU_ACTIONS must not contain retired row \`${retired}\` after v8.39`
      ).toBe(false);
    }
  });

  it("MENU_LABELS and MENU_DESCRIPTIONS keys are exactly the MENU_ACTIONS set", async () => {
    // We don't export MENU_LABELS / MENU_DESCRIPTIONS (they are module-local),
    // so the assertion targets the source text: every action id appears as a
    // key in both records, and no retired id appears in either record. This
    // is the tripwire that catches a future MENU_ACTIONS edit forgetting to
    // sync the label / description tables.
    const source = await readSrc("src/main-menu.ts");
    const labelBlock = source.match(/const MENU_LABELS[^}]+\}/u)?.[0];
    const descBlock = source.match(/const MENU_DESCRIPTIONS[^}]+\}/u)?.[0];
    expect(labelBlock, "MENU_LABELS block must be present").toBeDefined();
    expect(descBlock, "MENU_DESCRIPTIONS block must be present").toBeDefined();
    for (const action of MENU_ACTIONS) {
      expect(labelBlock, `MENU_LABELS missing key for \`${action}\``).toContain(
        `${action}:`
      );
      expect(descBlock, `MENU_DESCRIPTIONS missing key for \`${action}\``).toContain(
        `${action}:`
      );
    }
    for (const retired of ["sync", "upgrade", "knowledge", "version"]) {
      expect(
        labelBlock,
        `MENU_LABELS must not retain key for retired action \`${retired}\``
      ).not.toMatch(new RegExp(`\\b${retired}:`, "u"));
      expect(
        descBlock,
        `MENU_DESCRIPTIONS must not retain key for retired action \`${retired}\``
      ).not.toMatch(new RegExp(`\\b${retired}:`, "u"));
    }
  });

  it("rendered menu frame does NOT surface the retired row labels", () => {
    const installedFrame = renderMenuFrame(createMenuState(true), { useColor: false });
    const freshFrame = renderMenuFrame(createMenuState(false), { useColor: false });
    const retiredLabels = ["Sync", "Upgrade", "Browse knowledge", "Show version"];
    for (const frame of [installedFrame, freshFrame]) {
      for (const label of retiredLabels) {
        expect(
          frame,
          `rendered frame must not surface retired label \`${label}\` after v8.39`
        ).not.toContain(label);
      }
    }
  });

  it("install description text covers the dual reading (first-time setup OR idempotent reapply)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    // The description text on the Install row must signal both readings, so
    // a re-running operator on a project with .cclaw/ already wired knows
    // Install is the right row (not a missing Sync / Upgrade).
    expect(frame).toContain("first-time setup OR idempotent reapply");
    expect(frame).toContain("former sync/upgrade");
  });
});

describe("v8.39 cleanup — AC-2: duplicate banner emission removed from dispatchers", () => {
  it("`dispatchInstallAction` does NOT call `emitBanner` in its body (callers own banner emission)", async () => {
    const source = await readSrc("src/cli.ts");
    // Pull the body of dispatchInstallAction (from its declaration to the
    // matching closing brace). The body must NOT contain `emitBanner(` —
    // any re-introduction of the duplicate emit (the v8.39 bug) trips this.
    const match = source.match(
      /async function dispatchInstallAction\([\s\S]*?\n\}\n/u
    );
    expect(match, "dispatchInstallAction declaration must be findable").not.toBeNull();
    expect(
      match![0],
      "dispatchInstallAction body must not call emitBanner (v8.39 lag fix)"
    ).not.toMatch(/\bemitBanner\(/u);
  });

  it("`dispatchUninstall` does NOT call `emitBanner` in its body", async () => {
    const source = await readSrc("src/cli.ts");
    const match = source.match(/async function dispatchUninstall\([\s\S]*?\n\}\n/u);
    expect(match, "dispatchUninstall declaration must be findable").not.toBeNull();
    expect(
      match![0],
      "dispatchUninstall body must not call emitBanner (v8.39 lag fix)"
    ).not.toMatch(/\bemitBanner\(/u);
  });

  it("non-interactive switch emits the banner exactly once before install / uninstall arms", async () => {
    const source = await readSrc("src/cli.ts");
    // The non-interactive switch over SUBCOMMAND_TO_ACTION must emit the
    // banner inside its install/uninstall arms (since the dispatchers
    // themselves no longer do). Match the switch body and confirm both
    // arms contain `emitBanner(useColor)` immediately above their
    // dispatcher call.
    const switchBody = source.match(/switch \(subcommandAction\)[\s\S]*?\n  \}/u);
    expect(switchBody, "non-interactive switch must be findable").not.toBeNull();
    expect(switchBody![0]).toMatch(
      /case "install":\s*\n\s*emitBanner\(useColor\);\s*\n\s*return dispatchInstallAction/u
    );
    expect(switchBody![0]).toMatch(
      /case "uninstall":\s*\n\s*emitBanner\(useColor\);\s*\n\s*return dispatchUninstall/u
    );
  });
});

describe("v8.39 cleanup — AC-2: dispatcher signature narrowing", () => {
  it("`dispatchInstallAction` no longer accepts the `\"install\" | \"sync\" | \"upgrade\"` action union", async () => {
    const source = await readSrc("src/cli.ts");
    // Action parameter was dropped — the function now has a single shape,
    // taking only (context, args, interactive, useColor). The legacy union
    // must NOT appear in the file. (`syncCclaw` / `upgradeCclaw` may still
    // be name-checked in docstrings explaining the v8.37 history; the
    // import-line assertion below pins the runtime surface.)
    expect(source).not.toMatch(/action: "install" \| "sync" \| "upgrade"/u);
  });

  it("cli.ts no longer imports `syncCclaw` / `upgradeCclaw` (orphan removed alongside dispatch collapse)", async () => {
    const source = await readSrc("src/cli.ts");
    const importLine = source.match(/^import \{[^}]+\} from "\.\/install\.js";/mu);
    expect(importLine, "install.js import must be findable").not.toBeNull();
    expect(importLine![0]).toContain("initCclaw");
    expect(importLine![0]).toContain("uninstallCclaw");
    expect(importLine![0]).not.toContain("syncCclaw");
    expect(importLine![0]).not.toContain("upgradeCclaw");
  });
});

describe("v8.39 cleanup — hotkey legend stays in sync with MENU_ACTIONS.length", () => {
  it("legend renders the actual range (currently `1-3`)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    expect(frame).toContain("1-3 to jump");
    // The stale `1-7` from the pre-v8.39 layout must be gone (the v8.39
    // lesson: a hardcoded range will lie about the menu after any
    // collapse). Tripwire the literal so a future regression catches it.
    expect(frame).not.toContain("1-7 to jump");
  });
});
