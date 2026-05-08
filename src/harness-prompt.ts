import process from "node:process";
import { HARNESS_IDS, type HarnessId } from "./types.js";

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

function renderFrame(
  state: PickerState,
  detected: ReadonlySet<HarnessId>,
  stdout: NodeJS.WriteStream
): void {
  stdout.write("\u001b[2J\u001b[H");
  stdout.write("cclaw — choose harness(es) to install for\n\n");
  HARNESS_IDS.forEach((harness, index) => {
    const pointer = index === state.cursor ? ">" : " ";
    const checked = state.selected.has(harness) ? "x" : " ";
    const tag = detected.has(harness) ? "  (detected)" : "";
    stdout.write(
      `  ${pointer} [${checked}] ${HARNESS_LABELS[harness].padEnd(12)} ${HARNESS_TARGETS[harness]}${tag}\n`
    );
  });
  stdout.write(
    "\nUp/Down or k/j to move  ·  Space to toggle  ·  a all  ·  n none  ·  Enter to confirm  ·  Esc/Ctrl-C to cancel\n"
  );
  if (state.message) stdout.write(`\n${state.message}\n`);
}

export async function runPicker(options: PromptOptions): Promise<HarnessId[]> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const detectedSet = new Set<HarnessId>(options.detected);
  const initial = options.preselect && options.preselect.length > 0 ? options.preselect : options.detected;
  let state = createPickerState(initial);

  const wasRaw = Boolean(stdin.isRaw);

  return new Promise<HarnessId[]>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode?.(wasRaw);
      } catch {
        // ignore — terminal might already be torn down
      }
      if (!wasRaw) stdin.pause();
      stdout.write("\n");
    };

    const onData = (chunk: Buffer): void => {
      if (settled) return;
      const key = chunk.toString("utf8");
      const update = applyKey(state, key);
      state = update.state;
      renderFrame(state, detectedSet, stdout);
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
      renderFrame(state, detectedSet, stdout);
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
