import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  opencodePluginJs,
  preCompactScript,
  sessionStartScript,
  stageCompleteScript,
  stopCheckpointScript
} from "../dist/content/hooks.js";
import {
  contextMonitorScript,
  promptGuardScript,
  workflowGuardScript
} from "../dist/content/observe.js";

const tempDir = mkdtempSync(join(tmpdir(), "cclaw-hook-lint-"));

function assertSuccess(command, args, inputPath) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr || "";
    throw new Error(`lint failed for ${inputPath}: ${command} ${args.join(" ")}\n${stderr}`);
  }
}

try {
  const shellScripts = [
    ["session-start.sh", sessionStartScript()],
    ["stop-checkpoint.sh", stopCheckpointScript()],
    ["stage-complete.sh", stageCompleteScript()],
    ["pre-compact.sh", preCompactScript()],
    ["prompt-guard.sh", promptGuardScript()],
    ["workflow-guard.sh", workflowGuardScript()],
    ["context-monitor.sh", contextMonitorScript()],
  ];

  for (const [name, content] of shellScripts) {
    const scriptPath = join(tempDir, name);
    writeFileSync(scriptPath, content, "utf8");
    assertSuccess("bash", ["-n", scriptPath], scriptPath);
  }

  const nodeScripts = [["opencode-plugin.mjs", opencodePluginJs()]];
  for (const [name, content] of nodeScripts) {
    const scriptPath = join(tempDir, name);
    writeFileSync(scriptPath, content, "utf8");
    assertSuccess("node", ["--check", scriptPath], scriptPath);
  }

  process.stdout.write("[lint-generated-hooks] all generated hook scripts are syntactically valid\n");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
