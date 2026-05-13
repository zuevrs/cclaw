import { describe, expect, it } from "vitest";
import {
  applyMenuKey,
  createMenuState,
  MENU_ACTIONS,
  renderMenuFrame,
  selectedAction
} from "../../src/main-menu.js";

describe("main-menu — actions table", () => {
  it("exposes the three v8.39 actions in display order", () => {
    expect([...MENU_ACTIONS]).toEqual(["install", "uninstall", "quit"]);
  });
});

describe("main-menu — smart default cursor", () => {
  it("lands on `install` when no .cclaw/ exists (first-run hint)", () => {
    const state = createMenuState(false);
    expect(selectedAction(state)).toBe("install");
  });

  it("lands on `install` when .cclaw/ already exists (v8.39: install carries the former sync/upgrade reading)", () => {
    const state = createMenuState(true);
    expect(selectedAction(state)).toBe("install");
  });
});

describe("main-menu — keyboard reducer", () => {
  it("arrow-down moves the cursor forward and wraps at the bottom", () => {
    let state = createMenuState(false); // starts on `install` (index 0)
    for (let i = 0; i < MENU_ACTIONS.length; i += 1) {
      state = applyMenuKey(state, "\u001b[B").state;
    }
    expect(selectedAction(state)).toBe("install"); // wrapped back to start
  });

  it("arrow-up wraps from `install` (index 0) to `quit` (last index)", () => {
    const state = createMenuState(false);
    const next = applyMenuKey(state, "\u001b[A").state;
    expect(selectedAction(next)).toBe("quit");
  });

  it("vim keys j/k mirror arrow-down/arrow-up", () => {
    const installed = createMenuState(false);
    const afterJ = applyMenuKey(installed, "j").state;
    expect(selectedAction(afterJ)).toBe("uninstall");
    const afterK = applyMenuKey(afterJ, "k").state;
    expect(selectedAction(afterK)).toBe("install");
  });

  it("number keys 1-3 jump directly to the corresponding row", () => {
    let state = createMenuState(true); // starts on `install` (index 0)
    state = applyMenuKey(state, "2").state;
    expect(selectedAction(state)).toBe("uninstall");
    state = applyMenuKey(state, "3").state;
    expect(selectedAction(state)).toBe("quit");
    state = applyMenuKey(state, "1").state;
    expect(selectedAction(state)).toBe("install");
  });

  it("Enter confirms the current selection", () => {
    const state = createMenuState(true);
    const update = applyMenuKey(state, "\r");
    expect(update.outcome).toBe("confirm");
    expect(selectedAction(update.state)).toBe("install");
  });

  it("q jumps to quit and confirms in one keystroke", () => {
    const state = createMenuState(false);
    const update = applyMenuKey(state, "q");
    expect(update.outcome).toBe("confirm");
    expect(selectedAction(update.state)).toBe("quit");
  });

  it("Q (capital) also jumps to quit and confirms", () => {
    const state = createMenuState(false);
    const update = applyMenuKey(state, "Q");
    expect(update.outcome).toBe("confirm");
    expect(selectedAction(update.state)).toBe("quit");
  });

  it("Ctrl-C (\\u0003) cancels without confirming", () => {
    const state = createMenuState(true);
    const update = applyMenuKey(state, "\u0003");
    expect(update.outcome).toBe("cancel");
  });

  it("Esc (\\u001b) cancels without confirming", () => {
    const state = createMenuState(true);
    const update = applyMenuKey(state, "\u001b");
    expect(update.outcome).toBe("cancel");
  });

  it("unrecognised keys do not move the cursor and return outcome: continue", () => {
    const state = createMenuState(false);
    const update = applyMenuKey(state, "z");
    expect(update.outcome).toBe("continue");
    expect(update.state.cursor).toBe(state.cursor);
  });

  it("number keys beyond the action range are ignored (e.g. `4` does not pick a row)", () => {
    const state = createMenuState(false);
    const update = applyMenuKey(state, "4");
    expect(update.outcome).toBe("continue");
    expect(update.state.cursor).toBe(state.cursor);
  });
});

describe("main-menu — frame rendering", () => {
  it("renders the three v8.39 menu rows with their labels", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    for (const label of ["Install", "Uninstall", "Quit"]) {
      expect(frame).toContain(label);
    }
  });

  it("first-run frame surfaces the `Install for first-time setup` smart-default hint", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    expect(frame).toContain("no .cclaw/ found — Install for first-time setup");
  });

  it("re-invocation frame surfaces the `Install will reapply assets idempotently` smart-default hint", () => {
    const frame = renderMenuFrame(createMenuState(true), { useColor: false });
    expect(frame).toContain(
      "found existing .cclaw/ — Install will reapply assets idempotently"
    );
  });

  it("places the `>` pointer on the cursor row, not on other rows", () => {
    const state = createMenuState(true); // cursor on `install` (index 0)
    const frame = renderMenuFrame(state, { useColor: false });
    // Menu rows look like: '  > 1  Install      ...' and '    2  Uninstall   ...'.
    // The smart-default hint line is filtered out by requiring the row prefix
    // shape (two-space gutter + pointer slot + space + index digit + two-space gutter).
    const rowMatcher = (index: number, label: string): RegExp =>
      new RegExp(`^  [> ] ${index}  ${label}`, "u");
    const lines = frame.split("\n");
    const installRow = lines.find((line) => rowMatcher(1, "Install").test(line));
    const uninstallRow = lines.find((line) => rowMatcher(2, "Uninstall").test(line));
    expect(installRow, "Install row must be present").toBeDefined();
    expect(uninstallRow, "Uninstall row must be present").toBeDefined();
    expect(installRow!.startsWith("  > ")).toBe(true);
    expect(uninstallRow!.startsWith("    ")).toBe(true);
    expect(uninstallRow!.startsWith("  > ")).toBe(false);
  });

  it("renders the hotkey legend so first-time users discover the controls (v8.39: `1-3` range)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    expect(frame).toContain("Up/Down or k/j to move");
    expect(frame).toContain("1-3 to jump");
    expect(frame).toContain("Enter to confirm");
    expect(frame).toContain("q/Esc/Ctrl-C to quit");
  });

  it("never emits the full-screen clear escape (would wipe the banner above the menu)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: true });
    expect(frame).not.toContain("\u001b[2J");
    expect(frame).not.toContain("\u001b[H");
  });

  it("strips ANSI codes when useColor is false (CI / piped output)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    expect(frame).not.toMatch(/\u001b\[/);
  });
});
