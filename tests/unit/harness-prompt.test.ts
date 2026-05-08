import { describe, expect, it } from "vitest";
import {
  applyKey,
  createPickerState,
  isInteractive,
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
