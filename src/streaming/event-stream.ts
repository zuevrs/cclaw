import fs from "node:fs/promises";

export const DEFAULT_SLICE_STREAM_REL_PATH = ".cclaw/state/slice-builder-stream.jsonl";

export interface SliceBuilderPhaseEvent {
  event: "phase-completed";
  runId?: string;
  stage?: string;
  sliceId: string;
  phase: string;
  spanId?: string;
  refactorOutcome?: { mode?: string };
}

export interface EventStreamParseResult {
  events: SliceBuilderPhaseEvent[];
  droppedLines: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseEventLine(rawLine: string): SliceBuilderPhaseEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.event !== "phase-completed") return null;
  const sliceId = asString(parsed.sliceId);
  const phase = asString(parsed.phase);
  if (!sliceId || !phase) return null;
  const stage = asString(parsed.stage);
  const runId = asString(parsed.runId);
  const spanId = asString(parsed.spanId);
  const refactorOutcome = isRecord(parsed.refactorOutcome)
    ? { mode: asString(parsed.refactorOutcome.mode) }
    : undefined;
  return {
    event: "phase-completed",
    ...(runId ? { runId } : {}),
    ...(stage ? { stage } : {}),
    sliceId,
    phase,
    ...(spanId ? { spanId } : {}),
    ...(refactorOutcome ? { refactorOutcome } : {})
  };
}

/**
 * Incremental JSONL parser with bounded in-memory buffer. If chunks arrive
 * faster than the consumer drains complete lines, we trim the oldest partial
 * payload once maxBufferBytes is exceeded instead of letting memory grow
 * unbounded.
 */
export class EventStreamLineBuffer {
  private buffer = "";

  constructor(private readonly maxBufferBytes = 256 * 1024) {}

  push(chunk: string | Buffer): EventStreamParseResult {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let droppedLines = 0;
    if (this.buffer.length > this.maxBufferBytes) {
      const overflowStart = this.buffer.length - this.maxBufferBytes;
      const nextBreak = this.buffer.indexOf("\n", overflowStart);
      if (nextBreak >= 0) {
        this.buffer = this.buffer.slice(nextBreak + 1);
      } else {
        this.buffer = "";
      }
      droppedLines += 1;
    }

    const events: SliceBuilderPhaseEvent[] = [];
    let newlineIdx = this.buffer.indexOf("\n");
    while (newlineIdx >= 0) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        const parsed = parseEventLine(line);
        if (parsed) events.push(parsed);
        else droppedLines += 1;
      }
      newlineIdx = this.buffer.indexOf("\n");
    }

    return { events, droppedLines };
  }

  flush(): EventStreamParseResult {
    if (this.buffer.trim().length === 0) {
      this.buffer = "";
      return { events: [], droppedLines: 0 };
    }
    const parsed = parseEventLine(this.buffer.trim());
    this.buffer = "";
    if (parsed) {
      return { events: [parsed], droppedLines: 0 };
    }
    return { events: [], droppedLines: 1 };
  }
}

export function parseEventStreamText(raw: string): EventStreamParseResult {
  const buffer = new EventStreamLineBuffer();
  const pushed = buffer.push(raw);
  const flushed = buffer.flush();
  return {
    events: [...pushed.events, ...flushed.events],
    droppedLines: pushed.droppedLines + flushed.droppedLines
  };
}

export async function readEventStreamFile(
  absPath: string
): Promise<EventStreamParseResult> {
  let raw = "";
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch {
    return { events: [], droppedLines: 0 };
  }
  return parseEventStreamText(raw);
}
