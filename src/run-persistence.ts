import fs from "node:fs/promises";
import path from "node:path";
import { FLOW_STATE_REL_PATH, RUNTIME_ROOT } from "./constants.js";
import {
  assertFlowStateV8,
  createInitialFlowStateV8,
  type FlowStateV8
} from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";

export function flowStatePath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REL_PATH);
}

export async function ensureRunSystem(projectRoot: string): Promise<void> {
  await ensureDir(path.join(projectRoot, RUNTIME_ROOT, "state"));
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    await writeFlowState(projectRoot, createInitialFlowStateV8());
  }
}

export async function readFlowState(projectRoot: string): Promise<FlowStateV8> {
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    const initial = createInitialFlowStateV8();
    await writeFlowState(projectRoot, initial);
    return initial;
  }
  const raw = await fs.readFile(statePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertFlowStateV8(parsed);
  return parsed;
}

export async function writeFlowState(projectRoot: string, state: FlowStateV8): Promise<void> {
  assertFlowStateV8(state);
  await writeFileSafe(flowStatePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`);
}

export async function resetFlowState(projectRoot: string): Promise<void> {
  await writeFlowState(projectRoot, createInitialFlowStateV8());
}

export async function patchFlowState(
  projectRoot: string,
  patch: Partial<FlowStateV8>
): Promise<FlowStateV8> {
  const current = await readFlowState(projectRoot);
  const next: FlowStateV8 = { ...current, ...patch };
  await writeFlowState(projectRoot, next);
  return next;
}
