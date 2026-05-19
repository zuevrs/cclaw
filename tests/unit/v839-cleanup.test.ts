import { describe, expect, it } from "vitest";
import { createMenuState, renderMenuFrame } from "../../src/main-menu.js";

/**
 * v8.39 — TUI menu cleanup tripwires, slimmed in v8.100.
 *
 * Kept only the `renderMenuFrame` integration tests (real wiring). The
 * source-grep tripwires (cli.ts dispatcher shape, MENU_LABELS keys,
 * import-line shape) were removed — they don't catch real regressions.
 */
describe("v8.39 cleanup — rendered menu surfaces the v8.39 shape", () => {
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

  it("hotkey legend renders the actual range (currently `1-3`, not the stale `1-7`)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    expect(frame).toContain("1-3 to jump");
    expect(frame).not.toContain("1-7 to jump");
  });
});
