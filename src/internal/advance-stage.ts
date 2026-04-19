import fs from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { RUNTIME_ROOT } from "../constants.js";
import { stageSchema } from "../content/stage-schema.js";
import {
  appendDelegation,
  checkMandatoryDelegations
} from "../delegation.js";
import { readActiveFeature } from "../feature-system.js";
import {
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "../gate-evidence.js";
import { extractMarkdownSectionBody, parseLearningsSection } from "../artifact-linter.js";
import {
  isFlowTrack,
  nextStage,
  type FlowState,
  type StageGateState
} from "../flow-state.js";
import { appendKnowledge } from "../knowledge-store.js";
import { readFlowState, writeFlowState } from "../runs.js";
import { FLOW_STAGES, type FlowStage } from "../types.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface AdvanceStageArgs {
  stage: FlowStage;
  passedGateIds: string[];
  evidenceByGate: Record<string, string>;
  waiveDelegations: string[];
  waiverReason?: string;
  quiet: boolean;
}

interface VerifyFlowStateDiffArgs {
  afterJson?: string;
  afterFile?: string;
  quiet: boolean;
}

interface VerifyCurrentStateArgs {
  quiet: boolean;
}

interface InternalValidationReport {
  ok: boolean;
  stage: FlowStage;
  delegation: {
    satisfied: boolean;
    missing: string[];
    waived: string[];
    missingEvidence: string[];
    expectedMode: string;
  };
  gates: {
    ok: boolean;
    complete: boolean;
    issues: string[];
    missingRequired: string[];
    missingTriggeredConditional: string[];
  };
  completedStages: {
    ok: boolean;
    issues: string[];
  };
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isFlowStageValue(value: unknown): value is FlowStage {
  return typeof value === "string" && (FLOW_STAGES as readonly string[]).includes(value);
}

function parseGuardEvidence(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    next[key] = trimmed;
  }
  return next;
}

function parseCandidateGateCatalog(
  value: unknown,
  fallback: FlowState["stageGateCatalog"]
): FlowState["stageGateCatalog"] {
  const next = {} as FlowState["stageGateCatalog"];
  for (const stage of FLOW_STAGES) {
    const base = fallback[stage];
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered: [...base.triggered],
      passed: [...base.passed],
      blocked: [...base.blocked]
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }
  const rawCatalog = value as Record<string, unknown>;
  for (const stage of FLOW_STAGES) {
    const rawStage = rawCatalog[stage];
    if (!rawStage || typeof rawStage !== "object" || Array.isArray(rawStage)) {
      continue;
    }
    const typed = rawStage as Record<string, unknown>;
    const base = fallback[stage];
    const allowed = new Set([...base.required, ...base.recommended, ...base.conditional]);
    const conditional = new Set(base.conditional);
    const passed = unique(parseStringList(typed.passed)).filter((gateId) =>
      allowed.has(gateId)
    );
    const blocked = unique(parseStringList(typed.blocked)).filter((gateId) =>
      allowed.has(gateId)
    );
    const triggered = unique([
      ...parseStringList(typed.triggered).filter((gateId) => conditional.has(gateId)),
      ...passed.filter((gateId) => conditional.has(gateId)),
      ...blocked.filter((gateId) => conditional.has(gateId))
    ]);
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered,
      passed,
      blocked
    };
  }
  return next;
}

function coerceCandidateFlowState(raw: unknown, fallback: FlowState): FlowState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const typed = raw as Record<string, unknown>;
  const track = isFlowTrack(typed.track) ? typed.track : fallback.track;
  const currentStage = isFlowStageValue(typed.currentStage)
    ? typed.currentStage
    : fallback.currentStage;
  const completedStages = unique(
    parseStringList(typed.completedStages).filter((stage): stage is FlowStage =>
      isFlowStageValue(stage)
    )
  );
  const skippedStagesRaw = parseStringList(typed.skippedStages).filter((stage): stage is FlowStage =>
    isFlowStageValue(stage)
  );
  const skippedStages = skippedStagesRaw.length > 0 ? skippedStagesRaw : fallback.skippedStages;

  return {
    ...fallback,
    currentStage,
    completedStages,
    track,
    skippedStages,
    guardEvidence: parseGuardEvidence(typed.guardEvidence),
    stageGateCatalog: parseCandidateGateCatalog(
      typed.stageGateCatalog,
      fallback.stageGateCatalog
    )
  };
}

function parseEvidenceByGate(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `--evidence-json must be valid JSON object: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--evidence-json must deserialize to an object.");
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    next[key] = trimmed;
  }
  return next;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseAdvanceStageArgs(tokens: string[]): AdvanceStageArgs {
  const [stageRaw, ...flagTokens] = tokens;
  if (!isFlowStageValue(stageRaw)) {
    throw new Error(
      `internal advance-stage requires a stage positional argument (${FLOW_STAGES.join(", ")}).`
    );
  }
  let evidenceJson: string | undefined;
  let passed: string[] = [];
  let waiveDelegations: string[] = [];
  let waiverReason: string | undefined;
  let quiet = false;

  for (const token of flagTokens) {
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token.startsWith("--evidence-json=")) {
      evidenceJson = token.replace("--evidence-json=", "");
      continue;
    }
    if (token.startsWith("--passed=")) {
      passed = [...passed, ...parseCsv(token.replace("--passed=", ""))];
      continue;
    }
    if (token.startsWith("--waive-delegation=")) {
      waiveDelegations = [
        ...waiveDelegations,
        ...parseCsv(token.replace("--waive-delegation=", ""))
      ];
      continue;
    }
    if (token.startsWith("--waiver-reason=")) {
      waiverReason = token.replace("--waiver-reason=", "").trim();
      continue;
    }
    throw new Error(`Unknown flag for internal advance-stage: ${token}`);
  }

  return {
    stage: stageRaw,
    passedGateIds: unique(passed),
    evidenceByGate: parseEvidenceByGate(evidenceJson),
    waiveDelegations: unique(waiveDelegations),
    waiverReason,
    quiet
  };
}

function parseVerifyFlowStateDiffArgs(tokens: string[]): VerifyFlowStateDiffArgs {
  let afterJson: string | undefined;
  let afterFile: string | undefined;
  let quiet = false;

  for (const token of tokens) {
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token.startsWith("--after-json=")) {
      afterJson = token.replace("--after-json=", "");
      continue;
    }
    if (token.startsWith("--after-file=")) {
      afterFile = token.replace("--after-file=", "");
      continue;
    }
    throw new Error(`Unknown flag for internal verify-flow-state-diff: ${token}`);
  }

  if (!afterJson && !afterFile) {
    throw new Error(
      "internal verify-flow-state-diff requires --after-json=<json> or --after-file=<path>."
    );
  }
  return { afterJson, afterFile, quiet };
}

function parseVerifyCurrentStateArgs(tokens: string[]): VerifyCurrentStateArgs {
  let quiet = false;
  for (const token of tokens) {
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    throw new Error(`Unknown flag for internal verify-current-state: ${token}`);
  }
  return { quiet };
}

async function buildValidationReport(
  projectRoot: string,
  flowState: FlowState
): Promise<InternalValidationReport> {
  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage);
  const gates = await verifyCurrentStageGateEvidence(projectRoot, flowState);
  const completedStages = verifyCompletedStagesGateClosure(flowState);
  const ok = delegation.satisfied && gates.ok && gates.complete && completedStages.ok;

  return {
    ok,
    stage: flowState.currentStage,
    delegation: {
      satisfied: delegation.satisfied,
      missing: delegation.missing,
      waived: delegation.waived,
      missingEvidence: delegation.missingEvidence,
      expectedMode: delegation.expectedMode
    },
    gates: {
      ok: gates.ok,
      complete: gates.complete,
      issues: gates.issues,
      missingRequired: gates.missingRequired,
      missingTriggeredConditional: gates.missingTriggeredConditional
    },
    completedStages: {
      ok: completedStages.ok,
      issues: completedStages.issues
    }
  };
}

interface HarvestLearningsResult {
  ok: boolean;
  markerWritten: boolean;
  parsedEntries: number;
  appendedEntries: number;
  skippedDuplicates: number;
  details: string;
}

const LEARNINGS_HARVEST_MARKER_PREFIX = "<!-- cclaw:learnings-harvested:";

function withLearningsHarvestMarker(
  artifactMarkdown: string,
  appendedEntries: number,
  skippedDuplicates: number
): string {
  const suffix = artifactMarkdown.endsWith("\n") ? "" : "\n";
  return `${artifactMarkdown}${suffix}${LEARNINGS_HARVEST_MARKER_PREFIX}${new Date().toISOString()} appended=${appendedEntries} skipped=${skippedDuplicates} -->\n`;
}

async function harvestStageLearnings(
  projectRoot: string,
  stage: FlowStage,
  artifactFile: string
): Promise<HarvestLearningsResult> {
  const artifactPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", artifactFile);
  let raw = "";
  try {
    raw = await fs.readFile(artifactPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: `Unable to read artifact for learnings harvest (${artifactPath}): ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  }

  if (raw.includes(LEARNINGS_HARVEST_MARKER_PREFIX)) {
    return {
      ok: true,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: "Learnings already harvested for this artifact."
    };
  }

  const learningsBody = extractMarkdownSectionBody(raw, "Learnings");
  if (learningsBody === null) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: 'Artifact is missing required "## Learnings" section.'
    };
  }

  const parsed = parseLearningsSection(learningsBody);
  if (!parsed.ok) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: parsed.details
    };
  }

  const activeFeature = await readActiveFeature(projectRoot).catch(() => null);
  const appendResult = await appendKnowledge(projectRoot, parsed.entries, {
    stage,
    originStage: stage,
    originFeature: activeFeature,
    project: path.basename(projectRoot)
  });
  if (appendResult.invalid > 0) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: parsed.entries.length,
      appendedEntries: appendResult.appended,
      skippedDuplicates: appendResult.skippedDuplicates,
      details: `Learnings append failed schema checks: ${appendResult.errors.join(" | ")}`
    };
  }

  const withMarker = withLearningsHarvestMarker(
    raw,
    appendResult.appended,
    appendResult.skippedDuplicates
  );
  await fs.writeFile(artifactPath, withMarker, "utf8");

  return {
    ok: true,
    markerWritten: true,
    parsedEntries: parsed.entries.length,
    appendedEntries: appendResult.appended,
    skippedDuplicates: appendResult.skippedDuplicates,
    details: parsed.none
      ? "Learnings section marked none; harvest marker recorded."
      : `Harvested ${appendResult.appended} learning entr${appendResult.appended === 1 ? "y" : "ies"} (${appendResult.skippedDuplicates} duplicate skipped).`
  };
}

async function runAdvanceStage(
  projectRoot: string,
  args: AdvanceStageArgs,
  io: InternalIo
): Promise<number> {
  const flowState = await readFlowState(projectRoot);
  if (flowState.currentStage !== args.stage) {
    io.stderr.write(
      `cclaw internal advance-stage: current stage is "${flowState.currentStage}", not "${args.stage}".\n`
    );
    return 1;
  }

  const schema = stageSchema(args.stage);
  const requiredGateIds = schema.requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const allowedGateIds = new Set(
    schema.requiredGates.map((gate) => gate.id)
  );
  const selectedGateIds =
    args.passedGateIds.length > 0
      ? args.passedGateIds.filter((gateId) => allowedGateIds.has(gateId))
      : requiredGateIds;
  const missingRequired = requiredGateIds.filter((gateId) => !selectedGateIds.includes(gateId));
  if (missingRequired.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: required gates not selected as passed: ${missingRequired.join(", ")}.\n`
    );
    return 1;
  }

  const mandatory = new Set(schema.mandatoryDelegations);
  for (const agent of args.waiveDelegations) {
    if (!mandatory.has(agent)) {
      io.stderr.write(
        `cclaw internal advance-stage: cannot waive "${agent}" for stage "${args.stage}" (not mandatory).\n`
      );
      return 1;
    }
  }

  if (args.waiveDelegations.length > 0) {
    const waiverReason = args.waiverReason && args.waiverReason.length > 0
      ? args.waiverReason
      : "manual_waiver";
    for (const agent of args.waiveDelegations) {
      await appendDelegation(projectRoot, {
        stage: args.stage,
        agent,
        mode: "mandatory",
        status: "waived",
        waiverReason,
        fulfillmentMode: "role-switch",
        ts: new Date().toISOString()
      });
    }
  }

  const catalog = flowState.stageGateCatalog[args.stage];
  const nextPassed = unique([...catalog.passed, ...selectedGateIds]).filter((gateId) =>
    allowedGateIds.has(gateId)
  );
  const nextBlocked = unique(catalog.blocked.filter((gateId) => !nextPassed.includes(gateId))).filter(
    (gateId) => allowedGateIds.has(gateId)
  );
  const conditional = new Set(catalog.conditional);
  const nextTriggered = unique([
    ...catalog.triggered.filter((gateId) => conditional.has(gateId)),
    ...nextPassed.filter((gateId) => conditional.has(gateId)),
    ...nextBlocked.filter((gateId) => conditional.has(gateId))
  ]);
  const nextGuardEvidence: Record<string, string> = { ...flowState.guardEvidence };
  for (const gateId of nextPassed) {
    const existing = nextGuardEvidence[gateId];
    if (typeof existing === "string" && existing.trim().length > 0) continue;
    const provided = args.evidenceByGate[gateId];
    nextGuardEvidence[gateId] = provided && provided.trim().length > 0
      ? provided.trim()
      : `stage-complete helper auto-evidence for ${gateId} @ ${new Date().toISOString()} (${schema.artifactFile})`;
  }

  const nextStageCatalog: StageGateState = {
    required: [...catalog.required],
    recommended: [...catalog.recommended],
    conditional: [...catalog.conditional],
    triggered: nextTriggered,
    passed: nextPassed,
    blocked: nextBlocked
  };
  const candidateState: FlowState = {
    ...flowState,
    guardEvidence: nextGuardEvidence,
    stageGateCatalog: {
      ...flowState.stageGateCatalog,
      [args.stage]: nextStageCatalog
    }
  };

  const validation = await buildValidationReport(projectRoot, candidateState);
  if (!validation.ok) {
    io.stderr.write(
      `cclaw internal advance-stage: validation failed for stage "${args.stage}".\n`
    );
    if (validation.delegation.missing.length > 0) {
      io.stderr.write(`- missing delegations: ${validation.delegation.missing.join(", ")}\n`);
    }
    if (validation.delegation.missingEvidence.length > 0) {
      io.stderr.write(
        `- role-switch evidence missing: ${validation.delegation.missingEvidence.join(", ")}\n`
      );
    }
    if (validation.gates.issues.length > 0) {
      io.stderr.write(`- gate issues: ${validation.gates.issues.join(" | ")}\n`);
    }
    if (validation.completedStages.issues.length > 0) {
      io.stderr.write(
        `- completed-stage closure issues: ${validation.completedStages.issues.join(" | ")}\n`
      );
    }
    return 1;
  }

  const learningsHarvest = await harvestStageLearnings(
    projectRoot,
    args.stage,
    schema.artifactFile
  );
  if (!learningsHarvest.ok) {
    io.stderr.write(
      `cclaw internal advance-stage: learnings harvest failed for "${schema.artifactFile}". ${learningsHarvest.details}\n`
    );
    return 1;
  }

  const successor = nextStage(args.stage, flowState.track);
  const completedStages = flowState.completedStages.includes(args.stage)
    ? [...flowState.completedStages]
    : [...flowState.completedStages, args.stage];
  const finalState: FlowState = {
    ...candidateState,
    completedStages,
    currentStage: successor ?? args.stage
  };

  await writeFlowState(projectRoot, finalState);

  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: true,
      command: "advance-stage",
      stage: args.stage,
      nextStage: successor,
      currentStage: finalState.currentStage,
      completedStages: finalState.completedStages,
      learnings: {
        parsed: learningsHarvest.parsedEntries,
        appended: learningsHarvest.appendedEntries,
        skippedDuplicates: learningsHarvest.skippedDuplicates,
        markerWritten: learningsHarvest.markerWritten,
        details: learningsHarvest.details
      }
    }, null, 2)}\n`);
  }
  return 0;
}

async function runVerifyFlowStateDiff(
  projectRoot: string,
  args: VerifyFlowStateDiffArgs,
  io: InternalIo
): Promise<number> {
  let raw = args.afterJson;
  if (!raw && args.afterFile) {
    raw = await fs.readFile(args.afterFile, "utf8");
  }
  if (!raw) {
    io.stderr.write("cclaw internal verify-flow-state-diff: no candidate state payload.\n");
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    io.stderr.write(
      `cclaw internal verify-flow-state-diff: invalid JSON payload (${
        err instanceof Error ? err.message : String(err)
      }).\n`
    );
    return 1;
  }

  const current = await readFlowState(projectRoot);
  const candidate = coerceCandidateFlowState(parsed, current);
  const validation = await buildValidationReport(projectRoot, candidate);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  }
  if (!validation.ok) {
    io.stderr.write(
      `cclaw internal verify-flow-state-diff: candidate state is invalid for stage "${validation.stage}".\n`
    );
  }
  return validation.ok ? 0 : 1;
}

async function runVerifyCurrentState(
  projectRoot: string,
  args: VerifyCurrentStateArgs,
  io: InternalIo
): Promise<number> {
  const current = await readFlowState(projectRoot);
  const validation = await buildValidationReport(projectRoot, current);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  }
  if (!validation.ok) {
    const unmetDelegations =
      validation.delegation.missing.length + validation.delegation.missingEvidence.length;
    const gatesWithoutEvidence = validation.gates.issues.filter((issue) =>
      issue.includes("missing guardEvidence entry")
    ).length;
    io.stderr.write(
      `cclaw: current stage has ${unmetDelegations} unmet mandatory delegations and ${gatesWithoutEvidence} gates without evidence.\n`
    );
    io.stderr.write(
      `cclaw internal verify-current-state: unresolved stage constraints for "${validation.stage}".\n`
    );
  }
  return validation.ok ? 0 : 1;
}

export async function runInternalCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const [subcommand, ...tokens] = argv;
  if (!subcommand) {
    io.stderr.write(
      "cclaw internal requires a subcommand: advance-stage | verify-flow-state-diff | verify-current-state\n"
    );
    return 1;
  }

  try {
    if (subcommand === "advance-stage") {
      return await runAdvanceStage(projectRoot, parseAdvanceStageArgs(tokens), io);
    }
    if (subcommand === "verify-flow-state-diff") {
      return await runVerifyFlowStateDiff(projectRoot, parseVerifyFlowStateDiffArgs(tokens), io);
    }
    if (subcommand === "verify-current-state") {
      return await runVerifyCurrentState(projectRoot, parseVerifyCurrentStateArgs(tokens), io);
    }
    io.stderr.write(
      `Unknown internal subcommand: ${subcommand}. Expected advance-stage | verify-flow-state-diff | verify-current-state\n`
    );
    return 1;
  } catch (err) {
    io.stderr.write(
      `cclaw internal ${subcommand} failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
}
