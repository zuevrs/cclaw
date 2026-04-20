import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendKnowledge,
  type KnowledgeEntry,
  type KnowledgeSeedEntry
} from "../../src/knowledge-store.js";
import { createTempProject } from "../helpers/index.js";

describe("knowledge store append helper", () => {
  it("appends validated entries with defaults and normalized timestamps", async () => {
    const root = await createTempProject("knowledge-append");
    const result = await appendKnowledge(
      root,
      [
        {
          type: "pattern",
          trigger: " when dependency queue spikes ",
          action: "route overflow to dead-letter queue and page on-call",
          confidence: "medium",
          severity: "critical"
        }
      ],
      {
        stage: "review",
        originFeature: "queue-hardening",
        project: "cclaw",
        source: "stage",
        nowIso: "2026-04-19T11:00:00Z"
      }
    );

    expect(result.appended).toBe(1);
    expect(result.invalid).toBe(0);
    expect(result.skippedDuplicates).toBe(0);

    const raw = await fs.readFile(path.join(root, ".cclaw/knowledge.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as KnowledgeEntry;
    expect(parsed.trigger).toBe("when dependency queue spikes");
    expect(parsed.stage).toBe("review");
    expect(parsed.origin_stage).toBe("review");
    expect(parsed.origin_feature).toBe("queue-hardening");
    expect(parsed.frequency).toBe(1);
    expect(parsed.source).toBe("stage");
    expect(parsed.severity).toBe("critical");
    expect(parsed.created).toBe("2026-04-19T11:00:00Z");
    expect(parsed.first_seen_ts).toBe("2026-04-19T11:00:00Z");
    expect(parsed.last_seen_ts).toBe("2026-04-19T11:00:00Z");
  });

  it("dedupes repeated trigger/action entries within batch and store", async () => {
    const root = await createTempProject("knowledge-dedupe");
    const seed: KnowledgeSeedEntry = {
      type: "rule",
      trigger: "when stage closeout starts",
      action: "run stage-complete helper before mutating flow state",
      confidence: "high",
      domain: "workflow"
    };

    const first = await appendKnowledge(
      root,
      [seed, seed],
      { stage: "scope", project: "cclaw", nowIso: "2026-04-19T11:05:00Z" }
    );
    expect(first.appended).toBe(1);
    expect(first.skippedDuplicates).toBe(1);

    const second = await appendKnowledge(
      root,
      [seed],
      { stage: "scope", project: "cclaw", nowIso: "2026-04-19T11:06:00Z" }
    );
    expect(second.appended).toBe(0);
    expect(second.skippedDuplicates).toBe(1);

    const raw = await fs.readFile(path.join(root, ".cclaw/knowledge.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("rejects invalid entries and does not append malformed rows", async () => {
    const root = await createTempProject("knowledge-invalid");
    const invalidSeed = {
      type: "pattern",
      trigger: "when retries exceed cap",
      action: "pause write path",
      confidence: "certain"
    } as unknown as KnowledgeSeedEntry;

    const result = await appendKnowledge(root, [invalidSeed], {
      stage: "plan",
      project: "cclaw",
      nowIso: "2026-04-19T11:10:00Z"
    });

    expect(result.appended).toBe(0);
    expect(result.invalid).toBe(1);
    expect(result.errors.join(" ")).toContain("confidence");
    await expect(fs.stat(path.join(root, ".cclaw/knowledge.jsonl"))).rejects.toThrow();
  });

  it("rejects unknown severity values", async () => {
    const root = await createTempProject("knowledge-invalid-severity");
    const seed = {
      type: "lesson",
      trigger: "when deployment pressure rises",
      action: "run a focused rollback drill",
      confidence: "high",
      severity: "blocker"
    } as unknown as KnowledgeSeedEntry;

    const result = await appendKnowledge(root, [seed], {
      stage: "ship",
      project: "cclaw",
      nowIso: "2026-04-19T11:12:00Z"
    });

    expect(result.appended).toBe(0);
    expect(result.invalid).toBe(1);
    expect(result.errors.join(" ")).toContain("severity");
  });

  it("rejects unknown source values", async () => {
    const root = await createTempProject("knowledge-invalid-source");
    const seed = {
      type: "rule",
      trigger: "when importing external learnings",
      action: "normalize source tags before append",
      confidence: "medium",
      source: "unknown-channel"
    } as unknown as KnowledgeSeedEntry;

    const result = await appendKnowledge(root, [seed], {
      stage: "plan",
      project: "cclaw",
      nowIso: "2026-04-19T11:12:00Z"
    });

    expect(result.appended).toBe(0);
    expect(result.invalid).toBe(1);
    expect(result.errors.join(" ")).toContain("source");
  });
});
