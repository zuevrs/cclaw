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

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

export async function runInternalCommand(
  projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const [subcommand, ...tokens] = argv;
  if (!subcommand) {
    io.stderr.write(
      "cclaw internal requires a subcommand: advance-stage | start-flow | cancel-run | rewind | verify-flow-state-diff | verify-current-state | envelope-validate | tdd-red-evidence | tdd-loop-status | early-loop-status | compound-readiness | runtime-integrity | hook\n"
    );
    return 1;
  }

  try {
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
    io.stderr.write(
      `Unknown internal subcommand: ${subcommand}. Expected advance-stage | start-flow | cancel-run | rewind | verify-flow-state-diff | verify-current-state | envelope-validate | tdd-red-evidence | tdd-loop-status | early-loop-status | compound-readiness | runtime-integrity | hook\n`
    );
    return 1;
  } catch (err) {
    io.stderr.write(
      `cclaw internal ${subcommand} failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
}
