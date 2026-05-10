type Stream = NodeJS.WriteStream | { write: (chunk: string) => unknown; isTTY?: boolean };

let stdout: Stream = process.stdout;
let stderr: Stream = process.stderr;

export function configureLogger(out: Stream, err: Stream): void {
  stdout = out;
  stderr = err;
}

export function info(message: string): void {
  stdout.write(`${message}\n`);
}

export function warn(message: string): void {
  stderr.write(`${message}\n`);
}

export function error(message: string): void {
  stderr.write(`${message}\n`);
}

/**
 * Write the chunk verbatim to stdout — no trailing newline added.
 *
 * Used by the banner / progress / summary renderers in `ui.ts` because
 * those build multi-line strings that already terminate with `\n`. Going
 * through `info()` would double the trailing newline and create spurious
 * blank lines between sections.
 */
export function writeOut(chunk: string): void {
  stdout.write(chunk);
}

/**
 * Return the configured stdout stream. Callers use this to read
 * `isTTY` for `shouldUseColor` decisions without importing the
 * underlying `process.stdout` (which would skip the test harness's
 * captured stream).
 */
export function getStdout(): Stream {
  return stdout;
}
