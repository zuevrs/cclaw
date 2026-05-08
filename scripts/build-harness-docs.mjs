#!/usr/bin/env node
// Generate docs/harnesses.md from src/install.ts harness layout metadata.
// In v8 the install pipeline is the single source of truth for what each
// harness gets, so this script just imports the layout table and writes
// a short reference table.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const distModulePath = path.join(root, "dist", "install.js");

const { HARNESS_LAYOUT_TABLE } = await import(pathToFileURL(distModulePath).href);
const harnesses = Object.values(HARNESS_LAYOUT_TABLE);

const tableHeader = `| Harness | Commands dir | Agents dir | Hooks config |\n| --- | --- | --- | --- |`;
const rows = harnesses.map((layout) => {
  const hooks = layout.hooksConfig
    ? `${layout.hooksConfig.dir}/${layout.hooksConfig.fileName}`
    : "(none)";
  return `| ${layout.id} | ${layout.commandsDir} | ${layout.agentsDir} | ${hooks} |`;
});

const body = `# cclaw — supported harnesses\n\nGenerated from src/install.ts. Run \`npm run build:harness-docs\` to regenerate.\n\n${tableHeader}\n${rows.join("\n")}\n\nEach harness receives:\n- \`cc.md\`, \`cc-cancel.md\`, \`cc-idea.md\` slash command files\n- one markdown file per specialist in \`<agents-dir>/\` (brainstormer / architect / planner / reviewer / security-reviewer / slice-builder)\n- a hooks config (claude/cursor/codex) or a plugin module (opencode) wiring \`session.start\` and \`session.stop\` to \`.cclaw/hooks/*.mjs\`.\n\nThe runtime hooks themselves (\`session-start.mjs\`, \`stop-handoff.mjs\`, \`commit-helper.mjs\`) live under \`.cclaw/hooks/\` and are shared across harnesses.\n`;

const out = path.join(root, "docs", "harnesses.md");
await fs.writeFile(out, body, "utf8");
process.stdout.write(`Updated ${path.relative(root, out)} from src/install.ts\n`);
