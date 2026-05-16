/**
 * v8.59 — Continuation flow (/cc extend <slug>).
 *
 * Tripwire test suite for the v8.59 architectural slug. v8.59 adds an
 * explicit entry point for iterative work that builds on a previously
 * shipped slug, generalising the v8.58 `priorResearch` pattern from
 * research-mode-only to any shipped slug.
 *
 * Surfaces locked here:
 *
 *   1. **State types** — `ParentContext` + `ParentArtifactPaths` on
 *      `FlowStateV82`. Pre-v8.59 state files validate unchanged
 *      (back-compat: the field is absent → `null`, never an error).
 *   2. **loadParentContext** — the validator that resolves a slug to
 *      a `ParentContextResolution` (`ok: true` with structured
 *      context OR `ok: false` with one of four reasons:
 *      `in-flight` / `cancelled` / `missing` / `corrupted`).
 *   3. **listShippedSlugs** — enumeration of shipped slugs for the
 *      "missing" sub-case suggestions.
 *   4. **renderExtendsSection** — the markdown helper that
 *      ac-author Phase 1.7 calls to author the `## Extends` section
 *      in plan.md.
 *   5. **Plan templates** — both `PLAN_TEMPLATE` and
 *      `PLAN_TEMPLATE_SOFT` declare `parent_slug: null` in
 *      frontmatter and the body carries a placeholder `## Extends`
 *      section that ac-author rewrites or drops.
 *   6. **findNearKnowledge with parentSlug** — the v8.59 augmentation
 *      that prepends the parent's entry to the result regardless of
 *      Jaccard similarity, with the limit cap honoured and graceful
 *      degradation when the parent is absent from `knowledge.jsonl`.
 *   7. **Specialist prompt wiring** — design / ac-author / reviewer
 *      / critic prompts mention `flowState.parentContext` and the
 *      per-specialist read pattern (design Phase 0; ac-author Phase
 *      1.7 + `## Extends`; reviewer parent-contradictions cross-
 *      check; critic §3 skeptic question).
 *   8. **Orchestrator body** — start-command body carries the
 *      Detect-hop extend-mode fork pointer + the v8.59 prior-
 *      context consumption pointer (full procedures lift to
 *      runbooks/extend-mode.md + per-specialist contracts).
 *   9. **On-demand runbook** — `extend-mode.md` is present in
 *      `ON_DEMAND_RUNBOOKS` and carries the canonical
 *      `# On-demand runbook —` heading.
 *
 * Each test pins one invariant so an accidental regression lights up
 * immediately. The tests use temp project fixtures for the on-disk
 * branches (loadParentContext / findNearKnowledge), but the prompt-
 * body / template / type-shape branches are pure-string checks (the
 * canonical pattern from v8.58).
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
  type ParentArtifactPaths,
  type ParentContext
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
import {
  ARTIFACT_FILE_NAMES,
  shippedArtifactDir,
  shippedArtifactPath
} from "../../src/artifact-paths.js";
import { FLOWS_ROOT } from "../../src/constants.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

const PARENT_SLUG = "20260514-auth-flow";
const CHILD_SLUG = "20260516-add-saml";

/**
 * v8.59 — seed a shipped parent slug fixture under
 * `.cclaw/flows/shipped/<slug>/`. Returns the absolute path to the
 * shipped directory. Optional artifacts can be selectively created;
 * `plan.md` is always created (the validator gate requires it).
 */
async function seedShippedParent(
  projectRoot: string,
  slug: string,
  options: {
    plan?: string;
    ship?: string;
    build?: string;
    review?: string;
    critic?: string;
    learnings?: string;
    qa?: string;
  } = {}
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
  if (options.review !== undefined) {
    await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.review), options.review, "utf8");
  }
  if (options.critic !== undefined) {
    await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.critic), options.critic, "utf8");
  }
  if (options.learnings !== undefined) {
    await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.learnings), options.learnings, "utf8");
  }
  if (options.qa !== undefined) {
    await fs.writeFile(path.join(shippedDir, ARTIFACT_FILE_NAMES.qa), options.qa, "utf8");
  }
  return shippedDir;
}

async function seedActiveFlow(projectRoot: string, slug: string): Promise<void> {
  const activeDir = path.join(projectRoot, FLOWS_ROOT, slug);
  await fs.mkdir(activeDir, { recursive: true });
  await fs.writeFile(path.join(activeDir, ARTIFACT_FILE_NAMES.plan), `# ${slug}\n\nactive\n`, "utf8");
}

async function seedCancelledFlow(projectRoot: string, slug: string): Promise<void> {
  const cancelledDir = path.join(projectRoot, FLOWS_ROOT, "cancelled", slug);
  await fs.mkdir(cancelledDir, { recursive: true });
  await fs.writeFile(path.join(cancelledDir, ARTIFACT_FILE_NAMES.plan), `# ${slug}\n\ncancelled\n`, "utf8");
}

describe("v8.59 — ParentContext / ParentArtifactPaths type surface", () => {
  it("ParentContext is assignment-compatible with the closed shape (slug + status + artifactPaths required; shippedAt + extra artifact paths optional)", () => {
    const ctx: ParentContext = {
      slug: PARENT_SLUG,
      status: "shipped",
      shippedAt: "2026-05-14T12:00:00Z",
      artifactPaths: { plan: "/p/.cclaw/flows/shipped/parent/plan.md" }
    };
    expect(ctx.slug).toBe(PARENT_SLUG);
    expect(ctx.status).toBe("shipped");
    expect(ctx.artifactPaths.plan).toContain("plan.md");
    expect(ctx.shippedAt).toBe("2026-05-14T12:00:00Z");
  });

  it("ParentArtifactPaths includes all canonical optional stages (build/qa/review/critic/learnings)", () => {
    const paths: ParentArtifactPaths = {
      plan: "/p/plan.md",
      build: "/p/build.md",
      qa: "/p/qa.md",
      review: "/p/review.md",
      critic: "/p/critic.md",
      learnings: "/p/learnings.md"
    };
    expect(paths.plan).toContain("plan.md");
    expect(paths.build).toContain("build.md");
    expect(paths.qa).toContain("qa.md");
    expect(paths.review).toContain("review.md");
    expect(paths.critic).toContain("critic.md");
    expect(paths.learnings).toContain("learnings.md");
  });

  it("FlowStateV82 accepts parentContext absent (back-compat: pre-v8.59 state files have no field)", () => {
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
  });

  it("FlowStateV82 accepts parentContext: null (cold-start flow explicitly marked)", () => {
    const base: FlowStateV82 = {
      schemaVersion: 3,
      currentSlug: CHILD_SLUG,
      currentStage: "plan",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-16T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null,
      parentContext: null
    };
    expect(() => assertFlowStateV82(base)).not.toThrow();
  });

  it("FlowStateV82 accepts well-formed parentContext (extend-mode flow)", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: CHILD_SLUG,
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-16T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null,
        parentContext: {
          slug: PARENT_SLUG,
          status: "shipped",
          shippedAt: "2026-05-14T12:00:00Z",
          artifactPaths: {
            plan: "/p/.cclaw/flows/shipped/20260514-auth-flow/plan.md",
            build: "/p/.cclaw/flows/shipped/20260514-auth-flow/build.md"
          }
        }
      })
    ).not.toThrow();
  });

  it("FlowStateV82 REJECTS parentContext with status != 'shipped' (v8.59 only allows shipped parents)", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: CHILD_SLUG,
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-16T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null,
        parentContext: {
          slug: PARENT_SLUG,
          status: "in-flight" as unknown as "shipped",
          artifactPaths: { plan: "/p/plan.md" }
        }
      })
    ).toThrow(/status/u);
  });

  it("FlowStateV82 REJECTS parentContext missing artifactPaths.plan (mandatory)", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: CHILD_SLUG,
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-16T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null,
        parentContext: {
          slug: PARENT_SLUG,
          status: "shipped",
          artifactPaths: {} as unknown as ParentArtifactPaths
        }
      })
    ).toThrow(/plan/u);
  });

  it("FlowStateV82 REJECTS parentContext with missing or empty slug", () => {
    expect(() =>
      assertFlowStateV82({
        schemaVersion: 3,
        currentSlug: CHILD_SLUG,
        currentStage: "plan",
        ac: [],
        lastSpecialist: null,
        startedAt: "2026-05-16T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null,
        parentContext: {
          slug: "",
          status: "shipped",
          artifactPaths: { plan: "/p/plan.md" }
        } as ParentContext
      })
    ).toThrow();
  });
});

describe("v8.59 — loadParentContext on-disk validator", () => {
  let project: string;
  beforeEach(async () => {
    project = await createTempProject({ prefix: "cclaw-v859-loadctx-" });
  });
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("ok: true when slug is shipped with plan.md (mandatory artifact present)", async () => {
    await seedShippedParent(project, PARENT_SLUG);
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.slug).toBe(PARENT_SLUG);
      expect(result.context.status).toBe("shipped");
      expect(result.context.artifactPaths.plan).toContain("plan.md");
      expect(result.context.artifactPaths.plan).toContain(PARENT_SLUG);
    }
  });

  it("ok: true reads shipped_at from ship.md frontmatter when present (best-effort)", async () => {
    await seedShippedParent(project, PARENT_SLUG, {
      ship: `---\nslug: ${PARENT_SLUG}\nstage: shipped\nstatus: shipped\nshipped_at: 2026-05-14T12:34:56Z\n---\n\n# ship\n`
    });
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.shippedAt).toBe("2026-05-14T12:34:56Z");
    }
  });

  it("ok: true omits shippedAt when ship.md is absent (back-compat with pre-v8.12 shipped slugs)", async () => {
    await seedShippedParent(project, PARENT_SLUG);
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.shippedAt).toBeUndefined();
    }
  });

  it("ok: true omits shippedAt when ship.md is present but frontmatter lacks the field (sparse legacy ship.md)", async () => {
    await seedShippedParent(project, PARENT_SLUG, {
      ship: `---\nslug: ${PARENT_SLUG}\nstage: shipped\nstatus: shipped\n---\n\n# ship\n`
    });
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.shippedAt).toBeUndefined();
    }
  });

  it("ok: true populates optional artifactPaths only for files that exist on disk", async () => {
    await seedShippedParent(project, PARENT_SLUG, {
      build: "# build\n",
      learnings: "# learnings\n"
    });
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.artifactPaths.plan).toContain("plan.md");
      expect(result.context.artifactPaths.build).toContain("build.md");
      expect(result.context.artifactPaths.learnings).toContain("learnings.md");
      expect(result.context.artifactPaths.review).toBeUndefined();
      expect(result.context.artifactPaths.critic).toBeUndefined();
      expect(result.context.artifactPaths.qa).toBeUndefined();
    }
  });

  it("ok: false / reason: corrupted when shipped dir exists but plan.md is missing", async () => {
    const shippedDir = shippedArtifactDir(project, PARENT_SLUG);
    await fs.mkdir(shippedDir, { recursive: true });
    await fs.writeFile(path.join(shippedDir, "ship.md"), "# ship\n", "utf8");
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("corrupted");
      expect(result.slug).toBe(PARENT_SLUG);
      expect(result.message).toMatch(/corrupted/u);
      expect(result.message).toMatch(/plan\.md missing/u);
    }
  });

  it("ok: false / reason: in-flight when slug is under flows/<slug>/ (not yet shipped)", async () => {
    await seedActiveFlow(project, PARENT_SLUG);
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("in-flight");
      expect(result.message).toMatch(/still in-flight/u);
      expect(result.message).toMatch(/Ship it first/u);
    }
  });

  it("ok: false / reason: cancelled when slug is under flows/cancelled/<slug>/", async () => {
    await seedCancelledFlow(project, PARENT_SLUG);
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cancelled");
      expect(result.message).toMatch(/cancelled/u);
      expect(result.message).toMatch(/Pass a shipped slug/u);
    }
  });

  it("ok: false / reason: missing when slug is not present anywhere", async () => {
    const result = await loadParentContext(project, "20260101-does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
      expect(result.message).toMatch(/Unknown slug/u);
    }
  });

  it("ok: false / reason: missing when slug argument is empty string", async () => {
    const result = await loadParentContext(project, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
      expect(result.message).toMatch(/needs a parent slug/u);
    }
  });

  it("shipped takes precedence over cancelled when (impossibly) both exist (validator order: shipped first)", async () => {
    await seedShippedParent(project, PARENT_SLUG);
    await seedCancelledFlow(project, PARENT_SLUG);
    const result = await loadParentContext(project, PARENT_SLUG);
    expect(result.ok).toBe(true);
  });
});

describe("v8.59 — listShippedSlugs", () => {
  let project: string;
  beforeEach(async () => {
    project = await createTempProject({ prefix: "cclaw-v859-list-" });
  });
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("returns [] when shipped dir does not exist (fresh project)", async () => {
    expect(await listShippedSlugs(project)).toEqual([]);
  });

  it("returns [] when shipped dir is empty", async () => {
    await fs.mkdir(path.join(project, ".cclaw", "flows", "shipped"), { recursive: true });
    expect(await listShippedSlugs(project)).toEqual([]);
  });

  it("filters entries lacking the canonical YYYYMMDD- date prefix", async () => {
    await seedShippedParent(project, PARENT_SLUG);
    await seedShippedParent(project, "not-a-canonical-slug");
    const slugs = await listShippedSlugs(project);
    expect(slugs).toContain(PARENT_SLUG);
    expect(slugs).not.toContain("not-a-canonical-slug");
  });

  it("filters entries that lack plan.md (corrupted shipped dirs are not suggestable)", async () => {
    await seedShippedParent(project, PARENT_SLUG);
    const corruptedDir = shippedArtifactDir(project, "20260101-no-plan");
    await fs.mkdir(corruptedDir, { recursive: true });
    await fs.writeFile(path.join(corruptedDir, "ship.md"), "# ship\n", "utf8");
    const slugs = await listShippedSlugs(project);
    expect(slugs).toContain(PARENT_SLUG);
    expect(slugs).not.toContain("20260101-no-plan");
  });

  it("returns slugs sorted (deterministic for nearest-neighbour suggestions)", async () => {
    await seedShippedParent(project, "20260514-auth-flow");
    await seedShippedParent(project, "20260101-bootstrap");
    await seedShippedParent(project, "20260301-cli-help");
    const slugs = await listShippedSlugs(project);
    expect(slugs).toEqual(["20260101-bootstrap", "20260301-cli-help", "20260514-auth-flow"]);
  });
});

describe("v8.59 — PARENT_ARTIFACT_FILE_NAMES mapping", () => {
  it("re-exports the canonical file names for every ParentArtifactPaths field", () => {
    expect(PARENT_ARTIFACT_FILE_NAMES.plan).toBe("plan.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.build).toBe("build.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.review).toBe("review.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.critic).toBe("critic.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.learnings).toBe("learnings.md");
    expect(PARENT_ARTIFACT_FILE_NAMES.qa).toBe("qa.md");
  });
});

describe("v8.59 — renderExtendsSection helper", () => {
  it("renders the canonical `## Extends` block with all fields populated", () => {
    const out = renderExtendsSection({
      parentSlug: PARENT_SLUG,
      shippedAt: "2026-05-14T12:00:00Z",
      decisionSummary: "switched session storage from Redis to Postgres for durability (D-2 in parent's plan)",
      planRelativePath: "../shipped/20260514-auth-flow/plan.md",
      optionalArtifactRelativePaths: {
        build: "../shipped/20260514-auth-flow/build.md",
        review: "../shipped/20260514-auth-flow/review.md",
        learnings: "../shipped/20260514-auth-flow/learnings.md"
      }
    });
    expect(out).toMatch(/^## Extends$/mu);
    expect(out).toContain(`refines: ${PARENT_SLUG}`);
    expect(out).toContain("shipped 2026-05-14T12:00:00Z");
    expect(out).toContain("Parent decision summary:");
    expect(out).toContain("switched session storage");
    expect(out).toContain("[plan](../shipped/20260514-auth-flow/plan.md)");
    expect(out).toContain("[build](../shipped/20260514-auth-flow/build.md)");
    expect(out).toContain("[review](../shipped/20260514-auth-flow/review.md)");
    expect(out).toContain("[learnings](../shipped/20260514-auth-flow/learnings.md)");
  });

  it("omits absent optional artifacts (only bullets for paths that resolved)", () => {
    const out = renderExtendsSection({
      parentSlug: PARENT_SLUG,
      decisionSummary: "see parent's plan for context",
      planRelativePath: "../shipped/parent/plan.md",
      optionalArtifactRelativePaths: { build: "../shipped/parent/build.md" }
    });
    expect(out).toContain("[plan](../shipped/parent/plan.md)");
    expect(out).toContain("[build](../shipped/parent/build.md)");
    expect(out).not.toContain("[review]");
    expect(out).not.toContain("[critic]");
    expect(out).not.toContain("[qa]");
    expect(out).not.toContain("[learnings]");
  });

  it("substitutes 'shipped date unknown' when shippedAt is absent", () => {
    const out = renderExtendsSection({
      parentSlug: PARENT_SLUG,
      decisionSummary: "summary",
      planRelativePath: "p.md",
      optionalArtifactRelativePaths: {}
    });
    expect(out).toContain("shipped date unknown");
  });

  it("preserves a deterministic bullet order: plan, build, qa, review, critic, learnings", () => {
    const out = renderExtendsSection({
      parentSlug: PARENT_SLUG,
      decisionSummary: "s",
      planRelativePath: "p/plan.md",
      optionalArtifactRelativePaths: {
        learnings: "p/learnings.md",
        qa: "p/qa.md",
        critic: "p/critic.md",
        review: "p/review.md",
        build: "p/build.md"
      }
    });
    const lines = out.split("\n");
    const planIdx = lines.findIndex((l) => l.includes("[plan]"));
    const buildIdx = lines.findIndex((l) => l.includes("[build]"));
    const qaIdx = lines.findIndex((l) => l.includes("[qa]"));
    const reviewIdx = lines.findIndex((l) => l.includes("[review]"));
    const criticIdx = lines.findIndex((l) => l.includes("[critic]"));
    const learningsIdx = lines.findIndex((l) => l.includes("[learnings]"));
    expect(planIdx).toBeLessThan(buildIdx);
    expect(buildIdx).toBeLessThan(qaIdx);
    expect(qaIdx).toBeLessThan(reviewIdx);
    expect(reviewIdx).toBeLessThan(criticIdx);
    expect(criticIdx).toBeLessThan(learningsIdx);
  });

  it("throws on missing required fields (parentSlug, decisionSummary, planRelativePath)", () => {
    expect(() =>
      renderExtendsSection({
        parentSlug: "",
        decisionSummary: "s",
        planRelativePath: "p",
        optionalArtifactRelativePaths: {}
      })
    ).toThrow(/parentSlug/u);
    expect(() =>
      renderExtendsSection({
        parentSlug: PARENT_SLUG,
        decisionSummary: "   ",
        planRelativePath: "p",
        optionalArtifactRelativePaths: {}
      })
    ).toThrow(/decisionSummary/u);
    expect(() =>
      renderExtendsSection({
        parentSlug: PARENT_SLUG,
        decisionSummary: "s",
        planRelativePath: "",
        optionalArtifactRelativePaths: {}
      })
    ).toThrow(/planRelativePath/u);
  });
});

describe("v8.59 — plan templates carry parent_slug frontmatter and ## Extends placeholder", () => {
  it("PLAN_TEMPLATE frontmatter includes `parent_slug: null` (orchestrator seeds at extend init; null on cold-start)", () => {
    const plan = templateBody("plan");
    expect(plan).toMatch(/^parent_slug: null$/mu);
  });

  it("PLAN_TEMPLATE_SOFT frontmatter includes `parent_slug: null` (same authority rules as strict)", () => {
    const planSoft = templateBody("plan-soft");
    expect(planSoft).toMatch(/^parent_slug: null$/mu);
  });

  it("PLAN_TEMPLATE body has a placeholder `## Extends` section (ac-author Phase 1.7 rewrites it from flowState.parentContext or drops it)", () => {
    const plan = templateBody("plan");
    expect(plan).toMatch(/^## Extends$/mu);
    expect(plan).toMatch(/present only when this flow was initialised via/u);
  });

  it("PLAN_TEMPLATE_SOFT body has the same `## Extends` placeholder section", () => {
    const planSoft = templateBody("plan-soft");
    expect(planSoft).toMatch(/^## Extends$/mu);
    expect(planSoft).toMatch(/present only when this flow was initialised via/u);
  });

  it("PLAN_TEMPLATE retains `refines: null` separately from `parent_slug` (back-compat with knowledge-store chain)", () => {
    const plan = templateBody("plan");
    expect(plan).toMatch(/^refines: null$/mu);
    expect(plan).toMatch(/^parent_slug: null$/mu);
  });
});

describe("v8.59 — architect specialist reads flowState.parentContext (v8.62 unified flow: architect absorbed dead `design`'s Phase 0/2-6 and renamed `ac-author`)", () => {
  it("Inputs section names flowState.parentContext", () => {
    expect(ARCHITECT_PROMPT).toContain("flowState.parentContext");
  });

  it("Bootstrap phase carries the v8.59 parent-context linkage step (reads parent's plan.md Spec/Decisions; v8.62 absorbed dead `design`'s Phase 0; the unified-flow architect reads `parentContext.artifactPaths.plan` and inherits the Decisions / Spec sections)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/parent-context linkage/u);
    expect(ARCHITECT_PROMPT).toMatch(/parentContext\.artifactPaths\.plan/u);
    expect(ARCHITECT_PROMPT).toMatch(/## Spec/);
    expect(ARCHITECT_PROMPT).toMatch(/## Decisions/);
  });

  it("Bootstrap phase describes the immediate-parent-only constraint (v8.60+ multi-level chaining lives in the extend-mode runbook; v8.62 keeps that boundary)", () => {
    // v8.62 — the inline `findRefiningChain` escape-hatch citation was
    // dropped from the architect prompt during the unified-flow
    // collapse; the multi-level traversal contract lives in
    // `runbooks-on-demand.ts > extend-mode.md`. The architect's
    // contract is the immediate-parent read.
    expect(ARCHITECT_PROMPT).toMatch(/parent-context linkage/u);
  });
});

describe("v8.59 — architect writes ## Extends (mandatory when parentContext is set; v8.62 unified flow: architect absorbed dead `ac-author`'s Phase 1.7)", () => {
  it("architect prompt includes a parent-context linkage section (replaces the legacy ac-author Phase 1.7)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Parent-context linkage|## Extends/u);
  });

  it("architect prompt instructs authorship of the ## Extends section at the top of plan.md", () => {
    expect(ARCHITECT_PROMPT).toContain("## Extends");
    expect(ARCHITECT_PROMPT).toMatch(/refines: <parentContext\.slug>/u);
  });

  it("architect prompt references the reviewer's parent-contradictions cross-check (downstream awareness)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/parent-contradictions cross-check/u);
  });
});

describe("v8.59 — reviewer adds a parent-contradictions cross-check", () => {
  it("Reviewer prompt declares the v8.59 cross-check section", () => {
    expect(REVIEWER_PROMPT).toMatch(/lightweight cross-check/u);
  });

  it("Cross-check is gated on flowState.parentContext presence (pre-v8.59 flows skip)", () => {
    expect(REVIEWER_PROMPT).toMatch(/parentContext/);
  });

  it("Cross-check is light, not exhaustive regression (scopes the check)", () => {
    // Reviewer prompt uses "lightweight cross-check" and "light-touch" — both
    // signal the same constraint (don't enumerate every parent D-N).
    expect(REVIEWER_PROMPT).toMatch(/lightweight cross-check|light-touch|not.{0,20}exhaustive/iu);
  });
});

describe("v8.59 — critic §3 lens sweep includes a skeptic question on parent decisions", () => {
  it("Critic prompt updates the Skeptic lens to check parent decision contradictions", () => {
    expect(CRITIC_PROMPT).toContain("parentContext");
  });
});

describe("v8.59 — orchestrator body carries the v8.59 pointers (Detect fork + prior-context consumption)", () => {
  it("body contains the Detect-hop extend-mode fork heading + pointer", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/### Detect — extend-mode fork/u);
    expect(body).toContain("runbooks/extend-mode.md");
  });

  it("body Detect-table row routes /cc extend <slug> <task> to the extend-mode init", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/extend-mode fork/u);
    expect(body).toContain("loadParentContext");
  });

  it("body carries the v8.59 prior-context consumption pointer", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/### prior-context consumption/u);
    expect(body).toMatch(/flowState\.parentContext/u);
  });

  it("body explicitly defers multi-level chaining to v8.60+ (immediate parent only)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/immediate.{0,30}parent/iu);
    expect(body).toContain("findRefiningChain");
  });
});

describe("v8.59 — extend-mode.md on-demand runbook", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "extend-mode.md");

  it("is registered in ON_DEMAND_RUNBOOKS", () => {
    expect(runbook).toBeDefined();
  });

  it("opens with the canonical `# On-demand runbook —` heading", () => {
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
  });

  it("covers the four ParentContextErrorReason failure modes (in-flight / cancelled / missing / corrupted)", () => {
    expect(runbook?.body).toMatch(/in-flight/u);
    expect(runbook?.body).toMatch(/cancelled/u);
    expect(runbook?.body).toMatch(/missing/u);
    expect(runbook?.body).toMatch(/corrupted/u);
  });

  it("documents the triage-inheritance precedence rules (explicit > escalation > parent > router default)", () => {
    expect(runbook?.body).toMatch(/Explicit override flag/u);
    expect(runbook?.body).toMatch(/Escalation heuristic/u);
    expect(runbook?.body).toMatch(/Parent inheritance/u);
    expect(runbook?.body).toMatch(/Router default/u);
  });

  it("documents the multi-level chaining policy (immediate parent only; findRefiningChain for deeper traversal)", () => {
    expect(runbook?.body).toMatch(/immediate.{0,30}parent only/iu);
    expect(runbook?.body).toContain("findRefiningChain");
  });

  it("documents the seven argument sub-cases (no slug / no task / collision / reverted / ceremony-flag / runmode-flag / research-suffix)", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/no slug/iu);
    expect(body).toMatch(/no task/iu);
    expect(body).toMatch(/collision/iu);
    expect(body).toMatch(/reverted/iu);
    expect(body).toMatch(/--strict|--soft|--inline/u);
    expect(body).toMatch(/--mode=auto|--mode=step/u);
    expect(body).toMatch(/research/iu);
  });
});

describe("v8.59 — findNearKnowledge prepends parent's entry when parentSlug is set", () => {
  let project: string;

  function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
    return {
      slug: overrides.slug ?? `20260101-entry-${Math.random().toString(36).slice(2, 8)}`,
      ship_commit: "deadbeef",
      shipped_at: "2026-01-01T00:00:00Z",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      tags: overrides.tags,
      touchSurface: overrides.touchSurface,
      notes: overrides.notes,
      outcome_signal: overrides.outcome_signal,
      ...overrides
    };
  }

  beforeEach(async () => {
    project = await createTempProject({ prefix: "cclaw-v859-knowledge-" });
  });
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("prepends the parent entry at index 0 of the result (cap honoured: parent + top limit-1 Jaccard hits)", async () => {
    const parent = makeEntry({
      slug: PARENT_SLUG,
      tags: ["auth-unrelated-words"],
      touchSurface: ["src/parent.ts"]
    });
    const sibling1 = makeEntry({
      slug: "20260201-saml-overlap",
      tags: ["saml", "auth"],
      touchSurface: ["src/saml.ts", "src/auth.ts"]
    });
    const sibling2 = makeEntry({
      slug: "20260301-other-saml-thing",
      tags: ["saml", "auth"],
      touchSurface: ["src/saml-other.ts"]
    });
    await appendKnowledgeEntry(project, parent);
    await appendKnowledgeEntry(project, sibling1);
    await appendKnowledgeEntry(project, sibling2);

    const result = await findNearKnowledge("add saml auth flow", project, {
      parentSlug: PARENT_SLUG,
      threshold: 0.1,
      limit: 2
    });

    expect(result.length).toBeLessThanOrEqual(2);
    expect(result[0]?.slug).toBe(PARENT_SLUG);
  });

  it("degrades gracefully to Jaccard-only when parent is not in knowledge.jsonl", async () => {
    const sibling = makeEntry({
      slug: "20260201-saml",
      tags: ["saml"],
      touchSurface: ["src/saml.ts"]
    });
    await appendKnowledgeEntry(project, sibling);

    const result = await findNearKnowledge("add saml authentication", project, {
      parentSlug: PARENT_SLUG,
      threshold: 0.1
    });

    expect(result.find((entry) => entry.slug === PARENT_SLUG)).toBeUndefined();
    expect(result.some((entry) => entry.slug === "20260201-saml")).toBe(true);
  });

  it("returns parent-only when taskSummary is empty/blank (parent is load-bearing even without a summary)", async () => {
    const parent = makeEntry({ slug: PARENT_SLUG, tags: ["auth"], touchSurface: ["src/auth.ts"] });
    await appendKnowledgeEntry(project, parent);
    const result = await findNearKnowledge("   ", project, { parentSlug: PARENT_SLUG });
    expect(result.length).toBe(1);
    expect(result[0]?.slug).toBe(PARENT_SLUG);
  });

  it("does not duplicate the parent entry when it would also have scored as a top Jaccard hit", async () => {
    const parent = makeEntry({
      slug: PARENT_SLUG,
      tags: ["saml", "auth"],
      touchSurface: ["src/saml.ts"]
    });
    await appendKnowledgeEntry(project, parent);
    const result = await findNearKnowledge("add saml auth", project, {
      parentSlug: PARENT_SLUG,
      threshold: 0.1
    });
    const occurrences = result.filter((entry) => entry.slug === PARENT_SLUG);
    expect(occurrences.length).toBe(1);
  });

  it("ignores parent's outcome_signal: 'reverted' for the prepend (orchestrator already warned at extend init)", async () => {
    const parent = makeEntry({
      slug: PARENT_SLUG,
      tags: ["auth"],
      touchSurface: ["src/auth.ts"],
      outcome_signal: "reverted"
    });
    await appendKnowledgeEntry(project, parent);
    const result = await findNearKnowledge("anything", project, { parentSlug: PARENT_SLUG });
    expect(result[0]?.slug).toBe(PARENT_SLUG);
  });

  it("PRE-v8.59 callers (no parentSlug option) get identical Jaccard-only behaviour", async () => {
    const sibling = makeEntry({
      slug: "20260201-saml",
      tags: ["saml"],
      touchSurface: ["src/saml.ts"]
    });
    await appendKnowledgeEntry(project, sibling);
    const result = await findNearKnowledge("add saml", project);
    expect(result.some((entry) => entry.slug === "20260201-saml")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("rejects empty-string parentSlug (callers passing empty get a thrown error, not a silent no-op)", async () => {
    await expect(
      findNearKnowledge("x", project, { parentSlug: "" })
    ).rejects.toThrow(/parentSlug/u);
  });

  it("looks up parent outside the recency window (an older slug stays surfaceable when explicitly named)", async () => {
    const parent = makeEntry({
      slug: PARENT_SLUG,
      tags: ["auth"],
      touchSurface: ["src/auth.ts"]
    });
    await appendKnowledgeEntry(project, parent);
    for (let i = 0; i < 110; i += 1) {
      await appendKnowledgeEntry(
        project,
        makeEntry({
          slug: `20260301-filler-${i.toString().padStart(4, "0")}`,
          tags: ["filler"],
          touchSurface: ["src/filler.ts"]
        })
      );
    }
    const result = await findNearKnowledge("auth filler", project, {
      parentSlug: PARENT_SLUG,
      threshold: 0.1
    });
    expect(result[0]?.slug).toBe(PARENT_SLUG);
  });
});
