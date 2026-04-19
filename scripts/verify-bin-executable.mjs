#!/usr/bin/env node
// Verify that every `bin` entry declared in package.json is:
//   1) present on disk
//   2) starts with a `#!` shebang
//   3) has the executable bit set (mode & 0o111 != 0)
//
// Intended to run after `npm run build` and before `npm pack`, both
// locally and in CI, so that a "Permission denied" regression in the
// published tarball is caught immediately instead of after release.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const pkgPath = path.join(repoRoot, "package.json");

const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const binField = pkg.bin ?? {};
const binPaths = typeof binField === "string"
  ? [binField]
  : Object.values(binField);

if (binPaths.length === 0) {
  console.error("[verify-bin] package.json has no bin entries");
  process.exit(1);
}

const failures = [];
for (const rel of binPaths) {
  const abs = path.resolve(repoRoot, rel);
  try {
    const info = await stat(abs);
    const execBit = (info.mode & 0o111) !== 0;
    const head = (await readFile(abs, "utf8")).slice(0, 2);
    const hasShebang = head === "#!";
    if (!execBit || !hasShebang) {
      failures.push({
        rel,
        mode: info.mode.toString(8),
        execBit,
        hasShebang
      });
    } else {
      console.log(`[verify-bin] ${rel} ok (mode=${info.mode.toString(8)})`);
    }
  } catch (error) {
    failures.push({ rel, missing: true, error: String(error) });
  }
}

if (failures.length > 0) {
  console.error("[verify-bin] one or more bin targets are not executable:");
  for (const entry of failures) {
    console.error("  -", JSON.stringify(entry));
  }
  console.error(
    "\nFix: `npm run build` runs scripts/chmod-bin.mjs which sets 0755."
  );
  process.exit(1);
}

console.log(`[verify-bin] all ${binPaths.length} bin targets ok`);
