import type { Writable } from "node:stream";
import { selectRelevantLearnings } from "../knowledge-store.js";
import { FLOW_STAGES, type FlowStage } from "../types.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface KnowledgeDigestArgs {
  stage?: FlowStage;
  branch?: string;
  diffFiles: string[];
  openGates: string[];
  limit: number;
  format: "markdown" | "json";
}

function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseKnowledgeDigestArgs(tokens: string[]): KnowledgeDigestArgs {
  const args: KnowledgeDigestArgs = {
    diffFiles: [],
    openGates: [],
    limit: 8,
    format: "markdown"
  };

  for (const token of tokens) {
    if (!token.startsWith("--")) {
      throw new Error(`Unknown positional token for knowledge-digest: ${token}`);
    }
    if (token.startsWith("--stage=")) {
      const value = token.replace("--stage=", "").trim();
      if (!value) continue;
      if (!(FLOW_STAGES as readonly string[]).includes(value)) {
        throw new Error(
          `--stage must be one of: ${FLOW_STAGES.join(", ")}`
        );
      }
      args.stage = value as FlowStage;
      continue;
    }
    if (token.startsWith("--branch=")) {
      const value = token.replace("--branch=", "").trim();
      if (value.length > 0) {
        args.branch = value;
      }
      continue;
    }
    if (token.startsWith("--diff-files=")) {
      args.diffFiles.push(...parseCsv(token.replace("--diff-files=", "")));
      continue;
    }
    if (token.startsWith("--open-gates=")) {
      args.openGates.push(...parseCsv(token.replace("--open-gates=", "")));
      continue;
    }
    if (token.startsWith("--limit=")) {
      const raw = token.replace("--limit=", "").trim();
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      args.limit = value;
      continue;
    }
    if (token === "--json") {
      args.format = "json";
      continue;
    }
    if (token === "--markdown") {
      args.format = "markdown";
      continue;
    }
    throw new Error(`Unknown flag for knowledge-digest: ${token}`);
  }

  return args;
}

function markdownDigest(rows: Awaited<ReturnType<typeof selectRelevantLearnings>>): string {
  if (rows.length === 0) {
    return "(no relevant learnings)";
  }
  return rows
    .map((entry) => {
      const stage = entry.stage ?? "global";
      const domain = entry.domain ?? "general";
      return `- [${entry.confidence} | ${stage} | ${domain}] ${entry.trigger} -> ${entry.action}`;
    })
    .join("\n");
}

export async function runKnowledgeDigestCommand(
  projectRoot: string,
  tokens: string[],
  io: InternalIo
): Promise<number> {
  const args = parseKnowledgeDigestArgs(tokens);
  const rows = await selectRelevantLearnings(projectRoot, {
    stage: args.stage,
    branch: args.branch,
    diffFiles: args.diffFiles,
    openGates: args.openGates,
    limit: args.limit
  });

  if (args.format === "json") {
    io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }

  io.stdout.write(`${markdownDigest(rows)}\n`);
  return 0;
}
