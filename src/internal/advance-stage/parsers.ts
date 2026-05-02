import {
  FLOW_STAGES,
  type DiscoveryMode,
  type FlowStage,
  type FlowTrack
} from "../../types.js";
import { isDiscoveryMode, isFlowTrack } from "../../flow-state.js";
import type { ArchiveDisposition } from "../../runs.js";
import {
  isFlowStageValue,
  parseCsv,
  parseEvidenceByGate,
  unique
} from "./helpers.js";

export interface AdvanceStageArgs {
  stage: FlowStage;
  passedGateIds: string[];
  evidenceByGate: Record<string, string>;
  waiveDelegations: string[];
  waiverReason?: string;
  acceptProactiveWaiver: boolean;
  acceptProactiveWaiverReason?: string;
  skipQuestions: boolean;
  quiet: boolean;
  json: boolean;
}

export interface VerifyFlowStateDiffArgs {
  afterJson?: string;
  afterFile?: string;
  quiet: boolean;
}

export interface VerifyCurrentStateArgs {
  quiet: boolean;
}

export interface HookArgs {
  hookName: string;
}

export interface RewindArgs {
  mode: "rewind" | "ack";
  targetStage: FlowStage;
  reason?: string;
  quiet: boolean;
  json: boolean;
}

export interface StartFlowArgs {
  track: FlowTrack;
  discoveryMode: DiscoveryMode;
  className?: string;
  prompt?: string;
  reason?: string;
  stack?: string;
  forceReset: boolean;
  reclassify: boolean;
  quiet: boolean;
  /**
   * Wave 23 (v5.0.0) — `/cc-ideate` handoff carry-forward.
   * Workspace-relative POSIX path to `.cclaw/ideas/idea-YYYY-MM-DD-<slug>.md`
   * (or wherever `/cc-ideate` wrote its artifact).
   */
  fromIdeaArtifact?: string;
  /** Optional `I-#` row id chosen from the idea artifact's ranked list. */
  fromIdeaCandidateId?: string;
}

export interface CancelRunArgs {
  reason: string;
  disposition: Extract<ArchiveDisposition, "cancelled" | "abandoned">;
  name?: string;
  quiet: boolean;
}

export function parseAdvanceStageArgs(tokens: string[]): AdvanceStageArgs {
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
  let acceptProactiveWaiver = false;
  let acceptProactiveWaiverReason: string | undefined;
  let skipQuestions = false;
  let quiet = false;
  let json = false;

  for (let i = 0; i < flagTokens.length; i += 1) {
    const token = flagTokens[i]!;
    const nextToken = flagTokens[i + 1];
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--evidence-json") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--evidence-json requires a JSON object value.");
      }
      evidenceJson = nextToken;
      i += 1;
      continue;
    }
    if (token.startsWith("--evidence-json=")) {
      evidenceJson = token.slice("--evidence-json=".length);
      continue;
    }
    if (token === "--passed") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--passed requires a comma-separated gate list.");
      }
      passed = [...passed, ...parseCsv(nextToken)];
      i += 1;
      continue;
    }
    if (token.startsWith("--passed=")) {
      passed = [...passed, ...parseCsv(token.slice("--passed=".length))];
      continue;
    }
    if (token === "--waive-delegation") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--waive-delegation requires a comma-separated agent list.");
      }
      waiveDelegations = [...waiveDelegations, ...parseCsv(nextToken)];
      i += 1;
      continue;
    }
    if (token.startsWith("--waive-delegation=")) {
      waiveDelegations = [
        ...waiveDelegations,
        ...parseCsv(token.slice("--waive-delegation=".length))
      ];
      continue;
    }
    if (token === "--waiver-reason") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--waiver-reason requires a text value.");
      }
      waiverReason = nextToken.trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--waiver-reason=")) {
      waiverReason = token.slice("--waiver-reason=".length).trim();
      continue;
    }
    if (token === "--accept-proactive-waiver") {
      acceptProactiveWaiver = true;
      continue;
    }
    if (token === "--skip-questions") {
      skipQuestions = true;
      continue;
    }
    if (token === "--accept-proactive-waiver-reason") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--accept-proactive-waiver-reason requires a text value.");
      }
      acceptProactiveWaiverReason = nextToken.trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--accept-proactive-waiver-reason=")) {
      acceptProactiveWaiverReason = token.slice("--accept-proactive-waiver-reason=".length).trim();
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
    acceptProactiveWaiver,
    acceptProactiveWaiverReason,
    skipQuestions,
    quiet,
    json
  };
}

export function parseVerifyFlowStateDiffArgs(tokens: string[]): VerifyFlowStateDiffArgs {
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

export function parseVerifyCurrentStateArgs(tokens: string[]): VerifyCurrentStateArgs {
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

export function parseRewindArgs(tokens: string[]): RewindArgs {
  let quiet = false;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const nextToken = tokens[i + 1];
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--ack") {
      if (!nextToken || nextToken.startsWith("--")) {
        throw new Error("--ack requires a stage value.");
      }
      if (!isFlowStageValue(nextToken)) {
        throw new Error(`--ack stage must be one of: ${FLOW_STAGES.join(", ")}.`);
      }
      i += 1;
      return { mode: "ack", targetStage: nextToken, quiet, json };
    }
    if (token.startsWith("--ack=")) {
      const stage = token.slice("--ack=".length);
      if (!isFlowStageValue(stage)) {
        throw new Error(`--ack stage must be one of: ${FLOW_STAGES.join(", ")}.`);
      }
      return { mode: "ack", targetStage: stage, quiet, json };
    }
    positional.push(token);
  }

  const [targetStage, ...reasonParts] = positional;
  if (!isFlowStageValue(targetStage)) {
    throw new Error(`internal rewind requires a target stage (${FLOW_STAGES.join(", ")}) or --ack <stage>.`);
  }
  const reason = reasonParts.join(" ").trim();
  if (reason.length === 0) {
    throw new Error('internal rewind requires a reason, for example: cclaw internal rewind tdd "review_blocked_by_critical".');
  }
  return { mode: "rewind", targetStage, reason, quiet, json };
}

export function parseHookArgs(tokens: string[]): HookArgs {
  const [hookName, ...rest] = tokens;
  const normalizedHook = typeof hookName === "string" ? hookName.trim() : "";
  if (normalizedHook.length === 0) {
    throw new Error("internal hook requires a hook name: cclaw internal hook <name>.");
  }
  if (rest.length > 0) {
    throw new Error(`Unknown arguments for internal hook: ${rest.join(" ")}`);
  }
  return { hookName: normalizedHook };
}

export function parseStartFlowArgs(tokens: string[]): StartFlowArgs {
  let track: FlowTrack | undefined;
  let discoveryMode: DiscoveryMode = "guided";
  let className: string | undefined;
  let prompt: string | undefined;
  let reason: string | undefined;
  let stack: string | undefined;
  let forceReset = false;
  let reclassify = false;
  let quiet = false;
  let fromIdeaArtifact: string | undefined;
  let fromIdeaCandidateId: string | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const nextToken = tokens[i + 1];
    const readValue = (flag: string): string => {
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
      if (token === flag && nextToken && !nextToken.startsWith("--")) {
        i += 1;
        return nextToken;
      }
      throw new Error(`${flag} requires a value.`);
    };
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--force-reset") {
      forceReset = true;
      continue;
    }
    if (token === "--reclassify") {
      reclassify = true;
      continue;
    }
    if (token === "--track" || token.startsWith("--track=")) {
      const raw = readValue("--track").trim();
      if (!isFlowTrack(raw)) {
        throw new Error(`--track must be one of: standard, medium, quick.`);
      }
      track = raw;
      continue;
    }
    if (token === "--discovery-mode" || token.startsWith("--discovery-mode=")) {
      const raw = readValue("--discovery-mode").trim();
      if (!isDiscoveryMode(raw)) {
        throw new Error(`--discovery-mode must be one of: lean, guided, deep.`);
      }
      discoveryMode = raw;
      continue;
    }
    if (token === "--class" || token.startsWith("--class=")) {
      className = readValue("--class").trim();
      continue;
    }
    if (token === "--prompt" || token.startsWith("--prompt=")) {
      prompt = readValue("--prompt").trim();
      continue;
    }
    if (token === "--reason" || token.startsWith("--reason=")) {
      reason = readValue("--reason").trim();
      continue;
    }
    if (token === "--stack" || token.startsWith("--stack=")) {
      stack = readValue("--stack").trim();
      continue;
    }
    if (token === "--from-idea-artifact" || token.startsWith("--from-idea-artifact=")) {
      const raw = readValue("--from-idea-artifact").trim();
      fromIdeaArtifact = raw.length > 0 ? raw : undefined;
      continue;
    }
    if (token === "--from-idea-candidate" || token.startsWith("--from-idea-candidate=")) {
      const raw = readValue("--from-idea-candidate").trim();
      fromIdeaCandidateId = raw.length > 0 ? raw : undefined;
      continue;
    }
    throw new Error(`Unknown flag for internal start-flow: ${token}`);
  }

  if (!track) {
    throw new Error("internal start-flow requires --track=<standard|medium|quick>.");
  }
  if (fromIdeaCandidateId && !fromIdeaArtifact) {
    throw new Error(
      "--from-idea-candidate requires --from-idea-artifact=<path> to be set as well."
    );
  }
  return {
    track,
    discoveryMode,
    className,
    prompt,
    reason,
    stack,
    forceReset,
    reclassify,
    quiet,
    fromIdeaArtifact,
    fromIdeaCandidateId
  };
}

export function parseCancelRunArgs(tokens: string[]): CancelRunArgs {
  let reason: string | undefined;
  let disposition: CancelRunArgs["disposition"] = "cancelled";
  let name: string | undefined;
  let quiet = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const nextToken = tokens[i + 1];
    const readValue = (flag: string): string => {
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
      if (token === flag && nextToken && !nextToken.startsWith("--")) {
        i += 1;
        return nextToken;
      }
      throw new Error(`${flag} requires a value.`);
    };
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--reason" || token.startsWith("--reason=")) {
      reason = readValue("--reason").trim();
      continue;
    }
    if (token === "--name" || token.startsWith("--name=")) {
      const raw = readValue("--name").trim();
      name = raw.length > 0 ? raw : undefined;
      continue;
    }
    if (token === "--disposition" || token.startsWith("--disposition=")) {
      const raw = readValue("--disposition").trim();
      if (raw !== "cancelled" && raw !== "abandoned") {
        throw new Error("--disposition must be cancelled or abandoned.");
      }
      disposition = raw;
      continue;
    }
    throw new Error(`Unknown flag for internal cancel-run: ${token}`);
  }
  if (!reason || reason.length === 0) {
    throw new Error("internal cancel-run requires --reason=<text>.");
  }
  return { reason, disposition, name, quiet };
}
