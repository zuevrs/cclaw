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
        origin_run: "feat/auth-hardening",
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
        origin_run: "docs/polish",
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
    expect(selected[0]?.trigger).toContain("auth handler");
    expect(selected[0]?.stage).toBe("review");
  });

  it("returns empty list for empty store", async () => {
    const root = await createTempProject("knowledge-empty");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), "", "utf8");
    const selected = await selectRelevantLearnings(root, { stage: "tdd" });
    expect(selected).toEqual([]);
  });

  it("does not include generic stage-null learnings in stage-specific retrieval without a strong match", async () => {
    const root = await createTempProject("knowledge-select-stage-null");
    const knowledgeDir = path.join(root, ".cclaw");
    await fs.mkdir(knowledgeDir, { recursive: true });
    const base = {
      type: "lesson",
      action: "capture specific evidence",
      confidence: "high",
      domain: "workflow",
      origin_stage: null,
      origin_run: null,
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: "2026-01-01T00:00:00Z",
      first_seen_ts: "2026-01-01T00:00:00Z",
      last_seen_ts: "2026-01-01T00:00:00Z",
      project: "cclaw"
    };
    await fs.writeFile(
      path.join(knowledgeDir, "knowledge.jsonl"),
      `${JSON.stringify({
        ...base,
        trigger: "general process reminder",
        stage: null
      })}
${JSON.stringify({
        ...base,
        trigger: "review stage needs explicit finding evidence",
        stage: "review",
        origin_stage: "review"
      })}
`,
      "utf8"
    );

    const selected = await selectRelevantLearnings(root, { stage: "review" });
    expect(selected.map((entry) => entry.trigger)).toEqual([
      "review stage needs explicit finding evidence"
    ]);
  });

  it("includes stage-null learnings when contextual tokens strongly match", async () => {
    const root = await createTempProject("knowledge-select-stage-null-strong");
    const knowledgeDir = path.join(root, ".cclaw");
    await fs.mkdir(knowledgeDir, { recursive: true });
    await fs.writeFile(
      path.join(knowledgeDir, "knowledge.jsonl"),
      `${JSON.stringify({
        type: "pattern",
        trigger: "auth token logging incident",
        action: "redact auth token logs",
        confidence: "high",
        domain: "auth",
        stage: null,
        origin_stage: null,
        origin_run: "auth-token-hardening",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-01-01T00:00:00Z",
        first_seen_ts: "2026-01-01T00:00:00Z",
        last_seen_ts: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })}
`,
      "utf8"
    );

    const selected = await selectRelevantLearnings(root, {
      stage: "review",
      branch: "auth-token-hardening",
      diffFiles: ["src/auth/token.ts"]
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.stage).toBeNull();
  });

  it("preserves short uppercase technical tokens without enabling lowercase noise", async () => {
    const root = await createTempProject("knowledge-select-short-tech");
    const knowledgeDir = path.join(root, ".cclaw");
    await fs.mkdir(knowledgeDir, { recursive: true });
    const base = {
      type: "pattern",
      action: "keep the guidance focused",
      confidence: "high",
      domain: "workflow",
      stage: null,
      origin_stage: null,
      origin_run: null,
      frequency: 1,
      universality: "project",
      maturity: "raw",
      created: "2026-01-01T00:00:00Z",
      first_seen_ts: "2026-01-01T00:00:00Z",
      last_seen_ts: "2026-01-01T00:00:00Z",
      project: "cclaw"
    };
    await fs.writeFile(
      path.join(knowledgeDir, "knowledge.jsonl"),
      `${JSON.stringify({
        ...base,
        trigger: "CI workflow flakes",
        action: "stabilize CI workflow"
      })}
${JSON.stringify({
        ...base,
        trigger: "in process note",
        action: "do not match lowercase filler words"
      })}
`,
      "utf8"
    );

    const ciSelected = await selectRelevantLearnings(root, {
      stage: "review",
      branch: "CI-fix",
      diffFiles: [".github/workflows/CI.yml"]
    });
    expect(ciSelected.map((entry) => entry.trigger)).toEqual(["CI workflow flakes"]);

    const lowercaseSelected = await selectRelevantLearnings(root, {
      stage: "review",
      branch: "in-fix",
      diffFiles: ["docs/in.md"]
    });
    expect(lowercaseSelected).toEqual([]);
  });

  it("keeps legacy supersession metadata rows during relevance scoring", async () => {
    const root = await createTempProject("knowledge-select-supersession");
    const knowledgeDir = path.join(root, ".cclaw");
    await fs.mkdir(knowledgeDir, { recursive: true });
    const base = {
      type: "lesson",
      action: "use the current guidance",
      confidence: "high",
      domain: "auth",
      stage: "review",
      origin_stage: "review",
      origin_run: "auth-hardening",
      frequency: 3,
      universality: "project",
      maturity: "raw",
      created: "2026-01-01T00:00:00Z",
      first_seen_ts: "2026-01-01T00:00:00Z",
      last_seen_ts: "2026-01-01T00:00:00Z",
      project: "cclaw"
    };
    await fs.writeFile(
      path.join(knowledgeDir, "knowledge.jsonl"),
      `${JSON.stringify({
        ...base,
        trigger: "old auth logging workaround",
        superseded_by: "new auth logging guidance",
        last_seen_ts: "2026-01-04T00:00:00Z"
      })}
${JSON.stringify({
        ...base,
        trigger: "legacy auth redaction rule",
        last_seen_ts: "2026-01-03T00:00:00Z"
      })}
${JSON.stringify({
        ...base,
        trigger: "new auth logging guidance",
        supersedes: ["legacy auth redaction rule"],
        last_seen_ts: "2026-01-02T00:00:00Z"
      })}
`,
      "utf8"
    );

    const selected = await selectRelevantLearnings(root, {
      stage: "review",
      branch: "auth-hardening",
      diffFiles: ["src/auth/logging.ts"]
    });

    expect(selected.map((entry) => entry.trigger)).toEqual([
      "old auth logging workaround",
      "new auth logging guidance",
      "legacy auth redaction rule"
    ]);
  });

});
