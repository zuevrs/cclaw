import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { exists, writeFileSafe } from "./fs-utils.js";
import { readFlowState } from "./runs.js";
import { stageSchema } from "./content/stage-schema.js";
import type { FlowStage } from "./types.js";

export type DelegationEntry = {
  stage: string;
  agent: string;
  mode: "mandatory" | "proactive";
  status: "scheduled" | "completed" | "failed" | "waived";
  taskId?: string;
  waiverReason?: string;
  ts: string;
};

export type DelegationLedger = {
  runId: string;
  entries: DelegationEntry[];
};

function delegationLogPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "runs", runId, "delegation-log.json");
}

function isDelegationEntry(value: unknown): value is DelegationEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const modeOk = o.mode === "mandatory" || o.mode === "proactive";
  const statusOk =
    o.status === "scheduled" ||
    o.status === "completed" ||
    o.status === "failed" ||
    o.status === "waived";
  return (
    typeof o.stage === "string" &&
    typeof o.agent === "string" &&
    modeOk &&
    statusOk &&
    typeof o.ts === "string" &&
    (o.taskId === undefined || typeof o.taskId === "string") &&
    (o.waiverReason === undefined || typeof o.waiverReason === "string")
  );
}

function parseLedger(raw: unknown, runId: string): DelegationLedger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { runId, entries: [] };
  }
  const o = raw as Record<string, unknown>;
  const entriesRaw = o.entries;
  const entries: DelegationEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const item of entriesRaw) {
      if (isDelegationEntry(item)) {
        entries.push(item);
      }
    }
  }
  return { runId, entries };
}

export async function readDelegationLedger(projectRoot: string): Promise<DelegationLedger> {
  const { activeRunId } = await readFlowState(projectRoot);
  const filePath = delegationLogPath(projectRoot, activeRunId);
  if (!(await exists(filePath))) {
    return { runId: activeRunId, entries: [] };
  }
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(text);
    return parseLedger(parsed, activeRunId);
  } catch {
    return { runId: activeRunId, entries: [] };
  }
}

export async function appendDelegation(projectRoot: string, entry: DelegationEntry): Promise<void> {
  const { activeRunId } = await readFlowState(projectRoot);
  const filePath = delegationLogPath(projectRoot, activeRunId);
  const prior = await readDelegationLedger(projectRoot);
  const ledger: DelegationLedger = {
    runId: activeRunId,
    entries: [...prior.entries, entry]
  };
  await writeFileSafe(filePath, `${JSON.stringify(ledger, null, 2)}\n`);
}

export async function checkMandatoryDelegations(
  projectRoot: string,
  stage: FlowStage
): Promise<{ satisfied: boolean; missing: string[]; waived: string[] }> {
  const mandatory = stageSchema(stage).mandatoryDelegations;
  const ledger = await readDelegationLedger(projectRoot);
  const forStage = ledger.entries.filter((e) => e.stage === stage);

  const missing: string[] = [];
  const waived: string[] = [];

  for (const agent of mandatory) {
    const rows = forStage.filter((e) => e.agent === agent);
    const ok = rows.some((e) => e.status === "completed" || e.status === "waived");
    if (!ok) {
      missing.push(agent);
    } else if (rows.some((e) => e.status === "waived")) {
      waived.push(agent);
    }
  }

  return {
    satisfied: missing.length === 0,
    missing,
    waived
  };
}
