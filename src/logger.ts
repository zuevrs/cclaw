type Stream = NodeJS.WriteStream | { write: (chunk: string) => unknown };

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
