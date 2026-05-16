/**
 * parent-context resolver for the `/cc extend <slug>` entry point.
 *
 * The orchestrator's Detect hop accepts `/cc extend <slug> <task>` as a
 * new fresh-flow entry point that initialises the new slug with a
 * structured pointer at a previously-shipped parent slug. This module
 * owns the **validation** (does the named slug exist + is it shipped +
 * does it have plan.md?) and the **artifact-path resolution** (which
 * of plan / build / review / critic / learnings / qa is actually on
 * disk for the named parent). Specialists read the resolved object via
 * `flowState.parentContext` and `await exists(path)` before consuming
 * any specific artifact — `loadParentContext` does not pre-read content,
 * only paths.
 *
 * The module is deliberately small + dependency-light: only `fs`, the
 * existing `artifact-paths.ts` helpers, and the validator types from
 * `flow-state.ts`. It does NOT import the orchestrator prompt body or
 * specialist prompts — those READ the resolved `parentContext`, they
 * do not participate in its construction.
 *
 * Design lives at `.cclaw/flows/v859-continuation/design.md` (D-2 /
 * D-3 / D-7).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  CANCELLED_DIR_REL_PATH,
  FLOWS_ROOT,
  SHIPPED_DIR_REL_PATH
} from "./constants.js";
import { exists } from "./fs-utils.js";
import {
  ARTIFACT_FILE_NAMES,
  shippedArtifactDir,
  shippedArtifactPath,
  type ArtifactStage
} from "./artifact-paths.js";
import { parseArtifact } from "./artifact-frontmatter.js";
import type { ParentArtifactPaths, ParentContext } from "./flow-state.js";

/**
 * resolution result for `loadParentContext`.
 *
 * `ok`: the slug resolves to a shipped flow with a non-empty
 * `plan.md`. `context` carries the structured `ParentContext`
 * suitable for stamping into `flow-state.json > parentContext`.
 *
 * `error`: the slug failed validation. `reason` is one of:
 * - `"in-flight"` — slug exists under `.cclaw/flows/<slug>/` (still
 *   active, not yet shipped).
 * - `"cancelled"` — slug exists under `.cclaw/flows/cancelled/<slug>/`
 *   (never shipped).
 * - `"missing"` — slug does not exist anywhere.
 * - `"corrupted"` — slug exists under `.cclaw/flows/shipped/<slug>/`
 *   but the mandatory `plan.md` is missing or unreadable.
 *
 * `message` is a one-line human-readable explanation suitable for
 * surfacing in the orchestrator's error message verbatim.
 *
 * The discriminated union keeps callers honest: they MUST handle the
 * error branch before reaching for `result.context`.
 */
export type ParentContextResolution =
  | { ok: true; context: ParentContext }
  | { ok: false; reason: ParentContextErrorReason; slug: string; message: string };

export type ParentContextErrorReason =
  | "in-flight"
  | "cancelled"
  | "missing"
  | "corrupted";

/**
 * does `slug` resolve to a shipped flow with a non-empty
 * `plan.md`? Returns a discriminated union — either `{ ok: true,
 * context }` with the structured pointer, or `{ ok: false, reason,
 * message }` with the validator failure mode.
 *
 * The caller (the orchestrator's Detect hop) is expected to surface
 * the `message` field verbatim to the user when `ok: false` and
 * terminate the flow init. On `ok: true`, the caller stamps
 * `context` into `flow-state.json > parentContext` before dispatching
 * the first specialist.
 *
 * Behaviour notes:
 *
 * - **Order of checks** — shipped first (the happy path; most
 *   common), then active (probably user's typo: they meant to
 *   reference a different slug), then cancelled (rare; explicit "no"
 *   message), then missing (fallthrough; lists nearest shipped slugs
 *   when available).
 * - **plan.md presence is mandatory** — a shipped slug that somehow
 *   lost its plan.md (manual deletion; corrupted finalize) is
 *   `corrupted`, NOT `missing`. The distinction matters because
 *   `missing` suggests typo (helper offers similar names), while
 *   `corrupted` suggests filesystem damage (helper asks user to
 *   verify the shipped directory).
 * - **Best-effort `shippedAt` read** — we open `ship.md` if present
 *   and pull `frontmatter.shipped_at`. Missing / unreadable / no
 *   frontmatter field is a no-op (the result still resolves; the
 *   field is just absent on the returned `context`). Legacy
 *   shipped slugs (pre-v8.12) may lack `ship.md` entirely.
 * - **Artifact-path resolution** — for every optional artifact
 *   (build/review/critic/learnings/qa) we stat the canonical path
 *   and include it on `artifactPaths` only when the file exists.
 *   Specialists never see paths that don't resolve.
 *
 * The function does NOT read parent's plan.md body — that is
 * specialist work (design Phase 0, ac-author Phase 1, reviewer,
 * critic). Path resolution is cheap (one stat per artifact); body
 * reads are expensive (multi-KB) and are kept off the hot path.
 */
export async function loadParentContext(
  projectRoot: string,
  slug: string
): Promise<ParentContextResolution> {
  if (typeof slug !== "string" || slug.length === 0) {
    return {
      ok: false,
      reason: "missing",
      slug,
      message: `extend mode needs a parent slug; try '/cc extend <slug> <task>'`
    };
  }
  const shippedDir = shippedArtifactDir(projectRoot, slug);
  const shippedPlanPath = shippedArtifactPath(projectRoot, slug, "plan");
  const activeDir = path.join(projectRoot, FLOWS_ROOT, slug);
  const cancelledDir = path.join(projectRoot, CANCELLED_DIR_REL_PATH, slug);

  if (await exists(shippedDir)) {
    if (!(await exists(shippedPlanPath))) {
      return {
        ok: false,
        reason: "corrupted",
        slug,
        message:
          `Shipped slug '${slug}' is corrupted (plan.md missing under flows/shipped/${slug}/). Cannot use as parent context.`
      };
    }
    const artifactPaths = await resolveArtifactPaths(projectRoot, slug);
    const shippedAt = await readShippedAt(projectRoot, slug);
    const context: ParentContext = {
      slug,
      status: "shipped",
      ...(shippedAt !== null ? { shippedAt } : {}),
      artifactPaths
    };
    return { ok: true, context };
  }

  if (await exists(activeDir)) {
    return {
      ok: false,
      reason: "in-flight",
      slug,
      message:
        `Slug '${slug}' is still in-flight (active under flows/${slug}/). Ship it first, then run /cc extend.`
    };
  }

  if (await exists(cancelledDir)) {
    return {
      ok: false,
      reason: "cancelled",
      slug,
      message: `Slug '${slug}' was cancelled (under flows/cancelled/${slug}/, never shipped). Pass a shipped slug.`
    };
  }

  return {
    ok: false,
    reason: "missing",
    slug,
    message:
      `Unknown slug '${slug}'. Run 'cclaw --non-interactive knowledge' to list shipped slugs.`
  };
}

/**
 * read the parent's `ship.md > frontmatter.shipped_at` field
 * as a best-effort lookup. Returns `null` on any failure (missing
 * ship.md, unreadable file, missing frontmatter, missing field,
 * non-string value). Never throws — the orchestrator's `/cc extend`
 * validator MUST be resilient to legacy shipped slugs that lack
 * `ship.md` (pre-v8.12) or carry sparse frontmatter.
 */
async function readShippedAt(projectRoot: string, slug: string): Promise<string | null> {
  const shipPath = shippedArtifactPath(projectRoot, slug, "ship");
  if (!(await exists(shipPath))) return null;
  let raw: string;
  try {
    raw = await fs.readFile(shipPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = parseArtifact(raw, shipPath);
    const value = (parsed.frontmatter as { shipped_at?: unknown }).shipped_at;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * stat the parent's shipped directory for every optional
 * artifact (build / review / critic / learnings / qa) and return the
 * paths that actually exist. `plan` is always included (its presence
 * was the validation gate); the other five are included only when
 * the file is present on disk.
 *
 * Order matches the canonical stage order so a downstream renderer
 * (e.g. the `## Extends` section in plan.md) can list them in a
 * predictable sequence without re-sorting.
 */
async function resolveArtifactPaths(
  projectRoot: string,
  slug: string
): Promise<ParentArtifactPaths> {
  const paths: ParentArtifactPaths = {
    plan: shippedArtifactPath(projectRoot, slug, "plan")
  };
  const OPTIONAL_STAGES: ReadonlyArray<keyof Omit<ParentArtifactPaths, "plan"> & ArtifactStage> = [
    "build",
    "qa",
    "review",
    "critic",
    "learnings"
  ];
  for (const stage of OPTIONAL_STAGES) {
    const candidate = shippedArtifactPath(projectRoot, slug, stage);
    if (await exists(candidate)) {
      paths[stage] = candidate;
    }
  }
  return paths;
}

/**
 * list every shipped slug under `.cclaw/flows/shipped/`,
 * filtered to entries whose name begins with the canonical date
 * prefix (`YYYYMMDD-`). Used by the orchestrator's Detect hop to
 * (a) sanity-check that the project has any shipped slugs at all
 * before suggesting `/cc extend`, and (b) optionally surface
 * nearest-neighbour suggestions in the `"missing"` error message.
 *
 * Returns `[]` when:
 * - the shipped directory does not exist (fresh project; no slugs
 *   have shipped yet),
 * - the directory exists but is empty,
 * - the readdir call fails (permission error, transient I/O).
 *
 * Never throws — the Detect hop must not crash on a missing
 * shipped directory.
 */
export async function listShippedSlugs(projectRoot: string): Promise<string[]> {
  const shippedRoot = path.join(projectRoot, SHIPPED_DIR_REL_PATH);
  if (!(await exists(shippedRoot))) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(shippedRoot);
  } catch {
    return [];
  }
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!/^\d{8}-/u.test(entry)) continue;
    const planPath = shippedArtifactPath(projectRoot, entry, "plan");
    if (await exists(planPath)) slugs.push(entry);
  }
  slugs.sort();
  return slugs;
}

/**
 * re-export of `ARTIFACT_FILE_NAMES` keyed by the
 * `ParentArtifactPaths` field names. Exists so callers that need
 * to render a friendly artifact list (e.g. the `## Extends` section
 * helper in `artifact-templates.ts`) don't import from
 * `artifact-paths.ts` and re-derive the mapping.
 *
 * Stable across v8.59; future stages added to `ParentArtifactPaths`
 * MUST also be added here.
 */
export const PARENT_ARTIFACT_FILE_NAMES: Readonly<Record<keyof ParentArtifactPaths, string>> = Object.freeze({
  plan: ARTIFACT_FILE_NAMES.plan,
  build: ARTIFACT_FILE_NAMES.build,
  review: ARTIFACT_FILE_NAMES.review,
  critic: ARTIFACT_FILE_NAMES.critic,
  learnings: ARTIFACT_FILE_NAMES.learnings,
  qa: ARTIFACT_FILE_NAMES.qa
});
