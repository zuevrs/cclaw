import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectRelevantLearnings } from "../../src/knowledge-store.js";
import { createTempProject } from "../helpers/index.js";

describe("selectRelevantLearnings", () => {
  it("prioritizes stage and diff-matching entries", async () => {
    const root = await createTempProject("knowledge-select");
    const knowledgeDir = path.join(root, ".cclaw");
    await fs.mkdir(knowledgeDir, { recursive: true });
    const store = path.join(knowledgeDir, "knowledge.jsonl");
    const rows = [
      {
        type: "rule",
        trigger: "auth handler writes session tokens",
        action: "sanitize auth logs and redact tokens",
        confidence: "high",
        domain: "auth",
        stage: "review",
        origin_stage: "review",
        origin_feature: "feat/auth-hardening",
        frequency: 4,
        universality: "project",
        maturity: "raw",
        created: "2026-01-01T00:00:00Z",
        first_seen_ts: "2026-01-01T00:00:00Z",
        last_seen_ts: "2026-01-02T00:00:00Z",
        project: "cclaw"
      },
      {
        type: "lesson",
        trigger: "ui copy mismatch",
        action: "sync docs and messages",
        confidence: "medium",
        domain: "docs",
        stage: "ship",
        origin_stage: "ship",
        origin_feature: "docs/polish",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-01-01T00:00:00Z",
        first_seen_ts: "2026-01-01T00:00:00Z",
        last_seen_ts: "2026-01-01T00:00:00Z",
        project: "cclaw"
      }
    ];
    await fs.writeFile(store, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    const selected = await selectRelevantLearnings(root, {
      stage: "review",
      branch: "feat/auth-hardening",
      diffFiles: ["src/auth/session.ts"],
      limit: 1
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.domain).toBe("auth");
    expect(selected[0]?.stage).toBe("review");
  });

  it("returns empty list for empty store", async () => {
    const root = await createTempProject("knowledge-empty");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), "", "utf8");
    const selected = await selectRelevantLearnings(root, { stage: "tdd" });
    expect(selected).toEqual([]);
  });
});
