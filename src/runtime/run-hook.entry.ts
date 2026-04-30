import {
  nodeHookRuntimeScript,
  type NodeHookRuntimeOptions
} from "../content/node-hooks.js";

export function buildRunHookRuntimeScript(
  options: NodeHookRuntimeOptions = {}
): string {
  return nodeHookRuntimeScript(options);
}

export default buildRunHookRuntimeScript;
