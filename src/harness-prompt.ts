import process from "node:process";
import { HARNESS_IDS, type HarnessId } from "./types.js";
import { colorize, shouldUseColor } from "./ui.js";

const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  opencode: "OpenCode",
  codex: "Codex"
};

const HARNESS_TARGETS: Record<HarnessId, string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  opencode: ".opencode/",
  codex: ".codex/"
};

const HARNESS_DESCRIPTIONS: Record<HarnessId, string> = {
  claude: "Anthropic Claude Code CLI agent",
  cursor: "Cursor IDE agents",
  opencode: "OpenCode terminal agent",
  codex: "OpenAI Codex CLI"
};

export interface PickerState {
  selected: ReadonlySet<HarnessId>;
  cursor: number;
  message?: string;
}

export type PickerOutcome = "confirm" | "cancel" | "continue";

export interface PickerUpdate {
  state: PickerState;
  outcome: PickerOutcome;
}

export function createPickerState(
  preselect: readonly HarnessId[] = [],
  cursor = 0
): PickerState {
  const valid = preselect.filter((id) => HARNESS_IDS.includes(id));
  return {
    selected: new Set<HarnessId>(valid.length > 0 ? valid : ["cursor"]),
    cursor: Math.max(0, Math.min(cursor, HARNESS_IDS.length - 1))
  };
}

export function applyKey(state: PickerState, key: string): PickerUpdate {
  if (key === "\u0003" || key === "\u001b") {
    return { state: { ...state, message: "Cancelled." }, outcome: "cancel" };
  }
  if (key === "\u001b[A" || key === "k" || key === "K") {
    const next = (state.cursor - 1 + HARNESS_IDS.length) % HARNESS_IDS.length;
    return { state: { ...state, cursor: next, message: undefined }, outcome: "continue" };
  }
  if (key === "\u001b[B" || key === "j" || key === "J") {
    const next = (state.cursor + 1) % HARNESS_IDS.length;
    return { state: { ...state, cursor: next, message: undefined }, outcome: "continue" };
  }
  if (key === " ") {
    const current = HARNESS_IDS[state.cursor];
    if (!current) return { state, outcome: "continue" };
    const selected = new Set(state.selected);
    if (selected.has(current)) selected.delete(current);
    else selected.add(current);
    return { state: { ...state, selected, message: undefined }, outcome: "continue" };
  }
  if (key === "a" || key === "A") {
    return {
      state: { ...state, selected: new Set(HARNESS_IDS), message: undefined },
      outcome: "continue"
    };
  }
  if (key === "n" || key === "N") {
    return {
      state: { ...state, selected: new Set<HarnessId>(), message: undefined },
      outcome: "continue"
    };
  }
  if (key === "\r" || key === "\n") {
    if (state.selected.size === 0) {
      return {
        state: { ...state, message: "Select at least one harness." },
        outcome: "continue"
      };
    }
    return { state, outcome: "confirm" };
  }
  return { state, outcome: "continue" };
}

export function selectionToList(state: PickerState): HarnessId[] {
  return HARNESS_IDS.filter((id) => state.selected.has(id));
}

export interface IsInteractiveStreams {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

export function isInteractive(streams: IsInteractiveStreams = {}): boolean {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? process.stdout;
  return Boolean(
    stdin.isTTY === true &&
      stdout.isTTY === true &&
      typeof stdin.setRawMode === "function"
  );
}

export interface PromptOptions {
  detected: readonly HarnessId[];
  preselect?: readonly HarnessId[];
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

/**
 * Pure render of one picker frame. Exposed so tests can assert on layout
 * (column padding, pointer placement, detected/selected hints) without
 * spinning up an interactive TTY.
 *
 * Rendering rules:
 *  - First line: cyan "cclaw — choose harness(es) to install for".
 *  - Each row: pointer (`>` for cursor, ` ` otherwise) · checkbox
 *    (green `[x]` selected, dim `[ ]` empty) · cyan label · dim path ·
 *    optional dim cyan `(detected)` tag · dim description.
 *  - Footer: dim hotkey legend.
 *  - Optional message line (used for "Select at least one harness").
 */
export function renderPickerFrame(
  state: PickerState,
  detected: ReadonlySet<HarnessId>,
  useColor: boolean
): string {
  const labelWidth = HARNESS_IDS.reduce(
    (max, id) => Math.max(max, HARNESS_LABELS[id].length),
    0
  );
  const targetWidth = HARNESS_IDS.reduce(
    (max, id) => Math.max(max, HARNESS_TARGETS[id].length),
    0
  );
  const lines: string[] = [];
  lines.push(colorize("cyan", "cclaw — choose harness(es) to install for", useColor));
  lines.push("");

  for (let index = 0; index < HARNESS_IDS.length; index += 1) {
    const harness = HARNESS_IDS[index]!;
    const isCursor = index === state.cursor;
    const pointer = isCursor ? colorize("cyan", ">", useColor) : " ";
    const checkbox = state.selected.has(harness)
      ? colorize("green", "[x]", useColor)
      : colorize("dim", "[ ]", useColor);
    const label = HARNESS_LABELS[harness].padEnd(labelWidth);
    const target = HARNESS_TARGETS[harness].padEnd(targetWidth);
    const detectedTag = detected.has(harness)
      ? `  ${colorize("cyan", "(detected)", useColor)}`
      : `  ${" ".repeat("(detected)".length)}`;
    const description = colorize("dim", HARNESS_DESCRIPTIONS[harness], useColor);
    const renderedLabel = isCursor ? colorize("cyan", label, useColor) : label;
    const renderedTarget = colorize("dim", target, useColor);
    lines.push(
      `  ${pointer} ${checkbox} ${renderedLabel}  ${renderedTarget}${detectedTag}  ${description}`
    );
  }

  lines.push("");
  lines.push(
    colorize(
      "dim",
      "Up/Down or k/j to move  ·  Space to toggle  ·  a all  ·  n none  ·  Enter to confirm  ·  Esc/Ctrl-C to cancel",
      useColor
    )
  );
  if (state.message) {
    lines.push("");
    lines.push(colorize("yellow", state.message, useColor));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Build the ANSI escape sequence that erases `count` previous lines and
 * leaves the cursor at column 0 of the topmost erased row.
 *
 *  `\u001b[1A` — move cursor up one line, keeping the column.
 *  `\u001b[2K` — clear the entire line cursor sits on, no cursor move.
 *  `\r`        — carriage return (column 0) so the next write starts clean.
 *
 * Returning `""` for `count <= 0` keeps the very first picker render
 * (when there is no previous frame) from emitting a stray `\r` that
 * could nudge the cursor inside an existing line of output above the
 * picker (banner, welcome card).
 */
export function eraseLines(count: number): string {
  if (count <= 0) return "";
  return "\u001b[1A\u001b[2K".repeat(count) + "\r";
}

/**
 * Number of newline-terminated lines a rendered frame string occupies.
 * `renderPickerFrame` always ends each line — including the last — with
 * `\n`, so splitting on `\n` produces `lines + 1` chunks (the trailing
 * empty string after the final newline). We subtract that one back out.
 *
 * Exposed for unit tests; runPicker uses it internally to size the
 * cursor-up + clear-line erasure when it redraws or cleans up.
 */
export function frameLineCount(frame: string): number {
  if (frame.length === 0) return 0;
  const parts = frame.split("\n");
  return parts.length - 1;
}

export async function runPicker(options: PromptOptions): Promise<HarnessId[]> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const useColor = shouldUseColor(stdout);
  const detectedSet = new Set<HarnessId>(options.detected);
  const initial = options.preselect && options.preselect.length > 0 ? options.preselect : options.detected;
  let state = createPickerState(initial);

  const wasRaw = Boolean(stdin.isRaw);
  let lastFrameHeight = 0;

  const renderFrame = (): void => {
    if (lastFrameHeight > 0) {
      stdout.write(eraseLines(lastFrameHeight));
    }
    const frame = renderPickerFrame(state, detectedSet, useColor);
    stdout.write(frame);
    lastFrameHeight = frameLineCount(frame);
  };

  return new Promise<HarnessId[]>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      // Erase the picker frame entirely so it does not pollute the terminal
      // scrollback. Whatever was on screen above the picker (banner,
      // welcome card) stays where it is; install progress lines start
      // immediately after, with no stale picker leftovers in between.
      if (lastFrameHeight > 0) {
        stdout.write(eraseLines(lastFrameHeight));
        lastFrameHeight = 0;
      }
      stdin.off("data", onData);
      try {
        stdin.setRawMode?.(wasRaw);
      } catch {
        // ignore — terminal might already be torn down
      }
      if (!wasRaw) stdin.pause();
    };

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      const key = chunk.toString("utf8");
      const update = applyKey(state, key);
      state = update.state;
      renderFrame();
      if (update.outcome === "confirm") {
        settled = true;
        cleanup();
        resolve(selectionToList(state));
        return;
      }
      if (update.outcome === "cancel") {
        settled = true;
        cleanup();
        reject(new Error("Harness selection cancelled."));
      }
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
