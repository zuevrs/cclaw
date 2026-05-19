import fs from "node:fs/promises";
import path from "node:path";
import { FLOW_STATE_REL_PATH, RUNTIME_ROOT, TRIAGE_AUDIT_REL_PATH } from "./constants.js";
import {
  assertFlowStateV82,
  createInitialFlowState,
  migrateFlowState,
  type FlowStateV82
} from "./flow-state.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { withPathLock } from "./path-mutex.js";

export function flowStatePath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REL_PATH);
}

export async function ensureRunSystem(projectRoot: string): Promise<void> {
  await ensureDir(path.join(projectRoot, RUNTIME_ROOT, "state"));
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    await writeFlowState(projectRoot, createInitialFlowState());
  }
  // on a fresh install (the orchestrator's `fs.appendFile` call would
  // create it lazily, but the smoke test asserts the file is present
  // after init for the audit-log surface).
  const auditPath = path.join(projectRoot, TRIAGE_AUDIT_REL_PATH);
  if (!(await exists(auditPath))) {
    await writeFileSafe(auditPath, "");
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

/**
 * Apply a partial patch to `flow-state.json` and write the result.
 *
 * v8.108 (R2): the read → merge → write critical section is now
 * serialised via {@link withPathLock} keyed on the flow-state path.
 * Two concurrent `patchFlowState` calls no longer lose updates — they
 * execute FIFO under the per-path mutex; on contention beyond the
 * 30s budget the call throws `StateLockBlocked` (gstack-style fail
 * loudly, do not retry-then-corrupt). The mutex re-reads state inside
 * the critical section, so the last-retry path always sees the latest
 * on-disk snapshot (gsd-v1 #3711 lesson).
 */
export async function patchFlowState(
  projectRoot: string,
  patch: Partial<FlowStateV82>
): Promise<FlowStateV82> {
  return withPathLock(flowStatePath(projectRoot), async () => {
    const current = await readFlowState(projectRoot);
    const next: FlowStateV82 = { ...current, ...patch };
    await writeFlowState(projectRoot, next);
    return next;
  });
}
