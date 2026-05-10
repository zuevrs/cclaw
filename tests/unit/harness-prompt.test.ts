import { describe, expect, it } from "vitest";
import {
  applyKey,
  createPickerState,
  eraseLines,
  frameLineCount,
  isInteractive,
  renderPickerFrame,
  selectionToList,
  type PickerState
} from "../../src/harness-prompt.js";
import { HARNESS_IDS, type HarnessId } from "../../src/types.js";

const ESC = "\u001b";
const CTRL_C = "\u0003";
const ARROW_UP = "\u001b[A";
const ARROW_DOWN = "\u001b[B";

function selectedArray(state: PickerState): HarnessId[] {
  return HARNESS_IDS.filter((id) => state.selected.has(id));
}

describe("harness-prompt: createPickerState", () => {
  it("preselects only valid harnesses and falls back to cursor when preselect is empty", () => {
    const state = createPickerState([]);
    expect(selectedArray(state)).toEqual(["cursor"]);
    expect(state.cursor).toBe(0);
  });

  it("respects preselected harnesses (order normalized to HARNESS_IDS)", () => {
    const state = createPickerState(["claude", "cursor"]);
    expect(selectedArray(state)).toEqual(["claude", "cursor"]);
  });

  it("clamps cursor into valid range", () => {
    const high = createPickerState([], 99);
    expect(high.cursor).toBe(HARNESS_IDS.length - 1);
    const low = createPickerState([], -5);
    expect(low.cursor).toBe(0);
  });

  it("filters out unknown harness ids from preselect", () => {
    const state = createPickerState(["claude", "bogus" as HarnessId]);
    expect(selectedArray(state)).toEqual(["claude"]);
  });
});

describe("harness-prompt: applyKey", () => {
  it("Esc and Ctrl-C produce a cancel outcome", () => {
    const state = createPickerState(["cursor"]);
    expect(applyKey(state, ESC).outcome).toBe("cancel");
    expect(applyKey(state, CTRL_C).outcome).toBe("cancel");
  });

  it("Arrow Down / Arrow Up wrap around", () => {
    let state = createPickerState(["cursor"], HARNESS_IDS.length - 1);
    state = applyKey(state, ARROW_DOWN).state;
    expect(state.cursor).toBe(0);
    state = applyKey(state, ARROW_UP).state;
    expect(state.cursor).toBe(HARNESS_IDS.length - 1);
  });

  it("k/j move the cursor like Up/Down", () => {
    let state = createPickerState(["cursor"], 0);
    state = applyKey(state, "j").state;
    expect(state.cursor).toBe(1);
    state = applyKey(state, "k").state;
    expect(state.cursor).toBe(0);
  });

  it("Space toggles the harness under the cursor", () => {
    let state = createPickerState([], 0);
    expect(state.selected.has("claude")).toBe(false);
    state = applyKey(state, " ").state;
    expect(state.selected.has("claude")).toBe(true);
    state = applyKey(state, " ").state;
    expect(state.selected.has("claude")).toBe(false);
  });

  it("'a' selects all harnesses; 'n' deselects all", () => {
    let state = createPickerState(["cursor"]);
    state = applyKey(state, "a").state;
    expect(selectedArray(state)).toEqual([...HARNESS_IDS]);
    state = applyKey(state, "n").state;
    expect(selectedArray(state)).toEqual([]);
  });

  it("Enter on empty selection records a friendly message and stays in continue", () => {
    let state = createPickerState(["cursor"]);
    state = applyKey(state, "n").state;
    const update = applyKey(state, "\r");
    expect(update.outcome).toBe("continue");
    expect(update.state.message).toMatch(/Select at least one harness/);
  });

  it("Enter on non-empty selection produces confirm", () => {
    const state = createPickerState(["cursor", "claude"]);
    const update = applyKey(state, "\r");
    expect(update.outcome).toBe("confirm");
  });

  it("unknown keys are no-ops (continue, no state mutation)", () => {
    const state = createPickerState(["cursor"]);
    const update = applyKey(state, "z");
    expect(update.outcome).toBe("continue");
    expect(update.state).toBe(state);
  });
});

describe("harness-prompt: selectionToList", () => {
  it("returns selected harnesses in canonical order", () => {
    const state = createPickerState(["codex", "claude"]);
    expect(selectionToList(state)).toEqual(["claude", "codex"]);
  });
});

describe("harness-prompt: renderPickerFrame", () => {
  it("renders header, every harness row, footer hotkeys; cursor row is marked with `>`", () => {
    const state = createPickerState(["cursor"], 0);
    const detected = new Set<HarnessId>(["cursor"]);
    const out = renderPickerFrame(state, detected, false);
    expect(out).toContain("cclaw — choose harness(es) to install for");
    for (const label of ["Claude Code", "Cursor", "OpenCode", "Codex"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain(">");
    expect(out).toContain("(detected)");
    expect(out).toContain("Up/Down or k/j to move");
    expect(out).toContain("Enter to confirm");
  });

  it("plain ASCII when useColor=false (no ANSI escapes)", () => {
    const state = createPickerState(["cursor"], 0);
    const out = renderPickerFrame(state, new Set<HarnessId>(["cursor"]), false);
    expect(out).not.toMatch(/\u001b\[/);
  });

  it("includes ANSI escapes when useColor=true (wraps the cursor row in cyan)", () => {
    const state = createPickerState(["cursor"], 0);
    const out = renderPickerFrame(state, new Set<HarnessId>(["cursor"]), true);
    expect(out).toMatch(/\u001b\[/);
  });

  it("renders [x] for selected harnesses and [ ] for unselected", () => {
    const state = createPickerState(["cursor"], 0);
    const out = renderPickerFrame(state, new Set<HarnessId>(), false);
    expect(out).toContain("[x]");
    expect(out).toContain("[ ]");
  });

  it("renders message line below the legend when state.message is set", () => {
    const base = createPickerState(["cursor"], 0);
    const empty = applyKey(base, "n").state;
    const withMessage = applyKey(empty, "\r").state;
    const out = renderPickerFrame(withMessage, new Set<HarnessId>(), false);
    expect(out).toContain("Select at least one harness.");
  });
});

describe("harness-prompt: eraseLines", () => {
  it("returns empty string for count <= 0 (no-op on first render)", () => {
    expect(eraseLines(0)).toBe("");
    expect(eraseLines(-1)).toBe("");
  });

  it("emits N copies of `\\u001b[1A\\u001b[2K` plus trailing `\\r`", () => {
    expect(eraseLines(1)).toBe("\u001b[1A\u001b[2K\r");
    expect(eraseLines(3)).toBe("\u001b[1A\u001b[2K\u001b[1A\u001b[2K\u001b[1A\u001b[2K\r");
  });

  it("does NOT emit the screen-clear escape `\\u001b[2J` (which would wipe banner/welcome)", () => {
    for (const count of [1, 5, 10, 25]) {
      expect(eraseLines(count)).not.toContain("\u001b[2J");
      expect(eraseLines(count)).not.toContain("\u001b[H");
    }
  });
});

describe("harness-prompt: frameLineCount", () => {
  it("counts newline-terminated lines (last line ends with `\\n`)", () => {
    expect(frameLineCount("a\nb\nc\n")).toBe(3);
    expect(frameLineCount("only-one-line\n")).toBe(1);
  });

  it("returns 0 for empty frame (idempotent erase guard)", () => {
    expect(frameLineCount("")).toBe(0);
  });

  it("matches the line count of an actual rendered picker frame", () => {
    const state = createPickerState(["cursor"], 0);
    const frame = renderPickerFrame(state, new Set<HarnessId>(["cursor"]), false);
    const count = frameLineCount(frame);
    expect(count).toBeGreaterThan(HARNESS_IDS.length);
    expect(frame.split("\n").length - 1).toBe(count);
  });
});

describe("harness-prompt: renderPickerFrame (no screen clear)", () => {
  it("does NOT emit `\\u001b[2J` (full-screen clear) — that would wipe banner/welcome above the picker", () => {
    const state = createPickerState(["cursor"], 0);
    const frame = renderPickerFrame(state, new Set<HarnessId>(["cursor"]), true);
    expect(frame).not.toContain("\u001b[2J");
    expect(frame).not.toContain("\u001b[H");
  });
});

describe("harness-prompt: isInteractive", () => {
  it("returns false when stdin or stdout is not a TTY", () => {
    const stdin = { isTTY: false, setRawMode: () => {} } as unknown as NodeJS.ReadStream;
    const stdout = { isTTY: true } as unknown as NodeJS.WriteStream;
    expect(isInteractive({ stdin, stdout })).toBe(false);
  });

  it("returns false when stdin has no setRawMode", () => {
    const stdin = { isTTY: true } as unknown as NodeJS.ReadStream;
    const stdout = { isTTY: true } as unknown as NodeJS.WriteStream;
    expect(isInteractive({ stdin, stdout })).toBe(false);
  });

  it("returns true when both streams are TTY and stdin supports raw mode", () => {
    const stdin = { isTTY: true, setRawMode: () => {} } as unknown as NodeJS.ReadStream;
    const stdout = { isTTY: true } as unknown as NodeJS.WriteStream;
    expect(isInteractive({ stdin, stdout })).toBe(true);
  });
});
