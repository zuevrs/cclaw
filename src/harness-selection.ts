import { createInterface } from "node:readline/promises";
import process from "node:process";
import { HARNESS_ADAPTERS } from "./harness-adapters.js";
import { HARNESS_IDS, type CliContext, type HarnessId } from "./types.js";

export type HarnessSelectionAnswer =
  | { kind: "accept" }
  | { kind: "all" }
  | { kind: "toggle"; indexes: number[] }
  | { kind: "invalid"; message: string };

export interface HarnessChecklistState {
  choices: readonly HarnessId[];
  selected: readonly HarnessId[];
  cursor: number;
  message?: string;
}

export type HarnessChecklistOutcome = "confirm" | "cancel";

export interface HarnessChecklistUpdate {
  state: HarnessChecklistState;
  outcome?: HarnessChecklistOutcome;
}

export function parseHarnessSelectionAnswer(raw: string, total = HARNESS_IDS.length): HarnessSelectionAnswer {
  const answer = raw.trim().toLowerCase();
  if (answer.length === 0) return { kind: "accept" };
  if (answer === "all") return { kind: "all" };
  if (answer === "none") {
    return { kind: "invalid", message: "Zero harnesses is not supported. Select at least one harness." };
  }
  const parts = answer.split(",").map((part) => part.trim()).filter(Boolean);
  const indexes = parts.map((part) => Number.parseInt(part, 10));
  if (indexes.some((value) => !Number.isInteger(value) || value < 1 || value > total)) {
    return { kind: "invalid", message: `Invalid selection. Use numbers 1-${total}, comma-separated.` };
  }
  return { kind: "toggle", indexes };
}

export function createHarnessChecklistState(
  selected: readonly HarnessId[],
  choices: readonly HarnessId[] = HARNESS_IDS
): HarnessChecklistState {
  const validSelected = choices.filter((harness) => selected.includes(harness));
  return {
    choices,
    selected: validSelected.length > 0 ? validSelected : choices.slice(),
    cursor: 0
  };
}

function moveCursor(state: HarnessChecklistState, delta: number): HarnessChecklistState {
  const next = (state.cursor + delta + state.choices.length) % state.choices.length;
  return { ...state, cursor: next, message: undefined };
}

function toggleCurrent(state: HarnessChecklistState): HarnessChecklistState {
  const current = state.choices[state.cursor];
  if (!current) return state;
  const selected = state.selected.includes(current)
    ? state.selected.filter((harness) => harness !== current)
    : [...state.selected, current];
  return { ...state, selected: state.choices.filter((harness) => selected.includes(harness)), message: undefined };
}

export function updateHarnessChecklistState(
  state: HarnessChecklistState,
  key: string
): HarnessChecklistUpdate {
  if (key === "\u0003" || key === "\u001b") {
    return { state: { ...state, message: "Cancelled." }, outcome: "cancel" };
  }
  if (key === "\u001b[A" || key === "k" || key === "K") {
    return { state: moveCursor(state, -1) };
  }
  if (key === "\u001b[B" || key === "j" || key === "J") {
    return { state: moveCursor(state, 1) };
  }
  if (key === " ") {
    return { state: toggleCurrent(state) };
  }
  if (key === "a" || key === "A") {
    return { state: { ...state, selected: state.choices.slice(), message: undefined } };
  }
  if (key === "\r" || key === "\n") {
    if (state.selected.length === 0) {
      return { state: { ...state, message: "Select at least one harness." } };
    }
    return { state, outcome: "confirm" };
  }
  return { state };
}

function selectedHarnessPreview(harnesses: readonly HarnessId[]): string {
  return harnesses.length > 0 ? harnesses.join(", ") : "none";
}

function harnessLabel(harness: HarnessId): string {
  const adapter = HARNESS_ADAPTERS[harness];
  const tier = adapter ? `${adapter.reality.declaredSupport}, ${adapter.capabilities.hookSurface} hooks` : "supported";
  return `${harness} (${tier})`;
}

function renderChecklist(
  state: HarnessChecklistState,
  defaults: { detectedHarnesses?: HarnessId[]; currentHarnesses?: HarnessId[]; defaultHarnesses?: HarnessId[] },
  ctx: CliContext,
  label: string
): void {
  const detected = new Set(defaults.detectedHarnesses ?? []);
  const current = new Set(defaults.currentHarnesses ?? []);
  const defaultSet = new Set(defaults.defaultHarnesses ?? []);
  ctx.stdout.write("\x1b[2J\x1b[H");
  ctx.stdout.write(`${label}\n`);
  ctx.stdout.write(`Detected: ${selectedHarnessPreview(defaults.detectedHarnesses ?? [])}\n`);
  ctx.stdout.write(`Current: ${selectedHarnessPreview(defaults.currentHarnesses ?? [])}\n`);
  ctx.stdout.write("Use Up/Down or k/j to move, Space to toggle, a to select all, Enter to confirm, Esc to cancel.\n\n");
  state.choices.forEach((harness, index) => {
    const adapter = HARNESS_ADAPTERS[harness];
    const markers = [
      detected.has(harness) ? "detected" : "",
      current.has(harness) ? "current" : "",
      defaultSet.has(harness) ? "default" : ""
    ].filter(Boolean).join(", ");
    const pointer = index === state.cursor ? ">" : " ";
    const checked = state.selected.includes(harness) ? "x" : " ";
    ctx.stdout.write(
      `${pointer} [${checked}] ${harnessLabel(harness)} -> ${adapter.commandDir}${markers ? ` (${markers})` : ""}\n`
    );
  });
  if (state.message) {
    ctx.stdout.write(`\n${state.message}\n`);
  }
}

function rawModeAvailable(ctx: CliContext): boolean {
  return Boolean(
    process.stdin.isTTY &&
    ctx.stdout.isTTY &&
    typeof process.stdin.setRawMode === "function"
  );
}

async function promptHarnessSelectionRaw(
  defaults: { harnesses: HarnessId[]; detectedHarnesses?: HarnessId[]; currentHarnesses?: HarnessId[] },
  ctx: CliContext,
  label: string
): Promise<HarnessId[]> {
  let state = createHarnessChecklistState(defaults.harnesses);
  const input = process.stdin;
  const wasRaw = Boolean(input.isRaw);
  let settle: ((value: HarnessId[]) => void) | undefined;
  let rejectSelection: ((error: Error) => void) | undefined;
  const done = new Promise<HarnessId[]>((resolve, reject) => {
    settle = resolve;
    rejectSelection = reject;
  });

  const onData = (chunk: Buffer): void => {
    const key = chunk.toString("utf8");
    const update = updateHarnessChecklistState(state, key);
    state = update.state;
    renderChecklist(state, {
      detectedHarnesses: defaults.detectedHarnesses,
      currentHarnesses: defaults.currentHarnesses,
      defaultHarnesses: defaults.harnesses
    }, ctx, label);
    if (update.outcome === "confirm") {
      settle?.(HARNESS_IDS.filter((harness) => state.selected.includes(harness)));
    } else if (update.outcome === "cancel") {
      rejectSelection?.(new Error("Harness selection cancelled."));
    }
  };

  try {
    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
    renderChecklist(state, {
      detectedHarnesses: defaults.detectedHarnesses,
      currentHarnesses: defaults.currentHarnesses,
      defaultHarnesses: defaults.harnesses
    }, ctx, label);
    return await done;
  } finally {
    input.off("data", onData);
    input.setRawMode?.(wasRaw);
    if (!wasRaw) input.pause();
    ctx.stdout.write("\n");
  }
}

async function promptHarnessSelectionText(
  defaults: { harnesses: HarnessId[]; detectedHarnesses?: HarnessId[]; currentHarnesses?: HarnessId[] },
  ctx: CliContext,
  label: string
): Promise<HarnessId[]> {
  const rl = createInterface({
    input: process.stdin,
    output: ctx.stdout
  });

  const defaultSet = new Set(defaults.harnesses);
  const selected = new Set<HarnessId>(defaults.harnesses.length > 0 ? defaults.harnesses : HARNESS_IDS);
  const detected = new Set(defaults.detectedHarnesses ?? []);
  const current = new Set(defaults.currentHarnesses ?? []);

  const printMenu = (): void => {
    ctx.stdout.write(`\n${label}\n`);
    ctx.stdout.write(`Detected: ${selectedHarnessPreview(defaults.detectedHarnesses ?? [])}\n`);
    ctx.stdout.write(`Current: ${selectedHarnessPreview(defaults.currentHarnesses ?? [])}\n`);
    ctx.stdout.write("Supported harnesses and target paths:\n");
    HARNESS_IDS.forEach((harness, index) => {
      const adapter = HARNESS_ADAPTERS[harness];
      const markers = [
        detected.has(harness) ? "detected" : "",
        current.has(harness) ? "current" : "",
        defaultSet.has(harness) ? "default" : ""
      ].filter(Boolean).join(", ");
      const checked = selected.has(harness) ? "x" : " ";
      ctx.stdout.write(
        `  ${index + 1}. [${checked}] ${harnessLabel(harness)} -> ${adapter.commandDir}${markers ? ` (${markers})` : ""}\n`
      );
    });
    ctx.stdout.write("Enter numbers to toggle (for example 1,3), 'all', or press Enter to accept.\n");
  };

  try {
    while (true) {
      printMenu();
      const answer = await rl.question(`Selected [${[...selected].join(",") || "select at least one"}]: `);
      const parsedAnswer = parseHarnessSelectionAnswer(answer);
      if (parsedAnswer.kind === "accept") {
        if (selected.size === 0) {
          ctx.stdout.write("Select at least one harness.\n");
          continue;
        }
        return HARNESS_IDS.filter((harness) => selected.has(harness));
      }
      if (parsedAnswer.kind === "all") {
        HARNESS_IDS.forEach((harness) => selected.add(harness));
        continue;
      }
      if (parsedAnswer.kind === "invalid") {
        ctx.stdout.write(`${parsedAnswer.message}\n`);
        continue;
      }
      for (const index of parsedAnswer.indexes) {
        const harness = HARNESS_IDS[index - 1];
        if (!harness) continue;
        if (selected.has(harness)) selected.delete(harness);
        else selected.add(harness);
      }
    }
  } finally {
    rl.close();
  }
}

export async function promptHarnessSelectionChecklist(
  defaults: { harnesses: HarnessId[]; detectedHarnesses?: HarnessId[]; currentHarnesses?: HarnessId[] },
  ctx: CliContext,
  label = "Harness selection"
): Promise<HarnessId[]> {
  if (rawModeAvailable(ctx)) {
    return promptHarnessSelectionRaw(defaults, ctx, label);
  }
  return promptHarnessSelectionText(defaults, ctx, label);
}
