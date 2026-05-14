import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { OUTCOME_SIGNALS } from "../../src/knowledge-store.js";
import {
  FLOW_STAGES,
  HARNESS_IDS,
  POSTURES,
  SPECIALISTS,
  SURFACES
} from "../../src/types.js";

/**
 * Canonical surface counts — single source of truth.
 *
 * Tests that depend on "there are N <thing>s" used to hardcode the literal
 * count and drift each time a slug added or retired an entry, forcing the
 * cross-file edit. As of v8.54 they import COUNTS and assert against the
 * structurally-derived number. The intent is to test SHAPE ("one row per
 * surface", "every specialist has a prompt"), not LITERAL ARITY.
 *
 * If you really want to assert the literal number changed, do so once in a
 * dedicated migration test (e.g. `v8.55-...test.ts`) — not in 7 files.
 */
export const COUNTS = {
  specialists: SPECIALISTS.length,
  agents: CORE_AGENTS.length,
  skills: AUTO_TRIGGER_SKILLS.length,
  postures: POSTURES.length,
  outcomeSignals: OUTCOME_SIGNALS.length,
  flowStages: FLOW_STAGES.length,
  harnesses: HARNESS_IDS.length,
  surfaces: SURFACES.length
} as const;
