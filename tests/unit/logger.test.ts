import { describe, expect, it, vi } from "vitest";
import { error, info } from "../../src/logger.js";
import type { CliContext } from "../../src/types.js";

describe("cli logger helpers", () => {
  it("writes info messages to stdout with cclaw prefix", () => {
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite }
    } as unknown as CliContext;

    info(ctx, "runtime ready");
    expect(stdoutWrite).toHaveBeenCalledWith("[cclaw] runtime ready\n");
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("writes error messages to stderr with cclaw:error prefix", () => {
    const stdoutWrite = vi.fn();
    const stderrWrite = vi.fn();
    const ctx = {
      cwd: process.cwd(),
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite }
    } as unknown as CliContext;

    error(ctx, "invalid config");
    expect(stderrWrite).toHaveBeenCalledWith("[cclaw:error] invalid config\n");
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
