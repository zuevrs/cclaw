/**
 * Registry of sandbox-confined tools used by the Tier B with-tools agent.
 *
 * The registry order defines the advertised schema order in the
 * function-calling payload. Keeping it stable means judges reading
 * generated traces can rely on predictable tool descriptions.
 */
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import type { SandboxTool } from "./types.js";
import { writeTool } from "./write.js";

export { SandboxTool, ToolResult, ToolContext, truncatePayload } from "./types.js";

export const BUILTIN_TOOLS: SandboxTool[] = [readTool, writeTool, globTool, grepTool];

/** Build a lookup for the agent loop. */
export function toolsByName(tools: SandboxTool[] = BUILTIN_TOOLS): Map<string, SandboxTool> {
  const map = new Map<string, SandboxTool>();
  for (const tool of tools) {
    if (map.has(tool.descriptor.name)) {
      throw new Error(`duplicate tool name: ${tool.descriptor.name}`);
    }
    map.set(tool.descriptor.name, tool);
  }
  return map;
}

/** Shape a tool list for OpenAI-style `tools[]` in the chat request. */
export function toolsForRequest(tools: SandboxTool[] = BUILTIN_TOOLS): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.descriptor.name,
      description: tool.descriptor.description,
      parameters: tool.descriptor.parameters
    }
  }));
}
