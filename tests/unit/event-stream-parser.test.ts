import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EventStreamLineBuffer,
  parseEventStreamText,
  readEventStreamFile
} from "../../src/streaming/event-stream.js";
import { createTempProject } from "../helpers/index.js";

describe("streaming event parser", () => {
  it("parses valid phase-completed JSONL lines across chunk boundaries", () => {
    const parser = new EventStreamLineBuffer();
    const partA = parser.push(
      "{\"event\":\"phase-completed\",\"stage\":\"tdd\",\"sliceId\":\"S-1\",\"phase\":\"red\""
    );
    expect(partA.events).toEqual([]);
    expect(partA.droppedLines).toBe(0);

    const partB = parser.push(
      ",\"spanId\":\"span-1\"}\n{\"event\":\"phase-completed\",\"sliceId\":\"S-1\",\"phase\":\"green\",\"refactorOutcome\":{\"mode\":\"inline\"}}\n"
    );
    expect(partB.droppedLines).toBe(0);
    expect(partB.events.map((event) => event.phase)).toEqual(["red", "green"]);
  });

  it("drops malformed or unsupported lines", () => {
    const result = parseEventStreamText(
      [
        "{\"event\":\"phase-completed\",\"sliceId\":\"S-2\",\"phase\":\"doc\"}",
        "not-json",
        "{\"event\":\"unknown\",\"sliceId\":\"S-2\",\"phase\":\"green\"}"
      ].join("\n")
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.phase).toBe("doc");
    expect(result.droppedLines).toBe(2);
  });

  it("applies bounded buffering for oversized chunks", () => {
    const parser = new EventStreamLineBuffer(120);
    const overflow = parser.push("x".repeat(200));
    expect(overflow.events).toEqual([]);
    expect(overflow.droppedLines).toBe(1);

    const next = parser.push(
      "{\"event\":\"phase-completed\",\"sliceId\":\"S-3\",\"phase\":\"refactor\"}\n"
    );
    expect(next.events).toHaveLength(1);
    expect(next.events[0]?.sliceId).toBe("S-3");
  });

  it("reads and parses stream JSONL files", async () => {
    const root = await createTempProject("event-stream-parser-file");
    const streamPath = path.join(root, ".cclaw/state/slice-builder-stream.jsonl");
    await fs.mkdir(path.dirname(streamPath), { recursive: true });
    await fs.writeFile(
      streamPath,
      "{\"event\":\"phase-completed\",\"runId\":\"run-1\",\"stage\":\"tdd\",\"sliceId\":\"S-4\",\"phase\":\"refactor-deferred\"}\n",
      "utf8"
    );

    const parsed = await readEventStreamFile(streamPath);
    expect(parsed.droppedLines).toBe(0);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.sliceId).toBe("S-4");
  });
});
