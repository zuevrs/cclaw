import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { topologicalLayers } from "../../src/slice-topology.js";

/**
 * v8.64 — parallel-by-default for multi-slice tasks.
 *
 * v8.63 separated work-units (slices) from verification (AC) and
 * stamped each slice with `dependsOn: SliceId[]` + a derived
 * `independent: boolean` flag. The builder still ran slices
 * sequentially. v8.64 wires the metadata into the dispatch path:
 * builder reads slices on dispatch, computes topological layers, and
 * for layers of size ≥2 dispatches sub-builders in parallel via the
 * harness's sub-agent primitive. Single-slice tasks (one layer of
 * one slice) run inline with zero overhead.
 *
 * Each tripwire below pins one invariant of the parallel-by-default
 * contract. Any of them lighting up means v8.64 has drifted.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("v8.64 — src/slice-topology.ts exports topologicalLayers", () => {
  it("topologicalLayers is a callable export", () => {
    expect(typeof topologicalLayers).toBe("function");
  });

  it("source file exists at the canonical path src/slice-topology.ts", async () => {
    const body = await fs.readFile(
      path.join(REPO_ROOT, "src", "slice-topology.ts"),
      "utf8",
    );
    expect(body).toMatch(/export function topologicalLayers/);
  });

  it("topologicalLayers returns layers of one for a linear chain (sanity check)", () => {
    const slices = [
      { id: "SL-1" as const, dependsOn: [] },
      { id: "SL-2" as const, dependsOn: ["SL-1" as const] },
    ];
    const layers = topologicalLayers(slices);
    expect(layers).toHaveLength(2);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1"]);
    expect(layers[1].map((s) => s.id)).toEqual(["SL-2"]);
  });

  it("topologicalLayers returns a single layer for independent slices (parallel dispatch shape)", () => {
    const slices = [
      { id: "SL-1" as const, dependsOn: [] },
      { id: "SL-2" as const, dependsOn: [] },
    ];
    const layers = topologicalLayers(slices);
    expect(layers).toHaveLength(1);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1", "SL-2"]);
  });
});

describe("v8.64 — Builder contract describes parallel topological layer dispatch", () => {
  it("builder prompt names the v8.64 'Topological layer dispatch' section", () => {
    expect(
      BUILDER_PROMPT,
      "builder must have a dedicated section explaining topological layer dispatch",
    ).toMatch(/Topological layer dispatch/);
  });

  it("builder prompt mentions parallel-by-default semantics", () => {
    expect(
      BUILDER_PROMPT,
      "builder must call out parallel-by-default as the new strict-mode default",
    ).toMatch(/parallel-by-default/i);
  });

  it("builder prompt mentions dispatching one sub-builder per slice in PARALLEL for layers of size ≥2", () => {
    expect(
      BUILDER_PROMPT,
      "builder must dispatch one sub-builder per slice in PARALLEL when a layer has ≥2 slices",
    ).toMatch(/sub-builder.*parallel|parallel.*sub-builder/i);
  });

  it("builder prompt mentions topologicalLayers utility by name", () => {
    expect(
      BUILDER_PROMPT,
      "builder must reference the topologicalLayers utility so the dispatch model is reproducible",
    ).toMatch(/topologicalLayers/);
  });

  it("builder prompt clarifies single-slice tasks run inline with zero overhead", () => {
    expect(
      BUILDER_PROMPT,
      "builder must document the single-slice fast path (no parallelism overhead)",
    ).toMatch(/single[- ]slice.*(inline|zero.*overhead|no.*dispatch)/i);
  });

  it("builder prompt documents that AC verification pass runs sequentially after all slices land", () => {
    expect(
      BUILDER_PROMPT,
      "builder must clarify the AC verification pass is sequential, not parallel",
    ).toMatch(/AC verification.*sequential|sequential.*AC verification|parent.*runs.*AC|AC pass.*sequential/i);
  });

  it("builder prompt documents the sub-builder contract: one slice, no AC pass, no recursive dispatch", () => {
    expect(
      BUILDER_PROMPT,
      "builder must explicitly state sub-builders do NOT run the AC verification pass",
    ).toMatch(/sub-builder.*(do.*not|never|don[' ]t).*(run|invoke|dispatch).*AC verification|sub-builders.*never.*AC/i);
    expect(
      BUILDER_PROMPT,
      "builder must forbid recursive sub-builder dispatch",
    ).toMatch(/recursive.*sub-builder|sub-builder.*not.*dispatch.*sub-builder|sub-builder is not allowed to dispatch/i);
  });

  it("builder prompt documents cycle detection (utility throws → builder stops + surfaces)", () => {
    expect(
      BUILDER_PROMPT,
      "builder must say what happens when topologicalLayers throws (cycle / unknown id)",
    ).toMatch(/cycle|topology.*throws|stop and surface.*topology/i);
  });
});

describe("v8.64 — Plan-critic verifies independence claims (parallel-safety gate)", () => {
  it("plan-critic §4b mentions independence-mismatch as a block-ship class", () => {
    expect(
      PLAN_CRITIC_PROMPT,
      "plan-critic must name `independence-mismatch` as a block-ship class for parallel-safety",
    ).toMatch(/independence-mismatch/);
  });

  it("plan-critic flags surface overlap with `independent: true` as block-ship (not just iterate)", () => {
    expect(
      PLAN_CRITIC_PROMPT,
      "plan-critic must escalate to block-ship when independent: true and surface overlap exist",
    ).toMatch(/independent: true.*surface overlap.*block-ship|surface overlap.*block-ship|block-ship.*independence-mismatch/i);
  });

  it("plan-critic explains the parallel-by-default safety implication", () => {
    expect(
      PLAN_CRITIC_PROMPT,
      "plan-critic must explain WHY independence is now safety-critical (parallel sub-builders racing on shared file)",
    ).toMatch(/parallel.*race|race.*parallel|parallel.*shared.*file|parallel-by-default/i);
  });
});

describe("v8.64 — Reviewer edit-discipline validates per-slice surface boundaries", () => {
  it("reviewer prompt's edit-discipline sub-check 1 groups commits by (SL-N) token (not (AC-N))", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer edit-discipline must scan per-slice via the (SL-N) grouping",
    ).toMatch(/SL-\[0-9\]\+|SL-N.*group|group.*SL-N|per-slice surface compliance/i);
  });

  it("reviewer flags cross-slice file touches as required severity (not just iterate)", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer must flag a single (SL-N) commit touching another slice's Surface as severity=required",
    ).toMatch(/cross-slice.*required|another slice's.*required|sub-builder.*contract.*violation/i);
  });

  it("reviewer mentions v8.64 parallel-by-default safety net framing", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer must frame edit-discipline sub-check 1 as the v8.64 ex-post parallel-safety net",
    ).toMatch(/parallel-by-default.*safety|v8\.64.*parallel|sub-builder.*assigned-slice/i);
  });
});

describe("v8.64 — Orchestrator (start-command.ts) carries the topology hint in the build envelope", () => {
  it("start-command names topologicalLayers in the build-stage prose", () => {
    expect(
      START_COMMAND_BODY,
      "start-command must reference the topologicalLayers utility so the dispatch model is discoverable",
    ).toMatch(/topologicalLayers/);
  });

  it("start-command documents parallel-by-default for the strict-mode default path", () => {
    expect(
      START_COMMAND_BODY,
      "start-command must call out v8.64 parallel-by-default in the strict-mode build stage",
    ).toMatch(/parallel-by-default|v8\.64.*parallel|parallel.*default.*multi-slice/i);
  });
});

describe("v8.64 — slice-discipline skill mentions parallel-by-default", () => {
  it("slice-discipline.md skill body has a Parallel-by-default section", async () => {
    const body = await fs.readFile(
      path.join(REPO_ROOT, "src", "content", "skills", "slice-discipline.md"),
      "utf8",
    );
    expect(body, "slice-discipline must explain that slices marked Independent: yes run in parallel").toMatch(
      /Parallel-by-default|in parallel within their layer|topological/i,
    );
  });
});

describe("v8.64 — version bump to 8.64.0", () => {
  it("package.json version is 8.64.0 (or later)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(body) as { version: string };
    expect(parsed.version, "package.json must be bumped to v8.64.0 or later").toMatch(
      /^8\.(6[4-9]|[7-9]\d|\d{3,})\./,
    );
  });

  it("CHANGELOG.md contains a v8.6x entry with parallel-by-default framing (slug v8.64; shipped as v8.66.0 after v8.65 merged first)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(body, "CHANGELOG must record the parallel-by-default entry under v8.66.0 (v8.64 slug, renumbered after v8.65 landed)").toMatch(
      /##\s*8\.(6[4-9]|[7-9]\d|\d{3,})\.0[^\n]*[Pp]arallel-by-default/,
    );
  });
});
