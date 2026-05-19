/**
 * v8.59 — Continuation flow (/cc extend <slug>). Slimmed in v8.99
 * test-slim-down A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT
 * test (preserves the on-disk loadParentContext + findNearKnowledge
 * integration coverage that catches the bulk of regressions).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadParentContext,
  listShippedSlugs,
  PARENT_ARTIFACT_FILE_NAMES
} from "../../src/parent-context.js";
import {
  assertFlowStateV82,
  type FlowStateV82,
  type ParentArtifactPaths
} from "../../src/flow-state.js";
import { renderExtendsSection, templateBody } from "../../src/content/artifact-templates.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import {
  appendKnowledgeEntry,
  findNearKnowledge,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";
import { ARTIFACT_FILE_NAMES, shippedArtifactDir } from "../../src/artifact-paths.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

const PARENT_SLUG = "20260514-auth-flow";
const CHILD_SLUG = "20260516-add-saml";

async function seedShippedParent(
  projectRoot: string,
  slug: string,
  options: { plan?: string; ship?: string; build?: string } = {}
): Promise<string> {
  const shippedDir = shippedArtifactDir(projectRoot, slug);
  await fs.mkdir(shippedDir, { recursive: true });
  const planBody =
    options.plan ??
    `---\nslug: ${slug}\nstage: plan\nstatus: shipped\nshipped_at: 2026-05-14T12:00:00Z\nceremony_mode: strict\n---\n\n# ${slug}\n\n## Spec\n\n- Objective: parent auth flow.\n`;
  await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.plan), planBody, "utf8");
  if (options.ship !== undefined) {
    await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.ship), options.ship, "utf8");
  }
  if (options.build !== undefined) {
    await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.build), options.build, "utf8");
  }
  return shippedDir;
}

describe("v8.59 — continuation wiring (types + helpers + runbook + plan templates)", () => {
  it("WIRING — FlowStateV82 accepts/validates parentContext, PARENT_ARTIFACT_FILE_NAMES re-exports the canonical file names, plan templates declare parent_slug:null + ## Extends placeholder, and extend-mode.md is registered in ON_DEMAND_RUNBOOKS", () => {
    const base: FlowStateV82 = {
      schemaVersion: 3,
      currentSlug: CHILD_SLUG,
      currentStage: "plan",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-16T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    };
    expect(() => assertFlowStateV82(base)).not.toThrow();
    expect(() => assertFlowStateV82({ ...base, parentContext: null })).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...base,
        parentContext: {
          slug: PARENT_SLUG,
          status: "shipped",
          shippedAt: "2026-05-14T12:00:00Z",
          artifactPaths: {
            plan: "/p/.cclaw/flows/shipped/20260514-auth-flow/plan.md"
          }
        }
      })
    ).not.toThrow();
    expect(() =>
      assertFlowStateV82({
        ...base,
        parentContext: {
          slug: PARENT_SLUG,
          status: "in-flight" as unknown as "shipped",
          artifactPaths: { plan: "/p/plan.md" } as ParentArtifactPaths
        }
      })
    ).toThrow(/status/u);

    expect(PARENT_ARTIFACT_FILE_NAMES.plan).toBe("plan.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.build).toBe("build.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.review).toBe("review.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.critic).toBe("critic.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.learnings).toBe("learnings.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.qa).toBe("qa.md");

    const plan = templateBody("plan");
    expect(plan).toMatch(/^parent_slug: null$/mu);
    expect(plan).toMatch(/^## Extends$/mu);
    expect(plan).toMatch(/^refines: null$/mu);
    const planSoft = templateBody("plan-soft");
    expect(planSoft).toMatch(/^parent_slug: null$/mu);
    expect(planSoft).toMatch(/^## Extends$/mu);

    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "extend-mode.md");
    expect(runbook).toBeDefined();
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
  });
});

describe("v8.59 — continuation behavior (loadParentContext + findNearKnowledge end-to-end)", () => {
  let project: string;
  beforeEach(async () => {
    project = await createTempProject({ prefix: "cclaw-v859-behavior-" });
  });
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("BEHAVIOR — loadParentContext returns ok for shipped slug, returns the four canonical error reasons (in-flight / cancelled / missing / corrupted), listShippedSlugs filters non-canonical slugs, and findNearKnowledge with parentSlug prepends the parent entry", async () => {
    await seedShippedParent(project, PARENT_SLUG, {
      ship: `---\nslug: ${PARENT_SLUG}\nstage: shipped\nstatus: shipped\nshipped_at: 2026-05-14T12:34:56Z\n---\n\n# ship\n`,
      build: "# build\n"
    });
    const ok = await loadParentContext(project, PARENT_SLUG);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.context.slug).toBe(PARENT_SLUG);
      expect(ok.context.status).toBe("shipped");
      expect(ok.context.shippedAt).toBe("2026-05-14T12:34:56Z");
      expect(ok.context.artifactPaths.plan).toContain("plan.md");
      expect(ok.context.artifactPaths.build).toContain("build.md");
    }

    const missing = await loadParentContext(project, "20260101-does-not-exist");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");

    const activeDir = path.join(project, ".cclaw", "flows", "20260601-in-flight");
    await fs.mkdir(activeDir, { recursive: true });
    await fs.writeFile(path.join(activeDir, ARTIFACT_FILE_NAMES.plan), "# active\n", "utf8");
    const inflight = await loadParentContext(project, "20260601-in-flight");
    expect(inflight.ok).toBe(false);
    if (!inflight.ok) expect(inflight.reason).toBe("in-flight");

    const cancelledDir = path.join(project, ".cclaw", "flows", "cancelled", "20260601-cancelled");
    await fs.mkdir(cancelledDir, { recursive: true });
    await fs.writeFile(path.join(cancelledDir, ARTIFACT_FILE_NAMES.plan), "# cancelled\n", "utf8");
    const cancelled = await loadParentContext(project, "20260601-cancelled");
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.reason).toBe("cancelled");

    const corruptedDir = shippedArtifactDir(project, "20260601-corrupted");
    await fs.mkdir(corruptedDir, { recursive: true });
    await fs.writeFile(path.join(corruptedDir, "ship.md"), "# ship\n", "utf8");
    const corrupted = await loadParentContext(project, "20260601-corrupted");
    expect(corrupted.ok).toBe(false);
    if (!corrupted.ok) expect(corrupted.reason).toBe("corrupted");

    await seedShippedParent(project, "not-a-canonical-slug");
    const slugs = await listShippedSlugs(project);
    expect(slugs).toContain(PARENT_SLUG);
    expect(slugs).not.toContain("not-a-canonical-slug");
    expect(slugs).not.toContain("20260601-corrupted");

    const makeEntry = (overrides: Partial<KnowledgeEntry>): KnowledgeEntry => ({
      slug: overrides.slug ?? "20260101-x",
      ship_commit: "deadbeef",
      shipped_at: "2026-01-01T00:00:00Z",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      ...overrides
    });
    await appendKnowledgeEntry(
      project,
      makeEntry({ slug: PARENT_SLUG, tags: ["auth"], touchSurface: ["src/auth.ts"] })
    );
    await appendKnowledgeEntry(
      project,
      makeEntry({ slug: "20260201-saml-overlap", tags: ["saml", "auth"], touchSurface: ["src/saml.ts"] })
    );
    const result = await findNearKnowledge("add saml auth flow", project, {
      parentSlug: PARENT_SLUG,
      threshold: 0.1,
      limit: 2
    });
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result[0]?.slug).toBe(PARENT_SLUG);
    expect(result.filter((entry) => entry.slug === PARENT_SLUG)).toHaveLength(1);

    await expect(findNearKnowledge("x", project, { parentSlug: "" })).rejects.toThrow(/parentSlug/u);
  });
});

describe("v8.59 — continuation section contract (specialist prompts + ## Extends + start-command Detect fork)", () => {
  it("SECTION CONTRACT — renderExtendsSection emits the canonical ## Extends block, architect/reviewer/critic prompts wire flowState.parentContext, and start-command body carries the Detect-hop extend-mode fork + prior-context consumption pointer", () => {
    const out = renderExtendsSection({
      parentSlug: PARENT_SLUG,
      shippedAt: "2026-05-14T12:00:00Z",
      decisionSummary: "switched session storage from Redis to Postgres for durability (D-2 in parent's plan)",
      planRelativePath: "../shipped/20260514-auth-flow/plan.md",
      optionalArtifactRelativePaths: {
        build: "../shipped/20260514-auth-flow/build.md",
        learnings: "../shipped/20260514-auth-flow/learnings.md"
      }
    });
    expect(out).toMatch(/^## Extends$/mu);
    expect(out).toContain(`refines: ${PARENT_SLUG}`);
    expect(out).toContain("shipped 2026-05-14T12:00:00Z");
    expect(out).toContain("[plan](../shipped/20260514-auth-flow/plan.md)");
    expect(out).toContain("[build](../shipped/20260514-auth-flow/build.md)");
    expect(out).toContain("[learnings](../shipped/20260514-auth-flow/learnings.md)");
    expect(out).not.toContain("[review]");
    expect(out).not.toContain("[critic]");
    expect(() =>
      renderExtendsSection({
        parentSlug: "",
        decisionSummary: "s",
        planRelativePath: "p",
        optionalArtifactRelativePaths: {}
      })
    ).toThrow(/parentSlug/u);

    expect(ARCHITECT_PROMPT).toContain("flowState.parentContext");
    expect(ARCHITECT_PROMPT).toMatch(/parent-context linkage/u);
    expect(ARCHITECT_PROMPT).toMatch(/parentContext\.artifactPaths\.plan/u);
    expect(ARCHITECT_PROMPT).toContain("## Extends");
    expect(ARCHITECT_PROMPT).toMatch(/refines: <parentContext\.slug>/u);
    expect(ARCHITECT_PROMPT).toMatch(/parent-contradictions cross-check/u);
    expect(REVIEWER_PROMPT).toMatch(/lightweight cross-check/u);
    expect(REVIEWER_PROMPT).toMatch(/parentContext/);
    expect(CRITIC_PROMPT).toContain("parentContext");

    const body = renderStartCommand();
    expect(body).toMatch(/### Detect — extend-mode fork/u);
    expect(body).toContain("runbooks/extend-mode.md");
    expect(body).toContain("loadParentContext");
    expect(body).toMatch(/### prior-context consumption/u);
    expect(body).toMatch(/flowState\.parentContext/u);
    expect(body).toMatch(/immediate.{0,30}parent/iu);
    expect(body).toContain("findRefiningChain");
  });
});
