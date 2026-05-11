import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendKnowledgeEntry,
  findNearKnowledge,
  knowledgeLogPath,
  tokenizeTaskSummary,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";
import { runCli } from "../../src/cli.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { PLANNER_PROMPT } from "../../src/content/specialist-prompts/planner.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { assertFlowStateV82 } from "../../src/flow-state.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.18 knowledge-surfacing. Since v8.9 the compound gate has written
 * Jaccard-deduped knowledge entries to `.cclaw/state/knowledge.jsonl` but
 * nothing reads them back. v8.18 closes the loop:
 *
 *  1. `findNearKnowledge(taskSummary, projectRoot, opts?)` returns top-K
 *     prior entries whose tag/touchSurface tokens overlap the task summary
 *     tokens, sorted by Jaccard similarity.
 *  2. Orchestrator (start-command spec) reads them between Hop 2 and Hop
 *     2.5 and stamps `triage.priorLearnings` when non-empty.
 *  3. design / planner / reviewer prompts each instruct the specialist to
 *     read `triage.priorLearnings` as context (do NOT copy verbatim).
 *  4. `cclaw knowledge` CLI command lists captured entries grouped by
 *     `tags[0]` with `--all` / `--tag` / `--surface` / `--json` flags.
 *
 * Each tripwire pins one of those invariants so a regression lights up
 * immediately.
 */

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    slug: overrides.slug ?? "20260501-test-slug",
    ship_commit: overrides.ship_commit ?? "deadbeef",
    shipped_at: overrides.shipped_at ?? "2026-05-01T00:00:00Z",
    signals: overrides.signals ?? {
      hasArchitectDecision: false,
      reviewIterations: 0,
      securityFlag: false,
      userRequestedCapture: false
    },
    refines: overrides.refines ?? null,
    notes: overrides.notes,
    tags: overrides.tags,
    touchSurface: overrides.touchSurface,
    dedupeOf: overrides.dedupeOf ?? null
  };
}

async function seedKnowledge(projectRoot: string, entries: KnowledgeEntry[]): Promise<void> {
  for (const entry of entries) {
    await appendKnowledgeEntry(projectRoot, entry);
  }
}

describe("v8.18 findNearKnowledge — knowledge-surfacing helper", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("(a) returns [] when knowledge.jsonl is missing — never throws", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    const out = await findNearKnowledge("anything goes here", project);
    expect(out).toEqual([]);
  });

  it("(a-bis) returns [] when knowledge.jsonl exists but is empty", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    const logPath = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, "", "utf8");
    const out = await findNearKnowledge("anything goes here", project);
    expect(out).toEqual([]);
  });

  it("(b) Jaccard correctness — hits at threshold 0.4 default but not at 0.9", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await seedKnowledge(project, [
      makeEntry({
        slug: "20260502-permissions-tooltip",
        tags: ["permissions", "tooltip", "frontend"],
        touchSurface: ["src/lib/permissions.ts", "src/components/Tooltip.tsx"]
      })
    ]);
    const hitDefault = await findNearKnowledge("permissions tooltip frontend wiring", project);
    expect(hitDefault.map((e) => e.slug)).toEqual(["20260502-permissions-tooltip"]);
    const hitStrict = await findNearKnowledge("permissions tooltip frontend wiring", project, {
      threshold: 0.9
    });
    expect(hitStrict).toEqual([]);
  });

  it("(c) limit + window honoured — default limit=3, capped on window slice", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    const tags = ["permissions"];
    await seedKnowledge(
      project,
      Array.from({ length: 6 }, (_, idx) =>
        makeEntry({
          slug: `20260503-permissions-${idx}`,
          tags,
          touchSurface: [`src/lib/permissions-${idx}.ts`],
          shipped_at: `2026-05-${10 + idx}T00:00:00Z`
        })
      )
    );
    const top3 = await findNearKnowledge("permissions edit", project);
    expect(top3).toHaveLength(3);
    const top1 = await findNearKnowledge("permissions edit", project, { limit: 1 });
    expect(top1).toHaveLength(1);
    const windowed = await findNearKnowledge("permissions edit", project, { window: 2, limit: 5 });
    // window slices the recent 2 entries; even if more match, only 2 are scored
    expect(windowed.length).toBeLessThanOrEqual(2);
  });

  it("(d) own-slug exclusion — excludeSlug never returns itself", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await seedKnowledge(project, [
      makeEntry({
        slug: "20260504-self",
        tags: ["permissions", "tooltip"],
        touchSurface: ["src/lib/permissions.ts"]
      }),
      makeEntry({
        slug: "20260504-sibling",
        tags: ["permissions", "tooltip"],
        touchSurface: ["src/lib/permissions.ts"]
      })
    ]);
    const out = await findNearKnowledge("permissions tooltip", project, {
      excludeSlug: "20260504-self"
    });
    expect(out.map((e) => e.slug)).toEqual(["20260504-sibling"]);
  });

  it("(d-bis) tokenizeTaskSummary lowercases and drops short tokens (<3 chars)", () => {
    const tokens = tokenizeTaskSummary("Add Permissions tooltip & a wiring fix");
    expect(tokens.has("permissions")).toBe(true);
    expect(tokens.has("tooltip")).toBe(true);
    expect(tokens.has("wiring")).toBe(true);
    expect(tokens.has("fix")).toBe(true);
    expect(tokens.has("a")).toBe(false); // single-char dropped
    expect(tokens.has("&")).toBe(false);
  });
});

describe("v8.18 orchestrator wiring — triage.priorLearnings", () => {
  it("(e) start-command spec describes the prior-learnings lookup hop with findNearKnowledge name", () => {
    expect(START_COMMAND_BODY).toMatch(/Hop 2 §3 — prior-learnings lookup/u);
    expect(START_COMMAND_BODY).toContain("findNearKnowledge");
    expect(START_COMMAND_BODY).toContain("triage.priorLearnings");
  });

  it("(f) start-command spec instructs to OMIT triage.priorLearnings when empty", () => {
    expect(START_COMMAND_BODY).toMatch(/omit `priorLearnings` from `flow-state.json`/iu);
  });

  it("flow-state validator accepts triage.priorLearnings as an optional KnowledgeEntry[]", () => {
    const state = {
      schemaVersion: 3,
      currentSlug: "20260505-feature",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-05T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "small-medium" as const,
        acMode: "soft" as const,
        path: ["plan", "build", "review", "ship"] as const,
        rationale: "test",
        decidedAt: "2026-05-05T00:00:00Z",
        userOverrode: false,
        runMode: "step" as const,
        priorLearnings: [
          { slug: "20260501-prior", tags: ["x"], touchSurface: ["src/x.ts"] }
        ]
      }
    };
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });

  it("flow-state validator rejects triage.priorLearnings entries missing slug", () => {
    const state = {
      schemaVersion: 3,
      currentSlug: "20260505-feature",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-05T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: {
        complexity: "small-medium" as const,
        acMode: "soft" as const,
        path: ["plan", "build", "review", "ship"] as const,
        rationale: "test",
        decidedAt: "2026-05-05T00:00:00Z",
        userOverrode: false,
        runMode: "step" as const,
        priorLearnings: [{ notSlug: "oops" }]
      }
    };
    expect(() => assertFlowStateV82(state)).toThrow(/priorLearnings entries must include a string slug/u);
  });

  it("backward compat — flow-state without triage.priorLearnings still validates", () => {
    const state = {
      schemaVersion: 3,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-05T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });
});

describe("v8.18 specialist prompts read priorLearnings", () => {
  it("(g) design prompt instructs to read triage.priorLearnings as context, no verbatim copy", () => {
    expect(DESIGN_PROMPT).toContain("triage.priorLearnings");
    expect(DESIGN_PROMPT).toMatch(/what we already know nearby/iu);
    expect(DESIGN_PROMPT).toMatch(/do not copy them into your output/iu);
  });

  it("(h) planner prompt instructs to read triage.priorLearnings as background context for AC scoping", () => {
    expect(PLANNER_PROMPT).toContain("triage.priorLearnings");
    expect(PLANNER_PROMPT).toMatch(/background context for AC scoping/iu);
    expect(PLANNER_PROMPT).toMatch(/do not copy entries into your output verbatim/iu);
  });

  it("(i) reviewer prompt instructs to use triage.priorLearnings as priors when scoring findings", () => {
    expect(REVIEWER_PROMPT).toContain("triage.priorLearnings");
    expect(REVIEWER_PROMPT).toMatch(/priors when judging severity/iu);
    expect(REVIEWER_PROMPT).toMatch(/do not copy entries into the Concern Ledger verbatim/iu);
  });
});

describe("v8.18 cclaw knowledge CLI command", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  function captureStreams(): { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const stdout = { write: (chunk: string) => out.push(String(chunk)) } as unknown as NodeJS.WriteStream;
    const stderr = { write: (chunk: string) => err.push(String(chunk)) } as unknown as NodeJS.WriteStream;
    return { stdout, stderr, out, err };
  }

  it("(j) CLI smoke — `cclaw knowledge` runs against a seeded log, produces table output, prints group header + slug row", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await seedKnowledge(project, [
      makeEntry({
        slug: "20260506-permissions",
        notes: "Permissions tooltip wiring",
        tags: ["permissions", "ui"],
        touchSurface: ["src/lib/permissions.ts"]
      }),
      makeEntry({
        slug: "20260507-routing",
        notes: "Namespace router T3-1",
        tags: ["routing"],
        touchSurface: ["src/orchestrator-routing.ts"]
      })
    ]);
    const { stdout, stderr, out } = captureStreams();
    const code = await runCli(["knowledge"], { cwd: project, stdout, stderr });
    expect(code).toBe(0);
    const joined = out.join("");
    expect(joined).toContain("20260506-permissions");
    expect(joined).toContain("20260507-routing");
    expect(joined).toMatch(/2 of 2 entries shown/u);
  });

  it("(k) CLI --json — emits one JSON object per line, parseable as jsonl", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await seedKnowledge(project, [
      makeEntry({ slug: "20260508-a", tags: ["a"], touchSurface: ["src/a.ts"] }),
      makeEntry({ slug: "20260508-b", tags: ["b"], touchSurface: ["src/b.ts"] })
    ]);
    const { stdout, stderr, out } = captureStreams();
    const code = await runCli(["knowledge", "--json"], { cwd: project, stdout, stderr });
    expect(code).toBe(0);
    const lines = out.join("").split(/\n/u).filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(typeof parsed.slug).toBe("string");
    }
  });

  it("(l) CLI --tag and --surface filters narrow the result set; default limit 20 caps output, --all lifts it", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    const entries: KnowledgeEntry[] = [];
    for (let idx = 0; idx < 25; idx += 1) {
      entries.push(
        makeEntry({
          slug: `20260509-permissions-${idx}`,
          tags: idx % 2 === 0 ? ["permissions"] : ["other"],
          touchSurface: idx < 5 ? ["src/lib/permissions.ts"] : ["src/lib/elsewhere.ts"]
        })
      );
    }
    await seedKnowledge(project, entries);

    const tagRun = captureStreams();
    const tagCode = await runCli(
      ["knowledge", "--tag=permissions", "--all"],
      { cwd: project, stdout: tagRun.stdout, stderr: tagRun.stderr }
    );
    expect(tagCode).toBe(0);
    const tagSlugs = tagRun.out
      .join("")
      .split(/\n/u)
      .filter((line) => line.includes("20260509-permissions-"));
    // Exactly the even-indexed entries (13 of 25) carry tag=permissions
    expect(tagSlugs).toHaveLength(13);

    const surfaceRun = captureStreams();
    const surfaceCode = await runCli(
      ["knowledge", "--surface=permissions.ts", "--all"],
      { cwd: project, stdout: surfaceRun.stdout, stderr: surfaceRun.stderr }
    );
    expect(surfaceCode).toBe(0);
    const surfaceSlugs = surfaceRun.out
      .join("")
      .split(/\n/u)
      .filter((line) => line.includes("20260509-permissions-"));
    // First 5 entries touched permissions.ts
    expect(surfaceSlugs).toHaveLength(5);

    const defaultRun = captureStreams();
    const defaultCode = await runCli(["knowledge"], {
      cwd: project,
      stdout: defaultRun.stdout,
      stderr: defaultRun.stderr
    });
    expect(defaultCode).toBe(0);
    const defaultJoined = defaultRun.out.join("");
    expect(defaultJoined).toMatch(/20 of 25 entries shown/u);
  });

  it("(l-bis) CLI on empty knowledge.jsonl prints the explicit no-entries message and exits 0", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    const { stdout, stderr, out } = captureStreams();
    const code = await runCli(["knowledge"], { cwd: project, stdout, stderr });
    expect(code).toBe(0);
    expect(out.join("")).toMatch(/no entries yet/u);
  });

  it("CLI command is listed in `cclaw help` output", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    const { stdout, stderr, out } = captureStreams();
    const code = await runCli(["help"], { cwd: project, stdout, stderr });
    expect(code).toBe(0);
    expect(out.join("")).toMatch(/knowledge\s+List captured learnings/u);
  });
});
