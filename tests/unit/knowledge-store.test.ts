import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendKnowledge,
  readKnowledgeSafely,
  validateKnowledgeEntry,
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
        originRun: "queue-hardening",
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
    expect(parsed.origin_run).toBe("queue-hardening");
    expect(parsed.frequency).toBe(1);
    expect(parsed.source).toBe("stage");
    expect(parsed.severity).toBe("critical");
    expect(parsed.created).toBe("2026-04-19T11:00:00Z");
    expect(parsed.first_seen_ts).toBe("2026-04-19T11:00:00Z");
    expect(parsed.last_seen_ts).toBe("2026-04-19T11:00:00Z");
  });

  it("dedupes repeated trigger/action entries within batch and store while bumping frequency", async () => {
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
    const parsed = JSON.parse(lines[0]!) as KnowledgeEntry;
    expect(parsed.frequency).toBe(3);
    expect(parsed.last_seen_ts).toBe("2026-04-19T11:06:00Z");
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

  it("tolerates a UTF-8 BOM on existing knowledge.jsonl and does not drop the first entry on dedupe", async () => {
    const root = await createTempProject("knowledge-bom");
    const jsonlPath = path.join(root, ".cclaw/knowledge.jsonl");
    await fs.mkdir(path.dirname(jsonlPath), { recursive: true });

    const existingEntry: KnowledgeEntry = {
      type: "pattern",
      trigger: "bom sentinel",
      action: "preserve first entry",
      confidence: "medium",
      domain: null,
      stage: "plan",
      origin_stage: "plan",
      origin_run: null,
      project: "cclaw",
      frequency: 1,
      universality: "project",
      maturity: "raw",
      first_seen_ts: "2026-04-19T11:00:00Z",
      last_seen_ts: "2026-04-19T11:00:00Z",
      created: "2026-04-19T11:00:00Z"
    };
    // Prepend a BOM (U+FEFF) to simulate an editor that saved UTF-8 with BOM.
    const jsonl = `\uFEFF${JSON.stringify(existingEntry)}\n`;
    await fs.writeFile(jsonlPath, jsonl, "utf8");

    const result = await appendKnowledge(
      root,
      [
        {
          type: existingEntry.type,
          trigger: existingEntry.trigger,
          action: existingEntry.action,
          confidence: existingEntry.confidence
        }
      ],
      { stage: "plan", project: "cclaw", nowIso: "2026-04-19T11:01:00Z" }
    );

    // The BOM entry must be indexed, so the identical seed is detected as
    // a duplicate rather than silently re-appended. Before the fix the BOM
    // made the first line unparseable and this dedupe was skipped.
    expect(result.appended).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
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

  it("reads knowledge with BOM stripping and malformed-line accounting", async () => {
    const root = await createTempProject("knowledge-read-safe");
    const knowledgePath = path.join(root, ".cclaw/knowledge.jsonl");
    await fs.mkdir(path.dirname(knowledgePath), { recursive: true });
    const validEntry: KnowledgeEntry = {
      type: "pattern",
      trigger: "stable trigger",
      action: "stable action",
      confidence: "medium",
      domain: null,
      stage: "plan",
      origin_stage: "plan",
      origin_run: null,
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: "2026-04-20T11:00:00Z",
      first_seen_ts: "2026-04-20T11:00:00Z",
      last_seen_ts: "2026-04-20T11:00:00Z",
      project: "cclaw"
    };
    await fs.writeFile(
      knowledgePath,
      `\uFEFF${JSON.stringify(validEntry)}\n{not-json}\n${JSON.stringify({
        ...validEntry,
        trigger: "second trigger"
      })}\n`,
      "utf8"
    );

    const parsed = await readKnowledgeSafely(root);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.malformedLines).toBe(1);
    expect(parsed.entries[0]?.trigger).toBe("stable trigger");
    expect(parsed.entries[1]?.trigger).toBe("second trigger");
  });

  it("reads legacy origin_feature rows as origin_run", async () => {
    const root = await createTempProject("knowledge-legacy-origin-feature");
    const knowledgePath = path.join(root, ".cclaw/knowledge.jsonl");
    await fs.mkdir(path.dirname(knowledgePath), { recursive: true });
    await fs.writeFile(
      knowledgePath,
      `${JSON.stringify({
        type: "pattern",
        trigger: "legacy trigger",
        action: "preserve legacy origin label",
        confidence: "medium",
        domain: null,
        stage: "plan",
        origin_stage: "plan",
        origin_feature: "legacy-run",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-04-20T11:00:00Z",
        first_seen_ts: "2026-04-20T11:00:00Z",
        last_seen_ts: "2026-04-20T11:00:00Z",
        project: "cclaw"
      })}\n`,
      "utf8"
    );

    const parsed = await readKnowledgeSafely(root);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.origin_run).toBe("legacy-run");
    expect(parsed.malformedLines).toBe(0);
  });

  it("accepts optional supersession fields while reading existing schema rows", async () => {
    const root = await createTempProject("knowledge-supersession-fields");
    const result = await appendKnowledge(
      root,
      [
        {
          type: "lesson",
          trigger: "when compound refresh replaces stale guidance",
          action: "append a focused replacement and mark the relationship",
          confidence: "medium",
          supersedes: ["old-compound-guidance"],
          superseded_by: "new-compound-guidance"
        }
      ],
      { stage: "ship", project: "cclaw", source: "compound", nowIso: "2026-04-20T11:30:00Z" }
    );

    expect(result.appended).toBe(1);
    expect(result.invalid).toBe(0);
    const parsed = await readKnowledgeSafely(root);
    expect(parsed.entries[0]?.supersedes).toEqual(["old-compound-guidance"]);
    expect(parsed.entries[0]?.superseded_by).toBe("new-compound-guidance");
  });

  it("rejects malformed supersession fields", async () => {
    const root = await createTempProject("knowledge-invalid-supersession");
    const result = await appendKnowledge(
      root,
      [
        {
          type: "lesson",
          trigger: "when supersession metadata is malformed",
          action: "reject the learning",
          confidence: "medium",
          supersedes: []
        }
      ],
      { stage: "ship", project: "cclaw", nowIso: "2026-04-20T11:31:00Z" }
    );

    expect(result.appended).toBe(0);
    expect(result.invalid).toBe(1);
    expect(result.errors.join(" ")).toContain("supersedes");
  });

  it("requires canonical origin_run for direct validation while allowing legacy reads", async () => {
    const legacyRow = {
      type: "pattern",
      trigger: "legacy trigger",
      action: "normalize during reads",
      confidence: "medium",
      domain: null,
      stage: "plan",
      origin_stage: "plan",
      origin_feature: "legacy-run",
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: "2026-04-20T11:00:00Z",
      first_seen_ts: "2026-04-20T11:00:00Z",
      last_seen_ts: "2026-04-20T11:00:00Z",
      project: "cclaw"
    };

    expect(validateKnowledgeEntry(legacyRow).ok).toBe(false);
    const compat = validateKnowledgeEntry(legacyRow, { allowLegacyOriginFeature: true });
    expect(compat.ok).toBe(true);
  });

});
