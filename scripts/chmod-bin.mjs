#!/usr/bin/env node
// Post-build: ensure bin entrypoints ship with the executable bit set.
//
// tsc emits output files with mode 0644. npm/npx does set +x on bin
// targets during install, but some cache and mirror environments leave
// the stored mode as-is, which produces "Permission denied" at runtime.
// Stamping +x at pack time is cheap and removes that failure class
// entirely.

import { chmod, readFile, stat } from "node:fs/promises";
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
  console.log("[chmod-bin] no bin entries in package.json, nothing to do");
  process.exit(0);
}

const missing = [];
for (const rel of binPaths) {
  const abs = path.resolve(repoRoot, rel);
  try {
    await stat(abs);
  } catch {
    missing.push(rel);
    continue;
  }
  await chmod(abs, 0o755);
  console.log(`[chmod-bin] ${rel} -> 0755`);
}

if (missing.length > 0) {
  console.error(
    `[chmod-bin] missing bin targets (did build run first?): ${missing.join(", ")}`
  );
  process.exit(1);
}
