import path from "node:path";
import { exists } from "./fs-utils.js";
import { type HarnessId } from "./types.js";

interface HarnessMarkers {
  harness: HarnessId;
  markers: string[];
}

const HARNESS_MARKERS: HarnessMarkers[] = [
  { harness: "claude", markers: [".claude", "CLAUDE.md"] },
  { harness: "cursor", markers: [".cursor"] },
  { harness: "opencode", markers: [".opencode", "opencode.json", "opencode.jsonc"] },
  { harness: "codex", markers: [".codex", ".agents/skills"] }
];

/**
 * Detect which harnesses are already wired up in the project root.
 * Used by `cclaw init` when the operator does not pass --harness=<id>.
 *
 * Markers are intentionally minimal — presence of any one marker per harness
 * is enough to elect it. Returns harnesses in canonical (HARNESS_IDS) order.
 */
export async function detectHarnesses(projectRoot: string): Promise<HarnessId[]> {
  const detected: HarnessId[] = [];
  for (const { harness, markers } of HARNESS_MARKERS) {
    for (const marker of markers) {
      if (await exists(path.join(projectRoot, marker))) {
        detected.push(harness);
        break;
      }
    }
  }
  return detected;
}

export const NO_HARNESS_DETECTED_MESSAGE =
  "No harness detected in project root. Pass --harness=<id>[,<id>] (claude,cursor,opencode,codex) " +
  "or create a marker first (e.g. `mkdir .cursor` for Cursor, `mkdir .claude` for Claude Code).";
