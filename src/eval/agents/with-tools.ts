/**
 * Multi-turn with-tools agent (agent mode, reused by workflow mode).
 *
 * Multi-turn loop with OpenAI-style function-calling over a set of
 * sandbox-confined tools. The AUT is given:
 *
 *  - System prompt = stage SKILL.md (same contract as the single-shot path
 *    so the baseline is comparable).
 *  - User prompt = task description + a short "tools available" hint
 *    that names the sandbox root and the four built-in tools.
 *  - Tools = `read_file`, `write_file`, `glob`, `grep` (see
 *    `src/eval/tools/`).
 *
 * The loop runs up to `config.toolMaxTurns` turns (default 8). Each
 * turn:
 *
 *  1. Send the current transcript to the model with tools enabled.
 *  2. Commit token usage against the wrapped client (cost guard sees
 *     every call).
 *  3. If the model returned tool_calls, execute each sandbox tool and
 *     append a `role: "tool"` message with the JSON-serialized result.
 *  4. If the model produced assistant content with `finish_reason: stop`,
 *     treat that as the artifact and exit.
 *
 * When the turn budget is exhausted without a terminal stop, the agent
 * throws `MaxTurnsExceededError`. The runner surfaces the error as a
 * failed workflow verifier so the case counts as a regression.
 *
 * Artifact resolution: the final assistant content is the artifact. If
 * the model used `write_file` to stage the artifact at
 * `artifact.md` (or `artifact/<stage>.md`), we prefer that file — it
 * mirrors workflow mode where writes are the deliverable. The
 * fallback is the terminal assistant message so prompts that don't
 * call write_file still produce something judgable.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { computeUsageUsd } from "../cost-guard.js";
import type { ChatMessage, ChatUsage, EvalLlmClient } from "../llm-client.js";
import { createSandbox, type Sandbox } from "../sandbox.js";
import type { SandboxTool } from "../tools/index.js";
import {
  BUILTIN_TOOLS,
  toolsByName,
  toolsForRequest,
  truncatePayload
} from "../tools/index.js";
import type { ToolResult } from "../tools/types.js";
import type {
  EvalCase,
  ResolvedEvalConfig,
  ToolUseSummary
} from "../types.js";
import { loadStageSkill } from "./single-shot.js";

export class MaxTurnsExceededError extends Error {
  readonly turns: number;

  constructor(turns: number) {
    super(`Agent loop exceeded the ${turns}-turn budget without a terminal stop.`);
    this.name = "MaxTurnsExceededError";
    this.turns = turns;
  }
}

export interface WithToolsInput {
  caseEntry: EvalCase;
  config: Pick<
    ResolvedEvalConfig,
    | "model"
    | "agentTemperature"
    | "timeoutMs"
    | "tokenPricing"
    | "toolMaxTurns"
    | "toolMaxArgumentsBytes"
    | "toolMaxResultBytes"
  >;
  projectRoot: string;
  client: EvalLlmClient;
  tools?: SandboxTool[];
  /** Override for the SKILL.md loader (test hook). */
  loadSkill?: (stage: EvalCase["stage"]) => Promise<string>;
  /** Override for the sandbox factory (test hook). */
  createSandboxFn?: typeof createSandbox;
  /**
   * Reuse an externally-managed sandbox instead of creating + disposing a
   * per-call one. Workflow mode uses this so every stage shares the same
   * sandbox and earlier artifacts remain visible. When set, the caller is
   * responsible for `dispose()`.
   */
  externalSandbox?: Sandbox;
  /**
   * Optional override of the default user prompt prefix. Workflow mode uses
   * this to tell the model which stage it is on and where the prior
   * artifacts are located.
   */
  promptPreamble?: string;
}

export interface WithToolsOutput {
  artifact: string;
  usage: ChatUsage;
  usageUsd: number;
  model: string;
  attempts: number;
  durationMs: number;
  toolUse: ToolUseSummary;
  systemPrompt: string;
  userPrompt: string;
}

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_MAX_ARG_BYTES = 64 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 32 * 1024;
const ARTIFACT_CANDIDATES = ["artifact.md", "artifact.txt", "ARTIFACT.md"];

export async function runWithTools(input: WithToolsInput): Promise<WithToolsOutput> {
  const { caseEntry, config, projectRoot, client } = input;
  const maxTurns = clampPositive(config.toolMaxTurns, DEFAULT_MAX_TURNS);
  const maxArgBytes = clampPositive(
    config.toolMaxArgumentsBytes,
    DEFAULT_MAX_ARG_BYTES
  );
  const maxResultBytes = clampPositive(
    config.toolMaxResultBytes,
    DEFAULT_MAX_RESULT_BYTES
  );
  const loader = input.loadSkill ?? ((stage: EvalCase["stage"]) => loadStageSkill(projectRoot, stage));
  const systemPrompt = await loader(caseEntry.stage);
  const tools = input.tools ?? BUILTIN_TOOLS;
  const toolMap = toolsByName(tools);
  const toolsBody = toolsForRequest(tools);
  const sandboxFactory = input.createSandboxFn ?? createSandbox;
  const externalSandbox = input.externalSandbox;

  const sandbox =
    externalSandbox ??
    (await sandboxFactory({
      projectRoot,
      ...(caseEntry.contextFiles ? { contextFiles: caseEntry.contextFiles } : {})
    }));

  const toolUse: ToolUseSummary = {
    turns: 0,
    calls: 0,
    errors: 0,
    deniedPaths: [],
    byTool: {}
  };
  const usage: ChatUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let lastModel = config.model;
  let totalAttempts = 0;

  const userPrompt = buildUserPrompt(
    caseEntry,
    sandbox,
    tools,
    input.promptPreamble
  );
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const started = Date.now();
  try {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      toolUse.turns = turn + 1;
      const response = await client.chat({
        model: config.model,
        messages,
        temperature: config.agentTemperature ?? 0.2,
        timeoutMs: config.timeoutMs,
        tools: toolsBody,
        toolChoice: "auto"
      });
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens += response.usage.totalTokens;
      lastModel = response.model;
      totalAttempts += response.attempts;

      const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
      messages.push(rememberAssistant(response.content, response.toolCalls));

      if (!hasToolCalls) {
        const artifact = await resolveArtifact(sandbox, response.content);
        return finalize(
          artifact,
          usage,
          lastModel,
          totalAttempts,
          started,
          toolUse,
          systemPrompt,
          userPrompt,
          config
        );
      }

      for (const call of response.toolCalls!) {
        const tool = toolMap.get(call.name);
        const argBytes = Buffer.byteLength(call.arguments ?? "", "utf8");
        if (argBytes > maxArgBytes) {
          toolUse.errors += 1;
          bumpToolCount(toolUse, call.name);
          messages.push(
            toolResponseMessage(call.id, {
              ok: false,
              name: call.name,
              error: `arguments payload exceeds ${maxArgBytes} bytes`
            })
          );
          continue;
        }
        if (!tool) {
          toolUse.errors += 1;
          bumpToolCount(toolUse, call.name);
          messages.push(
            toolResponseMessage(call.id, {
              ok: false,
              name: call.name,
              error: `unknown tool "${call.name}"`
            })
          );
          continue;
        }
        bumpToolCount(toolUse, call.name);
        const result = await tool.invoke(call.arguments ?? "", {
          sandbox,
          maxResultBytes
        });
        if (!result.ok) {
          toolUse.errors += 1;
          const denied =
            result.details && typeof result.details.deniedPath === "string"
              ? (result.details.deniedPath as string)
              : undefined;
          if (denied && !toolUse.deniedPaths.includes(denied)) {
            toolUse.deniedPaths.push(denied);
          }
        } else {
          toolUse.calls += 1;
        }
        messages.push(toolResponseMessage(call.id, result));
      }
    }
    throw new MaxTurnsExceededError(maxTurns);
  } finally {
    if (!externalSandbox) await sandbox.dispose();
  }
}

function finalize(
  artifact: string,
  usage: ChatUsage,
  model: string,
  attempts: number,
  started: number,
  toolUse: ToolUseSummary,
  systemPrompt: string,
  userPrompt: string,
  config: Pick<ResolvedEvalConfig, "tokenPricing">
): WithToolsOutput {
  const usageUsd = computeUsageUsd(model, usage, {
    tokenPricing: config.tokenPricing
  });
  return {
    artifact: artifact.trim(),
    usage,
    usageUsd,
    model,
    attempts,
    durationMs: Date.now() - started,
    toolUse,
    systemPrompt,
    userPrompt
  };
}

function rememberAssistant(
  content: string,
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
): ChatMessage {
  const base: ChatMessage = { role: "assistant", content };
  if (toolCalls && toolCalls.length > 0) base.toolCalls = toolCalls;
  return base;
}

function toolResponseMessage(callId: string, result: ToolResult): ChatMessage {
  const payload = result.ok
    ? { ok: true, content: result.content, details: result.details ?? {} }
    : { ok: false, error: result.error, details: result.details ?? {} };
  return {
    role: "tool",
    content: truncatePayload(JSON.stringify(payload), 32 * 1024),
    toolCallId: callId,
    name: result.name
  };
}

function bumpToolCount(summary: ToolUseSummary, name: string): void {
  summary.byTool[name] = (summary.byTool[name] ?? 0) + 1;
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function buildUserPrompt(
  caseEntry: EvalCase,
  sandbox: Sandbox,
  tools: SandboxTool[],
  preamble?: string
): string {
  const toolList = tools.map((t) => `- ${t.descriptor.name}: ${t.descriptor.description}`);
  const files = caseEntry.contextFiles ?? [];
  const contextLines =
    files.length > 0
      ? files.map((f) => `- ${f}`).join("\n")
      : "(no files seeded)";
  const lines: string[] = [];
  if (preamble && preamble.trim().length > 0) {
    lines.push(preamble.trim(), ``);
  }
  lines.push(
    `Stage: ${caseEntry.stage}`,
    `Case id: ${caseEntry.id}`,
    ``
  );
  const rest: string[] = [
    `Sandbox root: ${sandbox.root}`,
    `You may call the following tools to read or modify files inside the sandbox.`,
    `All paths are relative to the sandbox root.`,
    ``,
    `Tools:`,
    ...toolList,
    ``,
    `Seeded context files (available under the sandbox root):`,
    contextLines,
    ``,
    `Task:`,
    caseEntry.inputPrompt.trim(),
    ``,
    `When you are done, reply with the artifact as the final assistant message.`,
    `Output the artifact directly (markdown with optional YAML frontmatter).`,
    `Do not wrap in code fences, do not add commentary before or after.`,
    `You may optionally write the artifact to \`artifact.md\` in the sandbox; ` +
      `if you do, the last written \`artifact.md\` is preferred over the chat reply.`
  ];
  lines.push(...rest);
  return lines.join("\n");
}

async function resolveArtifact(
  sandbox: Sandbox,
  fallback: string
): Promise<string> {
  for (const candidate of ARTIFACT_CANDIDATES) {
    try {
      const abs = await sandbox.resolve(candidate);
      const stat = await fs.stat(abs);
      if (stat.isFile()) {
        return await fs.readFile(abs, "utf8");
      }
    } catch {
      continue;
    }
  }
  try {
    const dir = path.join(sandbox.root);
    const entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
      name: string;
      isFile(): boolean;
    }>;
    const match = entries.find((entry) => entry.isFile() && /^artifact\./i.test(entry.name));
    if (match) {
      return await fs.readFile(path.join(dir, match.name), "utf8");
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}
