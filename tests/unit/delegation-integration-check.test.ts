import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  integrationCheckRequired,
  recordIntegrationOverseerSkipped
} from "../../src/delegation.js";
import type {
  DelegationEvent,
  FanInAuditRecord
} from "../../src/delegation.js";
import { createTempProject } from "../helpers/index.js";

function greenEvent(overrides: Partial<DelegationEvent>): DelegationEvent {
  const ts = new Date().toISOString();
  return {
    stage: "tdd",
    agent: "slice-implementer",
    mode: "mandatory",
    status: "completed",
    phase: "green",
    sliceId: "S-?",
    ts,
    completedTs: ts,
    event: "completed",
    eventTs: ts,
    schemaVersion: 3,
    ...overrides
  } as DelegationEvent;
}

describe("integrationCheckRequired (v6.14.0)", () => {
  it("returns required=false on disjoint paths and no risk", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["src/a/x.ts"] }),
      greenEvent({ sliceId: "S-2", claimedPaths: ["src/b/y.ts"] })
    ];
    const v = integrationCheckRequired(events);
    expect(v.required).toBe(false);
    expect(v.reasons).toContain("disjoint-paths");
  });

  it("returns required=true when two slices share a directory prefix", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["src/auth/login.ts"] }),
      greenEvent({ sliceId: "S-2", claimedPaths: ["src/auth/session.ts"] })
    ];
    const v = integrationCheckRequired(events);
    expect(v.required).toBe(true);
    expect(v.reasons).toContain("shared-import-boundary");
  });

  it("returns required=true when any slice has riskTier=high", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["src/a/x.ts"] }),
      greenEvent({
        sliceId: "S-2",
        claimedPaths: ["src/b/y.ts"],
        riskTier: "high"
      })
    ];
    const v = integrationCheckRequired(events);
    expect(v.required).toBe(true);
    expect(v.reasons).toContain("high-risk-slice");
  });

  it("returns required=true when fanin-audit reports a conflict", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["src/a/x.ts"] }),
      greenEvent({ sliceId: "S-2", claimedPaths: ["src/b/y.ts"] })
    ];
    const audits: FanInAuditRecord[] = [
      {
        event: "cclaw_fanin_conflict",
        runId: "run-test",
        ts: new Date().toISOString()
      }
    ];
    const v = integrationCheckRequired(events, audits);
    expect(v.required).toBe(true);
    expect(v.reasons).toContain("fanin-conflict");
  });

  it("ignores in-flight slices: only completed phase=green/refactor count", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["src/auth/x.ts"], status: "scheduled" }),
      greenEvent({ sliceId: "S-2", claimedPaths: ["src/auth/y.ts"], status: "scheduled" })
    ];
    const v = integrationCheckRequired(events);
    expect(v.required).toBe(false);
  });

  it("treats top-level files as a single-segment shared boundary", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["package.json"] }),
      greenEvent({ sliceId: "S-2", claimedPaths: ["package.json"] })
    ];
    const v = integrationCheckRequired(events);
    expect(v.required).toBe(true);
    expect(v.reasons).toContain("shared-import-boundary");
  });

  it("collapses multi-segment paths into a 2-segment package directory", () => {
    const events: DelegationEvent[] = [
      greenEvent({ sliceId: "S-1", claimedPaths: ["src/auth/oauth/google.ts"] }),
      greenEvent({ sliceId: "S-2", claimedPaths: ["src/auth/oauth/github.ts"] })
    ];
    const v = integrationCheckRequired(events);
    expect(v.required).toBe(true);
    expect(v.reasons).toContain("shared-import-boundary");
  });
});

describe("recordIntegrationOverseerSkipped (v6.14.0)", () => {
  it("appends a cclaw_integration_overseer_skipped audit row", async () => {
    const root = await createTempProject("integration-skipped-audit");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await recordIntegrationOverseerSkipped(root, {
      runId: "run-test",
      reasons: ["disjoint-paths"],
      sliceIds: ["S-1", "S-2"]
    });
    const eventsFile = path.join(root, ".cclaw/state/delegation-events.jsonl");
    const contents = await fs.readFile(eventsFile, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe("cclaw_integration_overseer_skipped");
    expect(parsed.runId).toBe("run-test");
    expect(parsed.reasons).toEqual(["disjoint-paths"]);
    expect(parsed.sliceIds).toEqual(["S-1", "S-2"]);
    expect(typeof parsed.ts).toBe("string");
  });

  it("never throws when the events directory is missing", async () => {
    const root = await createTempProject("integration-skipped-noop");
    await expect(
      recordIntegrationOverseerSkipped(root, {
        runId: "run-test",
        reasons: ["disjoint-paths"],
        sliceIds: ["S-1"]
      })
    ).resolves.toBeUndefined();
  });
});
