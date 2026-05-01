import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import {
  recordExpansionStrategistSkippedByTrack,
  recordArtifactValidationDemotedByTrack,
  readDelegationEvents
} from "../../src/delegation.js";

/**
 * Wave 25 (v6.1.0) — Expansion Strategist track-aware skip audit.
 *
 * Mirrors `mandatory_delegations_skipped_by_track` (Wave 24) and
 * `artifact_validation_demoted_by_track` (Wave 25-A): a non-delegation
 * audit event written to `delegation-events.jsonl` whenever the
 * scope-stage Expansion Strategist (`product-discovery`) requirement
 * is dropped because the active run is on a small-fix lane.
 *
 * `readDelegationEvents` MUST recognize the new event so it does not
 * surface as a corrupt line.
 */

describe("Wave 25 — recordExpansionStrategistSkippedByTrack audit", () => {
  it("appends an audit event recognized by readDelegationEvents", async () => {
    const root = await createTempProject("wave-25-strategist-skip-quick");
    await recordExpansionStrategistSkippedByTrack(root, {
      track: "quick",
      taskClass: null,
      runId: "run-strategist-skip-quick",
      selectedScopeMode: "SELECTIVE EXPANSION"
    });
    const eventsPath = path.join(root, ".cclaw/state/delegation-events.jsonl");
    const raw = await fs.readFile(eventsPath, "utf8");
    expect(raw).toMatch(/expansion_strategist_skipped_by_track/u);
    expect(raw).toMatch(/SELECTIVE EXPANSION/u);
    expect(raw).toMatch(/run-strategist-skip-quick/u);

    const { events, corruptLines } = await readDelegationEvents(root);
    // The audit event is intentionally NOT a regular DelegationEvent
    // (no agent/spanId) — `readDelegationEvents` must filter it out
    // without flagging it as corrupt.
    expect(corruptLines).toEqual([]);
    expect(events.length).toBe(0);
  });

  it("appends an audit event for software-bugfix taskClass on standard track", async () => {
    const root = await createTempProject("wave-25-strategist-skip-bugfix");
    await recordExpansionStrategistSkippedByTrack(root, {
      track: "standard",
      taskClass: "software-bugfix",
      runId: "run-strategist-skip-bugfix",
      selectedScopeMode: "SCOPE EXPANSION"
    });
    const eventsPath = path.join(root, ".cclaw/state/delegation-events.jsonl");
    const raw = await fs.readFile(eventsPath, "utf8");
    expect(raw).toMatch(/expansion_strategist_skipped_by_track/u);
    expect(raw).toMatch(/software-bugfix/u);
    expect(raw).toMatch(/SCOPE EXPANSION/u);
  });
});

describe("Wave 25 — recordArtifactValidationDemotedByTrack audit (W25-A)", () => {
  it("appends an audit event with the demoted section list", async () => {
    const root = await createTempProject("wave-25-artifact-demote-quick");
    await recordArtifactValidationDemotedByTrack(root, {
      stage: "design",
      track: "quick",
      taskClass: null,
      runId: "run-artifact-demote-quick",
      sections: ["Architecture Diagram", "Data Flow", "Stale Diagram Drift Check"]
    });
    const eventsPath = path.join(root, ".cclaw/state/delegation-events.jsonl");
    const raw = await fs.readFile(eventsPath, "utf8");
    expect(raw).toMatch(/artifact_validation_demoted_by_track/u);
    expect(raw).toMatch(/Architecture Diagram/u);
    expect(raw).toMatch(/Data Flow/u);
    expect(raw).toMatch(/Stale Diagram Drift Check/u);

    const { events, corruptLines } = await readDelegationEvents(root);
    expect(corruptLines).toEqual([]);
    expect(events.length).toBe(0);
  });

  it("is a no-op when sections list is empty (avoids audit-spam)", async () => {
    const root = await createTempProject("wave-25-artifact-demote-empty");
    await recordArtifactValidationDemotedByTrack(root, {
      stage: "design",
      track: "quick",
      taskClass: null,
      runId: "run-artifact-demote-empty",
      sections: []
    });
    const eventsPath = path.join(root, ".cclaw/state/delegation-events.jsonl");
    let exists = true;
    try {
      await fs.access(eventsPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
