#!/usr/bin/env node
// Generate optional pre-built plugin manifests for harness teams that prefer
// shipping ready-to-use wiring artifacts. These mirror what `cclaw sync`
// would produce in a project; the artifacts here are intentionally minimal
// because real installation lives inside src/install.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputDir = join(process.cwd(), "release-artifacts", "plugin-manifests");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

function hooksJson(harness) {
  return JSON.stringify(
    {
      version: 1,
      generatedBy: "cclaw-cli@8.0.0",
      harness,
      events: {
        "session.start": [
          { command: "node", args: ["./.cclaw/hooks/session-start.mjs"] }
        ]
      }
    },
    null,
    2
  ) + "\n";
}

const opencodePlugin = `// cclaw opencode plugin (minimal). Wires the session-start hook.
import { spawn } from "node:child_process";
import path from "node:path";
function run(filePath) {
  return () => spawn(process.execPath, [path.join(".cclaw", "hooks", filePath)], { stdio: "inherit" });
}
export default {
  events: {
    "session.start": run("session-start.mjs")
  }
};
`;

const files = [
  ["claude-hooks.json", hooksJson("claude")],
  ["cursor-hooks.json", hooksJson("cursor")],
  ["codex-hooks.json", hooksJson("codex")],
  ["opencode-plugin.mjs", opencodePlugin]
];

for (const [name, content] of files) {
  writeFileSync(join(outputDir, name), content, "utf8");
}

const indexPayload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  optional: true,
  description: "Optional cclaw harness plugin manifests (use cclaw sync for real installs).",
  files: files.map(([name]) => name)
};
writeFileSync(join(outputDir, "index.json"), `${JSON.stringify(indexPayload, null, 2)}\n`, "utf8");

process.stdout.write(`[plugin-manifests] generated in ${outputDir}\n`);
