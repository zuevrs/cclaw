import { archiveRun } from "../../runs.js";
import type { CancelRunArgs } from "./parsers.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

export async function runCancelRun(
  projectRoot: string,
  args: CancelRunArgs,
  io: InternalIo
): Promise<number> {
  const archived = await archiveRun(projectRoot, args.name, {
    disposition: args.disposition,
    dispositionReason: args.reason
  });
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: true,
      command: "cancel-run",
      disposition: archived.disposition,
      reason: archived.dispositionReason ?? args.reason,
      archiveId: archived.archiveId,
      archivePath: archived.archivePath,
      resetRunId: archived.resetState.activeRunId
    }, null, 2)}\n`);
  }
  return 0;
}
