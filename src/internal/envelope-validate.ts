import fs from "node:fs/promises";
import type { Writable } from "node:stream";
import { parseSkillEnvelope, validateSkillEnvelope } from "../content/stage-schema.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface EnvelopeValidateArgs {
  json?: string;
  file?: string;
  stdin: boolean;
  quiet: boolean;
}

function parseArgs(tokens: string[]): EnvelopeValidateArgs {
  const args: EnvelopeValidateArgs = { stdin: false, quiet: false };
  for (const token of tokens) {
    if (token === "--stdin") {
      args.stdin = true;
      continue;
    }
    if (token === "--quiet") {
      args.quiet = true;
      continue;
    }
    if (token.startsWith("--json=")) {
      args.json = token.replace("--json=", "");
      continue;
    }
    if (token.startsWith("--file=")) {
      args.file = token.replace("--file=", "");
      continue;
    }
    throw new Error(`Unknown flag for envelope-validate: ${token}`);
  }
  return args;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runEnvelopeValidateCommand(
  _projectRoot: string,
  tokens: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(tokens);
  let raw = "";

  if (args.json !== undefined) {
    raw = args.json;
  } else if (args.file !== undefined) {
    raw = await fs.readFile(args.file, "utf8");
  } else if (args.stdin) {
    raw = await readStdin();
  } else {
    throw new Error("Provide one source: --json=<payload> | --file=<path> | --stdin");
  }

  const parsed = parseSkillEnvelope(raw);
  if (parsed) {
    if (!args.quiet) {
      io.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    }
    return 0;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    io.stderr.write(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const validation = validateSkillEnvelope(candidate);
  io.stderr.write(`Invalid envelope: ${validation.errors.join(" ")}\n`);
  return 1;
}
