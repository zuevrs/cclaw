import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findMatchingSeeds,
  readSeedShelf,
  renderSeedTemplate,
  resolveSeedPathForWrite,
  seedFileName,
  seedShelfDir,
  seedSlug
} from "../../src/content/seed-shelf.js";
import { createTempProject } from "../helpers/index.js";

describe("seed shelf", () => {
  it("builds deterministic seed slugs and file names", () => {
    const slug = seedSlug("  Retry queue for flaky webhooks!  ");
    expect(slug).toBe("retry-queue-for-flaky-webhooks");
    const fileName = seedFileName("Retry queue for flaky webhooks", new Date("2026-04-23T10:00:00Z"));
    expect(fileName).toBe("SEED-2026-04-23-retry-queue-for-flaky-webhooks.md");
  });

  it("resolves unique seed file path when same slug already exists", async () => {
    const root = await createTempProject("seed-shelf-collision");
    const seedsDir = seedShelfDir(root);
    await fs.mkdir(seedsDir, { recursive: true });
    const first = "SEED-2026-04-23-cache-warmup-plan.md";
    await fs.writeFile(path.join(seedsDir, first), "# Existing seed\n", "utf8");

    const resolved = await resolveSeedPathForWrite(
      root,
      "Cache warmup plan",
      new Date("2026-04-23T10:00:00Z")
    );
    expect(resolved.fileName).toBe("SEED-2026-04-23-cache-warmup-plan-2.md");
    expect(resolved.relPath).toBe(path.join(".cclaw", "seeds", resolved.fileName));
  });

  it("reads and parses seed shelf entries", async () => {
    const root = await createTempProject("seed-shelf-read");
    const seedsDir = seedShelfDir(root);
    await fs.mkdir(seedsDir, { recursive: true });
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-22-batch-api-rate-limit.md"),
      `---
title: Batch API rate limit hardening
trigger_when:
  - rate limit
  - 429
source_stage: scope
source_artifact: .cclaw/artifacts/02-scope-payments.md
hypothesis: Current retries can flood the upstream API.
action: Add token bucket and backoff.
---

# Batch API rate limit hardening

Use adaptive backoff with a per-tenant token bucket.
`,
      "utf8"
    );

    const entries = await readSeedShelf(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Batch API rate limit hardening");
    expect(entries[0]?.triggerWhen).toEqual(["rate limit", "429"]);
    expect(entries[0]?.sourceStage).toBe("scope");
    expect(entries[0]?.sourceArtifact).toBe(".cclaw/artifacts/02-scope-payments.md");
  });

  it("finds matching seeds by trigger_when tokens", async () => {
    const root = await createTempProject("seed-shelf-match");
    const seedsDir = seedShelfDir(root);
    await fs.mkdir(seedsDir, { recursive: true });
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-22-retry-zombie-connections.md"),
      `---
title: Retry zombie connections
trigger_when:
  - zombie connection
  - stale socket
action: Add heartbeat timeout and reconnect.
---

# Retry zombie connections
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-21-cold-cache-startup.md"),
      `---
title: Cold cache startup warming
trigger_when:
  - cold start
action: Add startup warmup job.
---

# Cold cache startup warming
`,
      "utf8"
    );

    const matches = await findMatchingSeeds(
      root,
      "Users report zombie connection after laptop sleep in prod"
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("Retry zombie connections");
  });

  it("renders seed template with expected frontmatter shape", () => {
    const markdown = renderSeedTemplate({
      title: "Queue fallback strategy",
      triggerWhen: ["queue backlog > 1000", "retry storm"],
      hypothesis: "Current workers starve priority tasks during spikes.",
      action: "Split queues and enforce priority admission.",
      sourceStage: "design",
      sourceArtifact: ".cclaw/artifacts/03-design-queue.md",
      createdAt: new Date("2026-04-23T12:34:56Z")
    });
    expect(markdown).toContain("title: Queue fallback strategy");
    expect(markdown).toContain("trigger_when:");
    expect(markdown).toContain("- queue backlog > 1000");
    expect(markdown).toContain("source_stage: design");
    expect(markdown).toContain("source_artifact: .cclaw/artifacts/03-design-queue.md");
  });
  it("ranks exact trigger matches before token overlap and recency", async () => {
    const root = await createTempProject("seed-shelf-rank-exact");
    const seedsDir = seedShelfDir(root);
    await fs.mkdir(seedsDir, { recursive: true });
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-25-recent-token-overlap.md"),
      `---
title: Recent webhook retry design
trigger_when:
  - other trigger
hypothesis: Webhook retry failures need backoff.
action: Add retry backoff for webhook failures.
---

# Recent webhook retry design
Webhook retry failures need a bounded backoff design.
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-20-exact-webhook-trigger.md"),
      `---
title: Exact webhook retry seed
trigger_when:
  - webhook retry
hypothesis: Exact triggers should win.
action: Apply the exact trigger guidance.
---

# Exact webhook retry seed
`,
      "utf8"
    );

    const matches = await findMatchingSeeds(root, "Need webhook retry behavior for failed sends");
    expect(matches.map((seed) => seed.title)).toEqual([
      "Exact webhook retry seed",
      "Recent webhook retry design"
    ]);
  });

  it("matches seeds by bounded title summary hypothesis and action token overlap", async () => {
    const root = await createTempProject("seed-shelf-token-overlap");
    const seedsDir = seedShelfDir(root);
    await fs.mkdir(seedsDir, { recursive: true });
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-23-cache-warming.md"),
      `---
title: Cache warming seed
trigger_when:
  - unrelated trigger
hypothesis: Cold cache startup slows requests.
action: Warm cache keys during startup.
---

# Cache warming seed
Warm cache keys before serving traffic.
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(seedsDir, "SEED-2026-04-24-noisy-unrelated.md"),
      `---
title: Noisy unrelated seed
trigger_when:
  - unrelated trigger
hypothesis: A different problem.
action: Ignore this for cache work.
---

# Noisy unrelated seed
`,
      "utf8"
    );

    const matches = await findMatchingSeeds(root, "startup cache warming plan");
    expect(matches.map((seed) => seed.title)).toEqual(["Cache warming seed"]);
  });

  it("caps seed retrieval to a conservative maximum", async () => {
    const root = await createTempProject("seed-shelf-cap");
    const seedsDir = seedShelfDir(root);
    await fs.mkdir(seedsDir, { recursive: true });
    for (let index = 0; index < 12; index += 1) {
      const day = String(index + 1).padStart(2, "0");
      await fs.writeFile(
        path.join(seedsDir, `SEED-2026-04-${day}-shared-trigger-${index}.md`),
        `---
title: Shared trigger ${index}
trigger_when:
  - shared trigger
action: Apply shared trigger.
---

# Shared trigger ${index}
`,
        "utf8"
      );
    }

    const matches = await findMatchingSeeds(root, "shared trigger", 99);
    expect(matches).toHaveLength(10);
  });

});
