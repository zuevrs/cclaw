import fs from "node:fs/promises";
import path from "node:path";
import { FLOW_STATE_REL_PATH, RUNTIME_ROOT } from "./constants.js";
import {
  assertFlowStateV82,
  createInitialFlowState,
  migrateFlowState,
  type FlowStateV82
} from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";

export function flowStatePath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REL_PATH);
}

export async function ensureRunSystem(projectRoot: string): Promise<void> {
  await ensureDir(path.join(projectRoot, RUNTIME_ROOT, "state"));
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    await writeFlowState(projectRoot, createInitialFlowState());
  }
}

/**
 * Read and validate flow-state.json.
 *
 * v8.0/v8.1 (schemaVersion=2) states are silently auto-migrated to v8.2
 * (schemaVersion=3) and rewritten to disk so subsequent reads are O(1).
 * v7.x states throw `LegacyFlowStateError` exactly as before.
 */
export async function readFlowState(projectRoot: string): Promise<FlowStateV82> {
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    const initial = createInitialFlowState();
    await writeFlowState(projectRoot, initial);
    return initial;
  }
  const raw = await fs.readFile(statePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const migrated = migrateFlowState(parsed);
  // If migration reshaped the on-disk file, persist the upgrade.
  if ((parsed as { schemaVersion?: unknown }).schemaVersion !== migrated.schemaVersion) {
    await writeFlowState(projectRoot, migrated);
  }
  return migrated;
}

export async function writeFlowState(projectRoot: string, state: FlowStateV82): Promise<void> {
  assertFlowStateV82(state);
  await writeFileSafe(flowStatePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`);
}

export async function resetFlowState(projectRoot: string): Promise<void> {
  await writeFlowState(projectRoot, createInitialFlowState());
}

export async function patchFlowState(
  projectRoot: string,
  patch: Partial<FlowStateV82>
): Promise<FlowStateV82> {
  const current = await readFlowState(projectRoot);
  const next: FlowStateV82 = { ...current, ...patch };
  await writeFlowState(projectRoot, next);
  return next;
}
