import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runPicker } from "../../src/harness-prompt.js";
import type { HarnessId } from "../../src/types.js";

class FakeStdin extends EventEmitter {
  public isRaw = false;
  public isTTY = true;
  public setRawMode(value: boolean): void {
    this.isRaw = value;
  }
  public resume(): void {}
  public pause(): void {}
  public off(event: string, listener: (...args: unknown[]) => void): this {
    this.removeListener(event, listener);
    return this;
  }
}

class FakeStdout {
  public buffer = "";
  public isTTY = true;
  write(chunk: string): boolean {
    this.buffer += chunk;
    return true;
  }
}

function send(stdin: FakeStdin, key: string): void {
  setImmediate(() => stdin.emit("data", Buffer.from(key, "utf8")));
}

describe("runPicker (integration)", () => {
  it("Enter on default selection (cursor pre-selected) confirms with cursor", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const promise = runPicker({
      detected: ["cursor"],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream
    });
    send(stdin, "\r");
    const harnesses = await promise;
    expect(harnesses).toEqual<HarnessId[]>(["cursor"]);
    expect(stdout.buffer).toContain("Cursor");
    expect(stdout.buffer).toContain("(detected)");
  });

  it("'a' then Enter selects all four harnesses", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const promise = runPicker({
      detected: [],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream
    });
    send(stdin, "a");
    send(stdin, "\r");
    const harnesses = await promise;
    expect(harnesses).toEqual<HarnessId[]>(["claude", "cursor", "opencode", "codex"]);
  });

  it("Esc rejects with a cancellation error", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const promise = runPicker({
      detected: ["cursor"],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream
    });
    send(stdin, "\u001b");
    await expect(promise).rejects.toThrow(/Harness selection cancelled/);
  });

  it("Enter with empty selection re-renders an error and does not resolve until something is chosen", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const promise = runPicker({
      detected: ["cursor"],
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream
    });
    send(stdin, "n");
    send(stdin, "\r");
    setImmediate(() => {
      expect(stdout.buffer).toContain("Select at least one harness.");
      send(stdin, " ");
      send(stdin, "\r");
    });
    const harnesses = await promise;
    expect(harnesses.length).toBeGreaterThan(0);
  });
});
