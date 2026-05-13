#!/usr/bin/env node
// v8.40 — cclaw no longer ships session-start.mjs / commit-helper.mjs hooks,
// so there is nothing to wire into harness-specific plugin manifests. This
// script now just emits an empty release-artifacts/plugin-manifests/index.json
// so anything that downloads from the release artefacts layout finds a
// well-formed empty listing instead of a 404.
//
// The script is wired into `npm run release:check`; keeping a thin no-op
// here avoids churn in the release scripts and CI.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputDir = join(process.cwd(), "release-artifacts", "plugin-manifests");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const indexPayload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  optional: true,
  description:
    "cclaw v8.40+ ships no harness hook manifests (hooks were retired; TDD enforcement is prompt-only + git-log inspection). Listing kept for back-compat with downstream tooling that expects this path to exist.",
  files: []
};
writeFileSync(join(outputDir, "index.json"), `${JSON.stringify(indexPayload, null, 2)}\n`, "utf8");

process.stdout.write(`[plugin-manifests] generated empty listing in ${outputDir} (v8.40 hooks removed)\n`);
