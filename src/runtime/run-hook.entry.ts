// cclaw v8 hook runtime entry point.
// Hooks are written as standalone .mjs files under .cclaw/hooks/ at install time.
// This module is a thin loader for ad-hoc programmatic invocation; it is
// intentionally tiny because hook bodies are owned by the generated content
// in src/content/node-hooks.ts.
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runHookByName(projectRoot: string, hookFile: string): Promise<void> {
  const hookPath = path.join(projectRoot, ".cclaw", "hooks", hookFile);
  const url = pathToFileURL(hookPath).href;
  await import(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , hookFile] = process.argv;
  if (!hookFile) {
    process.stderr.write("usage: run-hook.entry.js <hook-file.mjs>\n");
    process.exit(2);
  }
  await runHookByName(process.cwd(), hookFile);
}
