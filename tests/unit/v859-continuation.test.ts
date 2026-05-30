/**
 * v8.59 — Continuation flow, now the refine-mode FULL path
 * (`/cc <slug> <task>` where triage keeps soft/strict ceremony; the
 * `/cc extend` keyword was folded into the unified refine fork in
 * v8.113). One WIRING + one BEHAVIOR + one SECTION CONTRACT test
 * (preserves the on-disk loadParentContext + listShippedSlugs
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
  it("WIRING — FlowStateV82 accepts/validates parentContext, PARENT_ARTIFACT_FILE_NAMES re-exports the canonical file names, plan templates declare parent_slug:null + ## Extends placeholder, and refine-mode.md is registered in ON_DEMAND_RUNBOOKS", () => {
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

    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "refine-mode.md");
    expect(runbook).toBeDefined();
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
    // The full refine path mints a `refines:` child slug + ## Extends.
    expect(runbook?.body).toMatch(/Refine path/u);
    expect(runbook?.body).toContain("refines: <parent-slug>");
  });
});

describe("v8.59 — continuation behavior (loadParentContext + listShippedSlugs end-to-end)", () => {
  let project: string;
  beforeEach(async () => {
    project = await createTempProject({ prefix: "cclaw-v859-behavior-" });
  });
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("BEHAVIOR — loadParentContext returns ok for shipped slug, returns the four canonical error reasons (in-flight / cancelled / missing / corrupted), and listShippedSlugs filters non-canonical slugs", async () => {
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
    if (!missing.ok) {
      expect(missing.reason).toBe("missing");
      // v8.107 — message now lists available shipped slugs directly
      // instead of pointing at `cclaw --non-interactive knowledge`.
      // The parent we just seeded is the only canonical shipped slug,
      // so the "Available shipped slugs: ..." suffix must include it.
      expect(missing.message).toContain(`Available shipped slugs: ${PARENT_SLUG}`);
      expect(missing.message).not.toContain("cclaw --non-interactive knowledge");
    }

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
  });

  it("BEHAVIOR — v8.107 unknown-slug message: empty / 1-10 / >10 shipped slugs render the right suffix", async () => {
    // Empty: no shipped slugs at all.
    const empty = await loadParentContext(project, "20260101-nope");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe("missing");
      expect(empty.message).toContain(
        "No shipped slugs found in .cclaw/flows/shipped/."
      );
    }

    // 1-10: inline list. v8.109 — listShippedSlugs returns
    // newest-first (reverse-chronological for YYYYMMDD- slugs;
    // reverse-lexicographic on same-day prefix), so the listing
    // surfaces gamma → beta → alpha rather than ascending.
    await seedShippedParent(project, "20260101-alpha");
    await seedShippedParent(project, "20260101-beta");
    await seedShippedParent(project, "20260101-gamma");
    const small = await loadParentContext(project, "20260101-nope");
    expect(small.ok).toBe(false);
    if (!small.ok) {
      expect(small.message).toContain(
        "Available shipped slugs: 20260101-gamma, 20260101-beta, 20260101-alpha."
      );
    }

    // >10: truncate to 10 + pointer at `ls .cclaw/flows/shipped/`.
    for (let i = 0; i < 9; i += 1) {
      // 9 more, total = 3 + 9 = 12.
      const slugIndex = String(i + 1).padStart(2, "0");
      await seedShippedParent(project, `20260201-extra-${slugIndex}`);
    }
    const big = await loadParentContext(project, "20260101-nope");
    expect(big.ok).toBe(false);
    if (!big.ok) {
      expect(big.message).toMatch(
        /Available shipped slugs \(showing 10 of 12\):/u
      );
      expect(big.message).toContain("Full list: 'ls .cclaw/flows/shipped/'.");
    }
  });
});

describe("v8.59 — continuation section contract (specialist prompts + ## Extends + start-command Detect fork)", () => {
  it("SECTION CONTRACT — renderExtendsSection emits the canonical ## Extends block, architect/reviewer/critic prompts wire flowState.parentContext, and start-command body carries the Detect-hop refine-mode fork + prior-context consumption pointer", async () => {
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
    expect(body).toMatch(/### Detect — refine-mode fork/u);
    expect(body).toContain("runbooks/refine-mode.md");
    expect(body).toContain("loadParentContext");
    expect(body).toMatch(/immediate.{0,30}parent/iu);
    // The unified fork dispatches triage WITH the resolved parentContext
    // (the old extend-mode dispatched triage too; only the keyword went).
    expect(body).toMatch(/dispatch the `triage` sub-agent/u);
    // findRefiningChain was deleted; no prompt should reference it.
    expect(body).not.toContain("findRefiningChain");

    // v8.103 — prior-context consumption detail moved to runbooks/triage-gate.md.
    const { ON_DEMAND_RUNBOOKS } = await import("../../src/content/runbooks-on-demand.js");
    const triageGate = ON_DEMAND_RUNBOOKS.find((r) => r.id === "triage-gate")?.body ?? "";
    expect(triageGate).toMatch(/prior-context consumption/iu);
    expect(triageGate).toMatch(/flowState\.parentContext|parentContext/u);
  });
});
