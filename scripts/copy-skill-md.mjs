#!/usr/bin/env node
// Post-build: mirror src/content/skills/*.md → dist/content/skills/*.md AND
// (v8.111+) src/content/runbooks/*.md → dist/content/runbooks/*.md.
//
// tsc only emits .ts → .js. The per-skill / per-runbook markdown bodies the
// runtime loads via `import.meta.url` (src/content/skills.ts > readSkill;
// src/content/runbooks-on-demand.ts > readRunbook, v8.111) need to land in
// the compiled tree as well, otherwise install.ts fails to write
// `.cclaw/lib/skills/*.md` and `.cclaw/lib/runbooks/*.md` from the
// published package.
//
// Idempotent: creates the target dirs if missing and overwrites any stale
// .md files from a prior build.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// (srcSubdir, dstSubdir, requiredAtLeastOne)
// - skills/  — pre-v8.111 directory; at least one .md required.
// - runbooks/ — v8.111+ directory; required at least one .md (we ship 5).
const COPIES = [
  { src: "src/content/skills", dst: "dist/content/skills", required: true, label: "skill" },
  { src: "src/content/runbooks", dst: "dist/content/runbooks", required: true, label: "runbook" }
];

for (const { src, dst, required, label } of COPIES) {
  const srcDir = path.join(repoRoot, src);
  const dstDir = path.join(repoRoot, dst);

  if (!existsSync(srcDir)) {
    if (required) {
      console.error(`[copy-skill-md] required source dir missing: ${srcDir}`);
      process.exit(1);
    }
    continue;
  }

  let srcEntries;
  try {
    srcEntries = readdirSync(srcDir);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[copy-skill-md] cannot read ${srcDir}: ${reason}`);
    process.exit(1);
  }

  const mdFiles = srcEntries.filter(
    (name) => name.endsWith(".md") && statSync(path.join(srcDir, name)).isFile()
  );

  if (mdFiles.length === 0) {
    if (required) {
      console.error(`[copy-skill-md] no .md files found in ${srcDir}; aborting`);
      process.exit(1);
    }
    continue;
  }

  mkdirSync(dstDir, { recursive: true });
  for (const file of mdFiles) {
    copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
  }
  console.log(
    `[copy-skill-md] mirrored ${mdFiles.length} ${label} .md files → ${dst}/`
  );
}
