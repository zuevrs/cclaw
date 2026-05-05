import type { Writable } from "node:stream";
import { runEnvelopeValidateCommand } from "./envelope-validate.js";
import { runTddRedEvidenceCommand } from "./tdd-red-evidence.js";
import { runTddLoopStatusCommand } from "./tdd-loop-status.js";
import { runEarlyLoopStatusCommand } from "./early-loop-status.js";
import { runCompoundReadinessCommand } from "./compound-readiness.js";
import { runRuntimeIntegrityCommand } from "./runtime-integrity.js";
import { runAdvanceStage } from "./advance-stage/advance.js";
import { runStartFlow } from "./advance-stage/start-flow.js";
import { runCancelRun } from "./advance-stage/cancel-run.js";
import { runRewind } from "./advance-stage/rewind.js";
import { runVerifyFlowStateDiff, runVerifyCurrentState } from "./advance-stage/verify.js";
import { runHookCommand } from "./advance-stage/hook.js";
import {
  parseAdvanceStageArgs,
  parseCancelRunArgs,
  parseHookArgs,
  parseRewindArgs,
  parseStartFlowArgs,
  parseVerifyCurrentStateArgs,
  parseVerifyFlowStateDiffArgs
} from "./advance-stage/parsers.js";
import {
  parseFlowStateRepairArgs,
  runFlowStateRepair
} from "./flow-state-repair.js";
import {
  parseWaiverGrantArgs,
  runWaiverGrant
} from "./waiver-grant.js";
import {
  FlowStateGuardMismatchError,
  verifyFlowStateGuard
} from "../run-persistence.js";
import {
  DelegationTimestampError,
  DispatchCapError,
  DispatchClaimedPathProtectedError,
  DispatchDuplicateError,
  DispatchOverlapError,
  SliceAlreadyClosedError
} from "../delegation.js";
import { parsePlanSplitWavesArgs, runPlanSplitWaves } from "./plan-split-waves.js";
import { runWaveStatusCommand } from "./wave-status.js";
import { runCohesionContractCommand } from "./cohesion-contract-stub.js";
import { runSliceCommitCommand } from "./slice-commit.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

/**
 * Subcommands that mutate or consult flow-state.json via the CLI runtime.
 * They all require the sha256 sidecar to match before continuing so a
 * manual edit hard-blocks with exit code 2 (same contract as the inline
 * hook checks).
 */
const GUARD_ENFORCED_SUBCOMMANDS = new Set([
  "advance-stage",
  "start-flow",
  "cancel-run",
  "rewind",
  "verify-flow-state-diff",
  "verify-current-state"
]);

export async function runInternalCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const [subcommand, ...tokens] = argv;
  if (!subcommand) {
    io.stderr.write(
      "cclaw internal requires a subcommand: advance-stage | start-flow | cancel-run | rewind | verify-flow-state-diff | verify-current-state | envelope-validate | tdd-red-evidence | tdd-loop-status | early-loop-status | compound-readiness | runtime-integrity | hook | slice-commit | flow-state-repair | waiver-grant | plan-split-waves | wave-status | cohesion-contract\n"
    );
    return 1;
  }

  try {
    if (GUARD_ENFORCED_SUBCOMMANDS.has(subcommand)) {
      await verifyFlowStateGuard(projectRoot);
    }
    if (subcommand === "advance-stage") {
      return await runAdvanceStage(projectRoot, parseAdvanceStageArgs(tokens), io);
    }
    if (subcommand === "start-flow") {
      return await runStartFlow(projectRoot, parseStartFlowArgs(tokens), io);
    }
    if (subcommand === "cancel-run") {
      return await runCancelRun(projectRoot, parseCancelRunArgs(tokens), io);
    }
    if (subcommand === "rewind") {
      return await runRewind(projectRoot, parseRewindArgs(tokens), io);
    }
    if (subcommand === "verify-flow-state-diff") {
      return await runVerifyFlowStateDiff(projectRoot, parseVerifyFlowStateDiffArgs(tokens), io);
    }
    if (subcommand === "verify-current-state") {
      return await runVerifyCurrentState(projectRoot, parseVerifyCurrentStateArgs(tokens), io);
    }
    if (subcommand === "envelope-validate") {
      return await runEnvelopeValidateCommand(projectRoot, tokens, io);
    }
    if (subcommand === "tdd-red-evidence") {
      return await runTddRedEvidenceCommand(projectRoot, tokens, io);
    }
    if (subcommand === "tdd-loop-status") {
      return await runTddLoopStatusCommand(projectRoot, tokens, io);
    }
    if (subcommand === "early-loop-status") {
      return await runEarlyLoopStatusCommand(projectRoot, tokens, io);
    }
    if (subcommand === "compound-readiness") {
      return await runCompoundReadinessCommand(projectRoot, tokens, io);
    }
    if (subcommand === "runtime-integrity") {
      return await runRuntimeIntegrityCommand(projectRoot, tokens, io);
    }
    if (subcommand === "hook") {
      return await runHookCommand(projectRoot, parseHookArgs(tokens), io);
    }
    if (subcommand === "slice-commit") {
      return await runSliceCommitCommand(projectRoot, tokens, io);
    }
    if (subcommand === "flow-state-repair") {
      return await runFlowStateRepair(projectRoot, parseFlowStateRepairArgs(tokens), io);
    }
    if (subcommand === "waiver-grant") {
      return await runWaiverGrant(projectRoot, parseWaiverGrantArgs(tokens), io);
    }
    if (subcommand === "plan-split-waves") {
      return await runPlanSplitWaves(projectRoot, parsePlanSplitWavesArgs(tokens), io);
    }
    if (subcommand === "wave-status") {
      return await runWaveStatusCommand(projectRoot, tokens, io);
    }
    if (subcommand === "cohesion-contract") {
      return await runCohesionContractCommand(projectRoot, tokens, io);
    }
    io.stderr.write(
      `Unknown internal subcommand: ${subcommand}. Expected advance-stage | start-flow | cancel-run | rewind | verify-flow-state-diff | verify-current-state | envelope-validate | tdd-red-evidence | tdd-loop-status | early-loop-status | compound-readiness | runtime-integrity | hook | slice-commit | flow-state-repair | waiver-grant | plan-split-waves | wave-status | cohesion-contract\n`
    );
    return 1;
  } catch (err) {
    if (err instanceof FlowStateGuardMismatchError) {
      io.stderr.write(`cclaw internal ${subcommand}: ${err.message}\n`);
      return 2;
    }
    if (err instanceof DelegationTimestampError) {
      io.stderr.write(
        `error: delegation_timestamp_non_monotonic — ${err.field}: ${err.actual} < ${err.priorBound}\n`
      );
      return 2;
    }
    if (err instanceof DispatchDuplicateError) {
      io.stderr.write(`error: dispatch_duplicate — ${err.message}\n`);
      return 2;
    }
    if (err instanceof DispatchOverlapError) {
      io.stderr.write(`error: dispatch_overlap — ${err.message}\n`);
      return 2;
    }
    if (err instanceof DispatchClaimedPathProtectedError) {
      io.stderr.write(`error: dispatch_claimed_path_protected — ${err.message}\n`);
      return 2;
    }
    if (err instanceof SliceAlreadyClosedError) {
      io.stderr.write(`error: slice_already_closed — ${err.message}\n`);
      return 2;
    }
    if (err instanceof DispatchCapError) {
      io.stderr.write(`error: dispatch_cap — ${err.message}\n`);
      return 2;
    }
    io.stderr.write(
      `cclaw internal ${subcommand} failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
}
