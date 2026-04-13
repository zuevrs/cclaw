import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codexHooksJson, cursorHooksJson, claudeHooksJson, opencodePluginJs } from "../dist/content/hooks.js";

const outputDir = join(process.cwd(), "release-artifacts", "plugin-manifests");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const files = [
  ["claude-hooks.json", claudeHooksJson()],
  ["cursor-hooks.json", cursorHooksJson()],
  ["codex-hooks.json", codexHooksJson()],
  ["opencode-plugin.mjs", opencodePluginJs()]
];

for (const [name, content] of files) {
  writeFileSync(join(outputDir, name), content, "utf8");
}

const indexPayload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  optional: true,
  description: "Optional harness plugin manifests for teams that prefer prebuilt wiring artifacts.",
  files: files.map(([name]) => name)
};
writeFileSync(join(outputDir, "index.json"), `${JSON.stringify(indexPayload, null, 2)}\n`, "utf8");

process.stdout.write(`[plugin-manifests] generated in ${outputDir}\n`);
