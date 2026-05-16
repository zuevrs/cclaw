/**
 * top-level TUI menu for `cclaw` invoked with no args.
 *
 * Mirrors the `harness-prompt.ts` pattern: a pure-state reducer
 * (`applyMenuKey`), a pure-render frame builder (`renderMenuFrame`), and
 * a thin raw-mode TTY runner (`runMainMenu`) wrapped around them. Tests
 * never spin up a real TTY — they exercise the reducer + render
 * directly via the unit-test entry points.
 *
 * The menu is single-shot: the operator picks one action, that action
 * runs to completion, and the process exits. The menu does NOT re-open
 * after each action. Rationale: every action either (a) writes to the
 * project (`install` / `uninstall`) or (b) quits. After (a) the
 * operator's next intent is "look at the output and decide", not "pick
 * something else from the menu". Re-opening after a write would also
 * re-render the banner over the install progress lines, which is ugly.
 *
 * collapsed from 7 actions to 3 (`install` / `uninstall` /
 * `quit`). `sync` and `upgrade` were functionally aliases for `install`
 * (all three routed through the same idempotent installer with orphan
 * cleanup); the intent-naming benefit didn't justify the cognitive
 * overhead of three near-identical rows that did the same thing.
 * `knowledge` and `version` were read-only utilities power users invoke
 * via `cclaw --non-interactive knowledge` / `cclaw --version`; surfacing
 * them in the TUI added noise without a write-side use case.
 */

import process from "node:process";
import { colorize, shouldUseColor } from "./ui.js";

export const MENU_ACTIONS = ["install", "uninstall", "quit"] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

const MENU_LABELS: Record<MenuAction, string> = {
  install: "Install",
  uninstall: "Uninstall",
  quit: "Quit"
};

const MENU_DESCRIPTIONS: Record<MenuAction, string> = {
  install: "first-time setup OR idempotent reapply (covers former sync/upgrade)",
  uninstall: "remove .cclaw/ + harness assets",
  quit: "exit without doing anything"
};

export interface MenuState {
  cursor: number;
  /**
   * Whether `.cclaw/config.yaml` exists. Drives the smart-default hint
   * line above the menu rows. Both states land the cursor on `install`
   * (collapse): on a fresh project `install` is first-time setup,
   * on an installed project `install` is the idempotent reapply that
   * used to be called `sync` / `upgrade`. The same row, two readings.
   */
  installed: boolean;
}

export type MenuOutcome = "confirm" | "cancel" | "continue";

export interface MenuUpdate {
  state: MenuState;
  outcome: MenuOutcome;
}

/**
 * Build the initial menu state. The cursor always lands on `install`:
 * on a fresh project it's first-time setup, on an existing install it's
 * the idempotent reapply (the collapse renamed sync/upgrade to
 * install at the CLI surface; finishes the rename at the TUI
 * surface). The `installed` flag drives only the smart-default hint
 * line above the menu rows — the row itself is the same in both cases.
 */
export function createMenuState(installed: boolean): MenuState {
  const cursor = MENU_ACTIONS.indexOf("install");
  return { cursor, installed };
}

export function applyMenuKey(state: MenuState, key: string): MenuUpdate {
  // Ctrl-C / Esc cancel the menu without picking any action.
  if (key === "\u0003" || key === "\u001b") {
    return { state, outcome: "cancel" };
  }
  if (key === "\u001b[A" || key === "k" || key === "K") {
    const next = (state.cursor - 1 + MENU_ACTIONS.length) % MENU_ACTIONS.length;
    return { state: { ...state, cursor: next }, outcome: "continue" };
  }
  if (key === "\u001b[B" || key === "j" || key === "J") {
    const next = (state.cursor + 1) % MENU_ACTIONS.length;
    return { state: { ...state, cursor: next }, outcome: "continue" };
  }
  // Number shortcut: `1` jumps to row 0, `2` to row 1, etc. Saves a
  // couple keystrokes for operators who know the menu by heart.
  if (key >= "1" && key <= String(MENU_ACTIONS.length)) {
    const index = Number(key) - 1;
    return { state: { ...state, cursor: index }, outcome: "continue" };
  }
  if (key === "q" || key === "Q") {
    const quitIndex = MENU_ACTIONS.indexOf("quit");
    return { state: { ...state, cursor: quitIndex }, outcome: "confirm" };
  }
  if (key === "\r" || key === "\n") {
    return { state, outcome: "confirm" };
  }
  return { state, outcome: "continue" };
}

export function selectedAction(state: MenuState): MenuAction {
  return MENU_ACTIONS[state.cursor] ?? "quit";
}

export interface RenderMenuOptions {
  useColor: boolean;
}

/**
 * Pure render of one menu frame. Exposed for unit tests so the layout
 * (row order, smart-default hint, hotkey legend) can be asserted on
 * without spinning up a TTY. `runMainMenu` calls this internally.
 */
export function renderMenuFrame(state: MenuState, options: RenderMenuOptions): string {
  const { useColor } = options;
  const labelWidth = MENU_ACTIONS.reduce(
    (max, id) => Math.max(max, MENU_LABELS[id].length),
    0
  );
  const lines: string[] = [];
  lines.push(colorize("cyan", "cclaw — what would you like to do?", useColor));
  const smartDefault = state.installed
    ? "found existing .cclaw/ — Install will reapply assets idempotently"
    : "no .cclaw/ found — Install for first-time setup";
  lines.push(colorize("dim", smartDefault, useColor));
  lines.push("");

  for (let index = 0; index < MENU_ACTIONS.length; index += 1) {
    const action = MENU_ACTIONS[index]!;
    const isCursor = index === state.cursor;
    const pointer = isCursor ? colorize("cyan", ">", useColor) : " ";
    const numberKey = colorize("dim", `${index + 1}`, useColor);
    const label = MENU_LABELS[action].padEnd(labelWidth);
    const description = colorize("dim", MENU_DESCRIPTIONS[action], useColor);
    const renderedLabel = isCursor ? colorize("cyan", label, useColor) : label;
    lines.push(`  ${pointer} ${numberKey}  ${renderedLabel}  ${description}`);
  }

  lines.push("");
  // Hotkey range stays in sync with MENU_ACTIONS.length so future tweaks
  // to the action list don't leave the legend stale (lesson:
  // hardcoded `1-7` survived the collapse and lied to users until
  // someone noticed). 3 actions → "1-3"; if the menu grows again the
  // legend updates automatically.
  const numberRange = `1-${MENU_ACTIONS.length}`;
  lines.push(
    colorize(
      "dim",
      `Up/Down or k/j to move  ·  ${numberRange} to jump  ·  Enter to confirm  ·  q/Esc/Ctrl-C to quit`,
      useColor
    )
  );
  return `${lines.join("\n")}\n`;
}

/**
 * Erase the `\u001b[1A\u001b[2K`-style escape sequence for `count`
 * previous lines so the next frame redraws over the previous one
 * without scrollback pollution. Mirrors `eraseLines` in
 * `harness-prompt.ts` — kept module-local so the two TUI surfaces stay
 * independent.
 */
function eraseLines(count: number): string {
  if (count <= 0) return "";
  return "\u001b[1A\u001b[2K".repeat(count) + "\r";
}

function frameLineCount(frame: string): number {
  if (frame.length === 0) return 0;
  return frame.split("\n").length - 1;
}

export interface RunMenuOptions {
  installed: boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

/**
 * Spin up the raw-mode TTY loop and resolve with the action the
 * operator selected. Rejects with `MENU_CANCELLED` when the operator
 * presses Esc / Ctrl-C without selecting (the CLI maps that rejection
 * to a clean exit 0 — cancellation is not an error).
 *
 * The frame is erased on resolve so the next stdout write (banner for
 * the dispatched action, or the goodbye message on quit) starts at a
 * clean row.
 */
export const MENU_CANCELLED = "MENU_CANCELLED";

export async function runMainMenu(options: RunMenuOptions): Promise<MenuAction> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const useColor = shouldUseColor(stdout);
  let state = createMenuState(options.installed);
  const wasRaw = Boolean(stdin.isRaw);
  let lastFrameHeight = 0;

  const renderFrame = (): void => {
    if (lastFrameHeight > 0) {
      stdout.write(eraseLines(lastFrameHeight));
    }
    const frame = renderMenuFrame(state, { useColor });
    stdout.write(frame);
    lastFrameHeight = frameLineCount(frame);
  };

  return new Promise<MenuAction>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      if (lastFrameHeight > 0) {
        stdout.write(eraseLines(lastFrameHeight));
        lastFrameHeight = 0;
      }
      stdin.off("data", onData);
      try {
        stdin.setRawMode?.(wasRaw);
      } catch {
        // terminal might already be torn down — best effort restore
      }
      if (!wasRaw) stdin.pause();
    };

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      const key = chunk.toString("utf8");
      const update = applyMenuKey(state, key);
      state = update.state;
      if (update.outcome === "confirm") {
        settled = true;
        cleanup();
        resolve(selectedAction(state));
        return;
      }
      if (update.outcome === "cancel") {
        settled = true;
        cleanup();
        reject(new Error(MENU_CANCELLED));
        return;
      }
      renderFrame();
    };

    try {
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.on("data", onData);
      renderFrame();
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
