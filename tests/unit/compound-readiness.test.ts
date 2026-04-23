import { describe, expect, it } from "vitest";
import {
  computeCompoundReadiness,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";

function entry(partial: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    type: "pattern",
    trigger: "missing trigger",
    action: "missing action",
    confidence: "medium",
    domain: null,
    stage: "review",
    origin_stage: "review",
    origin_feature: null,
    project: "cclaw",
    source: "stage",
    universality: "project",
    maturity: "raw",
    frequency: 1,
    created: "2026-04-01T00:00:00Z",
    first_seen_ts: "2026-04-01T00:00:00Z",
    last_seen_ts: "2026-04-01T00:00:00Z",
    ...partial
  } as KnowledgeEntry;
}

describe("computeCompoundReadiness", () => {
  it("returns empty status on empty knowledge", () => {
    const status = computeCompoundReadiness([]);
    expect(status.schemaVersion).toBe(2);
    expect(status.clusterCount).toBe(0);
    expect(status.readyCount).toBe(0);
    expect(status.ready).toEqual([]);
    expect(status.threshold).toBe(3);
    expect(status.baseThreshold).toBe(3);
    expect(status.smallProjectRelaxationApplied).toBe(false);
    expect(status.archivedRunsCount).toBeUndefined();
  });

  it("applies small-project relaxation when archivedRunsCount < 5", () => {
    const entries = [
      entry({ trigger: "t", action: "a", frequency: 1 }),
      entry({ trigger: "t", action: "a", frequency: 1 })
    ];
    const status = computeCompoundReadiness(entries, {
      threshold: 3,
      archivedRunsCount: 2
    });
    expect(status.baseThreshold).toBe(3);
    expect(status.threshold).toBe(2);
    expect(status.smallProjectRelaxationApplied).toBe(true);
    expect(status.archivedRunsCount).toBe(2);
    expect(status.readyCount).toBe(1);
  });

  it("does not apply small-project relaxation when threshold already <= 2", () => {
    const status = computeCompoundReadiness([], {
      threshold: 2,
      archivedRunsCount: 0
    });
    expect(status.baseThreshold).toBe(2);
    expect(status.threshold).toBe(2);
    expect(status.smallProjectRelaxationApplied).toBe(false);
  });

  it("does not apply small-project relaxation when archivedRunsCount >= 5", () => {
    const status = computeCompoundReadiness([], {
      threshold: 3,
      archivedRunsCount: 5
    });
    expect(status.baseThreshold).toBe(3);
    expect(status.threshold).toBe(3);
    expect(status.smallProjectRelaxationApplied).toBe(false);
  });

  it("clusters by (type, normalized trigger, normalized action) and sums frequency", () => {
    const entries = [
      entry({
        trigger: "  Empty  catch swallows errors  ",
        action: "Re-throw or log with stack",
        frequency: 2,
        last_seen_ts: "2026-04-10T00:00:00Z"
      }),
      entry({
        trigger: "empty catch swallows errors",
        action: "re-throw or log with stack",
        frequency: 1,
        last_seen_ts: "2026-04-12T00:00:00Z"
      }),
      entry({
        trigger: "different trigger",
        action: "different action",
        frequency: 1
      })
    ];
    const status = computeCompoundReadiness(entries, { threshold: 3 });
    expect(status.clusterCount).toBe(2);
    expect(status.readyCount).toBe(1);
    expect(status.ready[0]).toMatchObject({
      recurrence: 3,
      entryCount: 2,
      qualification: "recurrence",
      lastSeenTs: "2026-04-12T00:00:00Z"
    });
  });

  it("excludes already lifted entries", () => {
    const entries = [
      entry({ trigger: "x", action: "y", frequency: 5, maturity: "lifted-to-enforcement" })
    ];
    const status = computeCompoundReadiness(entries, { threshold: 3 });
    expect(status.clusterCount).toBe(0);
    expect(status.readyCount).toBe(0);
  });

  it("promotes critical clusters via critical_override even when below threshold", () => {
    const entries = [
      entry({
        trigger: "auth bypass on header parse",
        action: "validate signature before any side-effect",
        severity: "critical",
        frequency: 1
      })
    ];
    const status = computeCompoundReadiness(entries, { threshold: 5 });
    expect(status.readyCount).toBe(1);
    expect(status.ready[0]?.qualification).toBe("critical_override");
    expect(status.ready[0]?.severity).toBe("critical");
  });

  it("sorts critical-first, then by recurrence, then by recency", () => {
    const entries = [
      entry({
        trigger: "low recurrence",
        action: "minor",
        frequency: 3,
        last_seen_ts: "2026-03-01T00:00:00Z"
      }),
      entry({
        trigger: "high recurrence",
        action: "more frequent",
        frequency: 6,
        last_seen_ts: "2026-03-05T00:00:00Z"
      }),
      entry({
        trigger: "critical hotspot",
        action: "fix asap",
        severity: "critical",
        frequency: 1
      })
    ];
    const status = computeCompoundReadiness(entries, { threshold: 3 });
    expect(status.ready.map((cluster) => cluster.trigger)).toEqual([
      "critical hotspot",
      "high recurrence",
      "low recurrence"
    ]);
  });

  it("caps the ready[] list via maxReady", () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry({
        trigger: `trigger ${i}`,
        action: `action ${i}`,
        frequency: 4
      })
    );
    const status = computeCompoundReadiness(entries, { threshold: 3, maxReady: 5 });
    expect(status.clusterCount).toBe(12);
    expect(status.readyCount).toBe(12);
    expect(status.ready).toHaveLength(5);
  });
});
