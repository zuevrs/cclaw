/**
 * v8.50 - detection helpers for the three outcome capture paths.
 *
 * The PURE detection helpers in the top of this file take serialised
 * inputs (git-log strings, task-description strings, shipped-slug
 * lists) and return a list of match candidates. None of them touch
 * the filesystem, run git, or read `knowledge.jsonl` - that is the
 * INTEGRATION layer's responsibility (the `apply*` functions at the
 * bottom of this file, which wrap `readKnowledgeLog` +
 * `setOutcomeSignal` around the pure detectors).
 *
 * Keeping detection pure means every shape can be tested with
 * synthetic strings and no live repo; keeping integration in the
 * same module means the orchestrator and compound.ts have one
 * single-call entry point per capture path.
 */

import {
  readKnowledgeLog,
  setOutcomeSignal,
  type KnowledgeEntry
} from "./knowledge-store.js";

/**
 * A single revert candidate parsed out of `git log --grep="^revert"`.
 *
 * `revertedSubject` carries the original subject the revert undid,
 * extracted from the conventional `Revert "<original>"` shape. Absent
 * when the revert message does not carry the quoted reference.
 */
export interface RevertCandidate {
  sha: string;
  subject: string;
  revertedSubject?: string;
}

/**
 * v8.50 - parse `git log --grep="^revert" --oneline -N` output into
 * a list of {@link RevertCandidate}.
 *
 * Accepted shapes (one commit per line):
 *
 * - `<sha> Revert "feat(v8.42): critic stage"` - conventional shape.
 * - `<sha> revert: fix a bad merge` - lowercase `revert:` prefix.
 * - `<sha> Reverts "fix the auth bug from v8.42"` - `Reverts` is
 *   accepted (gerund used by some git frontends).
 *
 * Anything that does not match either prefix is dropped silently;
 * we never throw because `git log` output is content-unstable and a
 * future weird subject should degrade to "no detection".
 */
export function parseRevertCommits(gitLog: string): RevertCandidate[] {
  if (typeof gitLog !== "string" || gitLog.length === 0) return [];
  const lines = gitLog
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const candidates: RevertCandidate[] = [];
  for (const line of lines) {
    const firstSpace = line.indexOf(" ");
    if (firstSpace <= 0) continue;
    const sha = line.slice(0, firstSpace);
    const subject = line.slice(firstSpace + 1).trim();
    if (subject.length === 0) continue;
    if (!/^revert(s)?\b[:\s"]/iu.test(subject)) continue;
    const quoted = subject.match(/["\u201C]([^"\u201D]+)["\u201D]/u);
    const candidate: RevertCandidate = { sha, subject };
    if (quoted && quoted[1]) candidate.revertedSubject = quoted[1];
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * v8.50 - a revert-to-slug match for {@link findRevertedSlugs}. The
 * `source` field is the pre-formatted `outcome_signal_source` string
 * ready to pass to `setOutcomeSignal`.
 */
export interface RevertedSlugMatch {
  slug: string;
  sha: string;
  subject: string;
  source: string;
}

/**
 * v8.50 - match each {@link RevertCandidate} against the supplied
 * list of shipped slugs. Match heuristic: word-boundary slug token
 * inside `revertedSubject` (or raw `subject` when the quoted form is
 * absent). False-positive rate is low because cclaw slugs follow the
 * `YYYYMMDD-<kebab>` shape and rarely appear in normal commit prose.
 */
export function findRevertedSlugs(
  reverts: readonly RevertCandidate[],
  shippedSlugs: readonly string[]
): RevertedSlugMatch[] {
  if (reverts.length === 0 || shippedSlugs.length === 0) return [];
  const matches: RevertedSlugMatch[] = [];
  for (const revert of reverts) {
    const haystack = revert.revertedSubject ?? revert.subject;
    for (const slug of shippedSlugs) {
      if (!isSlugReference(haystack, slug)) continue;
      matches.push({
        slug,
        sha: revert.sha,
        subject: revert.subject,
        source: `revert detected on ${revert.sha}`
      });
    }
  }
  return matches;
}

/**
 * v8.50 - does `haystack` reference `slug` as a slug-cased token?
 *
 * Word-boundary match on the verbatim slug, case-sensitive. Slug-
 * cased tokens (`20260514-foo`, `auth-bypass`) do not appear in
 * normal prose, so we get a low false-positive rate. Substrings
 * (e.g. `foo` inside `foobar`) are NOT accepted.
 */
export function isSlugReference(haystack: string, slug: string): boolean {
  if (typeof haystack !== "string" || haystack.length === 0) return false;
  if (typeof slug !== "string" || slug.length === 0) return false;
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9-])${escaped}([^a-zA-Z0-9-]|$)`, "u").test(haystack);
}

/**
 * v8.50 - bug-keyword heuristic for {@link findFollowUpBugSlugs}.
 *
 * The capture path stamps `follow-up-bug` ONLY when the task
 * description mentions a shipped slug AND the surrounding prose
 * looks bug-related. Pure name-match without a bug-keyword filter
 * would false-positive on rephrasing / refinement / docs-update
 * tasks that legitimately reference a prior slug. List is short on
 * purpose; adding "issue" or "problem" risks catching normal
 * framing prose.
 */
export const BUG_KEYWORDS: readonly string[] = [
  "bug",
  "fix",
  "broken",
  "regression",
  "crash",
  "hotfix",
  "hot-fix",
  "revert",
  "rollback"
];

function mentionsBugKeyword(text: string): boolean {
  const lowered = text.toLowerCase();
  for (const keyword of BUG_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "u").test(lowered)) return true;
  }
  return false;
}

/**
 * v8.50 - a follow-up-bug match for {@link findFollowUpBugSlugs}.
 *
 * `targetSlug` is the slug whose `outcome_signal` should be set to
 * `"follow-up-bug"` (i.e. the slug being REFERENCED, not the new
 * slug starting up).
 */
export interface FollowUpBugMatch {
  targetSlug: string;
  keyword: string;
  source: string;
}

/**
 * v8.50 - detect follow-up-bug references in a task description.
 *
 * Fires when BOTH conditions hold:
 *
 * 1. The task description mentions a shipped slug by name (slug-
 *    cased token; see {@link isSlugReference}).
 * 2. The task description contains at least one bug keyword from
 *    the conservative {@link BUG_KEYWORDS} list.
 *
 * Returns one match per (slug, keyword) pair. The two-signal
 * threshold keeps the false-positive rate low on rephrasing /
 * refinement / docs tasks that name a prior slug without bug
 * intent.
 */
export function findFollowUpBugSlugs(
  taskDescription: string,
  shippedSlugs: readonly string[]
): FollowUpBugMatch[] {
  if (typeof taskDescription !== "string" || taskDescription.length === 0) return [];
  if (shippedSlugs.length === 0) return [];
  if (!mentionsBugKeyword(taskDescription)) return [];
  const lowered = taskDescription.toLowerCase();
  const matches: FollowUpBugMatch[] = [];
  for (const slug of shippedSlugs) {
    if (!isSlugReference(taskDescription, slug)) continue;
    for (const keyword of BUG_KEYWORDS) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      if (!new RegExp(`\\b${escaped}\\b`, "u").test(lowered)) continue;
      matches.push({
        targetSlug: slug,
        keyword,
        source: `follow-up-bug task references slug ${slug} with keyword "${keyword}"`
      });
    }
  }
  return matches;
}

/**
 * A single commit candidate parsed from a `git log` window. Shape
 * matches `git log --oneline` or `git log --pretty=format:"%H %s"`.
 */
export interface CommitCandidate {
  sha: string;
  subject: string;
}

/**
 * v8.50 - parse a `git log --oneline` (or
 * `--pretty=format:"%H %s"`) output into {@link CommitCandidate} list.
 */
export function parseCommitLog(gitLog: string): CommitCandidate[] {
  if (typeof gitLog !== "string" || gitLog.length === 0) return [];
  const lines = gitLog
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const out: CommitCandidate[] = [];
  for (const line of lines) {
    const firstSpace = line.indexOf(" ");
    if (firstSpace <= 0) continue;
    const sha = line.slice(0, firstSpace);
    const subject = line.slice(firstSpace + 1).trim();
    if (subject.length === 0) continue;
    out.push({ sha, subject });
  }
  return out;
}

/**
 * v8.50 - does a commit subject look like a hot-fix / post-ship fix?
 *
 * Accepted shapes:
 *
 * - `fix(AC-N): ...` - strict-mode posture-driven AC fix.
 * - `fix: ...` - soft-mode plain fix.
 * - `hotfix: ...` / `hot-fix: ...` - explicit hot-fix.
 * - `fixup! ...` - `git commit --fixup` shape.
 *
 * Case-insensitive. Word boundary on `fix` so `prefix:` does not
 * false-positive.
 */
export function looksLikeFixCommit(subject: string): boolean {
  if (typeof subject !== "string" || subject.length === 0) return false;
  // Anchored prefix list; trailing `[:!\s]|$` allows `fix:`, `hotfix:`,
  // `fixup! ...`, `fixup!` (end-of-string), and tolerates the rare
  // bare `fix` subject. The trailing class explicitly avoids `\b`
  // because word-boundary after `!` is false (both `!` and the space
  // that follows are non-word chars) - the test caught that edge.
  return /^(fix(\(AC-\d+\))?|hot-?fix|fixup!)([:!\s]|$)/iu.test(subject);
}

/**
 * v8.50 - a manual-fix match for {@link findManualFixCandidates}.
 */
export interface ManualFixMatch {
  sha: string;
  subject: string;
  /** The first `touchSurface` path that matched (for audit prose). */
  matchedSurface: string;
  source: string;
}

/**
 * v8.50 - detect post-ship manual-fix commits on the slug's
 * `touchSurface`.
 *
 * Fires when a commit in the trailing window:
 *
 * 1. Matches {@link looksLikeFixCommit} (subject prefix shape).
 * 2. Touches at least one file inside the slug's `touchSurface`
 *    declaration (path-prefix match - a `touchSurface` entry like
 *    `src/auth/` catches `src/auth/oauth.ts`).
 *
 * The caller is responsible for narrowing the git-log window to the
 * trailing 24h AND supplying the per-commit touched-files map (built
 * from `git log --name-only --pretty=format:"%H" --since=...`).
 */
export function findManualFixCandidates(
  commits: readonly CommitCandidate[],
  touchSurface: readonly string[],
  filesByCommit: ReadonlyMap<string, readonly string[]>
): ManualFixMatch[] {
  if (commits.length === 0 || touchSurface.length === 0) return [];
  const out: ManualFixMatch[] = [];
  const surfaces = touchSurface
    .map((surface) => surface.replace(/\\/gu, "/").replace(/\/+$/u, ""))
    .filter((surface) => surface.length > 0);
  for (const commit of commits) {
    if (!looksLikeFixCommit(commit.subject)) continue;
    const files = filesByCommit.get(commit.sha) ?? [];
    const matched = findMatchingSurface(files, surfaces);
    if (!matched) continue;
    out.push({
      sha: commit.sha,
      subject: commit.subject,
      matchedSurface: matched,
      source: `manual-fix detected: ${commit.subject.slice(0, 60)} (sha ${commit.sha}, surface ${matched})`
    });
  }
  return out;
}

function findMatchingSurface(
  files: readonly string[],
  surfaces: readonly string[]
): string | null {
  if (files.length === 0 || surfaces.length === 0) return null;
  for (const fileRaw of files) {
    const file = fileRaw.replace(/\\/gu, "/");
    for (const surface of surfaces) {
      if (file === surface) return surface;
      if (file.startsWith(`${surface}/`)) return surface;
    }
  }
  return null;
}

/**
 * v8.50 - apply follow-up-bug outcome signals at a fresh slug start.
 *
 * The orchestrator calls this from Hop 1 (Detect, fresh start) with
 * the user's task description. The helper:
 *
 * 1. Reads `knowledge.jsonl` (missing / empty / unreadable -> no-op).
 * 2. Runs {@link findFollowUpBugSlugs} against the task description
 *    and the shipped-slug list.
 * 3. For each unique matched slug, stamps `outcome_signal:
 *    "follow-up-bug"` via `setOutcomeSignal`. Multiple keyword hits
 *    on the same slug stamp once (the FIRST matched keyword wins,
 *    which is also the earliest keyword in {@link BUG_KEYWORDS}).
 *
 * Returns the list of matches that were ACTUALLY stamped (one row
 * per unique target slug) so the orchestrator can surface them in
 * its slim summary. Empty array on no-op.
 *
 * Failure handling: never throws. Per-entry write failures are
 * swallowed so one bad row does not break the loop. Compound's
 * primary contract is sacrosanct; the outcome loop is additive
 * telemetry.
 */
export async function applyFollowUpBugSignals(
  projectRoot: string,
  taskDescription: string,
  shippedAt: string
): Promise<FollowUpBugMatch[]> {
  if (typeof taskDescription !== "string" || taskDescription.length === 0) return [];
  let entries: KnowledgeEntry[];
  try {
    entries = await readKnowledgeLog(projectRoot);
  } catch {
    return [];
  }
  if (entries.length === 0) return [];
  const shippedSlugs = entries.map((entry) => entry.slug);
  const allMatches = findFollowUpBugSlugs(taskDescription, shippedSlugs);
  if (allMatches.length === 0) return [];
  // Dedupe by `targetSlug` keeping the first matched keyword - we
  // only need one signal per slug, and the BUG_KEYWORDS order has
  // the strongest signals first (`bug`, `fix` before `regression` /
  // `crash`).
  const seen = new Set<string>();
  const stamped: FollowUpBugMatch[] = [];
  for (const match of allMatches) {
    if (seen.has(match.targetSlug)) continue;
    seen.add(match.targetSlug);
    try {
      const ok = await setOutcomeSignal(
        projectRoot,
        match.targetSlug,
        "follow-up-bug",
        match.source,
        shippedAt
      );
      if (ok) stamped.push(match);
    } catch {
      // Swallow; see the function-level failure-handling comment.
    }
  }
  return stamped;
}
