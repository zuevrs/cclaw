#!/usr/bin/env node
// Post-build: mirror src/content/skills/*.md → dist/content/skills/*.md.
//
// tsc only emits .ts → .js. The per-skill markdown bodies that the runtime
// (src/content/skills.ts > readSkill) loads via `import.meta.url` need to
// land in the compiled tree as well, otherwise install.ts fails to write
// `.cclaw/lib/skills/*.md` from the published package.
//
// Idempotent: creates dist/content/skills/ if missing and overwrites any
// stale .md files from a prior build.

import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const srcDir = path.join(repoRoot, "src/content/skills");
const dstDir = path.join(repoRoot, "dist/content/skills");

let srcEntries;
try {
  srcEntries = readdirSync(srcDir);
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`[copy-skill-md] cannot read ${srcDir}: ${reason}`);
  process.exit(1);
}

const mdFiles = srcEntries.filter((name) => name.endsWith(".md") && statSync(path.join(srcDir, name)).isFile());
if (mdFiles.length === 0) {
  console.error(`[copy-skill-md] no .md files found in ${srcDir}; aborting`);
  process.exit(1);
}

mkdirSync(dstDir, { recursive: true });
for (const file of mdFiles) {
  copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
}
console.log(`[copy-skill-md] mirrored ${mdFiles.length} skill .md files → dist/content/skills/`);
