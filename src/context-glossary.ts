import fs from "node:fs/promises";
import path from "node:path";

/**
 * v8.35 — Project domain glossary (`CONTEXT.md`).
 *
 * Adapted from mattpocock's pattern: an OPTIONAL file at the project
 * root that each flow-stage specialist reads at the start of every
 * dispatch. It carries project-specific definitions for domain terms
 * ("AC", "slug", "compound capture", and whatever vocabulary the
 * project itself relies on) so the LLM does not have to
 * reverse-engineer them from source.
 *
 * Contract:
 *   - **Missing CONTEXT.md is a no-op.** `readContextGlossary` returns
 *     null; specialists silently skip the read step. The file's
 *     absence MUST NOT alter dispatch behaviour.
 *   - **Present CONTEXT.md is read once per dispatch.** Each specialist
 *     names the file in its inputs list (or Phase 0 step) so the LLM
 *     pulls it in deterministically. Specialists never write to it.
 *   - **The template is a stub.** When the user opts in (via
 *     `cclaw install --with-context` or by manually creating the
 *     file), the stub seeds H2 sections for the canonical cclaw
 *     vocabulary; the user then fills in project-specific terms.
 *
 * This module is intentionally tiny and side-effect-free: a constant
 * (the template), two getters (file name + projectRoot-relative path),
 * and one async reader that swallows ENOENT and returns null. Everything
 * else (writing the stub, prompting the user, etc.) lives in the
 * install layer.
 */

export const CONTEXT_MD_FILE_NAME = "CONTEXT.md";

export function contextGlossaryPath(projectRoot: string): string {
  return path.join(projectRoot, CONTEXT_MD_FILE_NAME);
}

/**
 * Read the project's CONTEXT.md if present.
 *
 * Returns the raw file body as UTF-8 when the file exists; returns
 * `null` when the file is absent (ENOENT). Any other error (permission,
 * is-a-directory, etc.) bubbles up so the caller can surface it — the
 * "silent skip" semantics apply only to the "file does not exist" case.
 *
 * Specialists call this through their dispatch envelope: they treat the
 * null return as "no glossary, skip the Phase 0 read step" and treat
 * the string return as "pin this body to context for the dispatch".
 */
export async function readContextGlossary(projectRoot: string): Promise<string | null> {
  const target = contextGlossaryPath(projectRoot);
  try {
    return await fs.readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * The cclaw-shipped CONTEXT.md stub.
 *
 * Structure:
 *   - H1 naming the file as the project's domain glossary.
 *   - Marker comment `<!-- cclaw-context: stub -->` so future tooling
 *     can recognise an untouched cclaw-shipped stub (v8.36+ may grow a
 *     "this looks like our stub — refresh?" check).
 *   - H2 sections for the load-bearing cclaw vocabulary (`Slug`,
 *     `Acceptance Criterion`, `Compound capture`, etc.) with 1-2 line
 *     definitions, mirroring the README + start-command lexicon.
 *   - A trailing "Project-specific terms" section the user fills in.
 *
 * The stub is intentionally short: H1 + one explanatory paragraph + ~6
 * canonical H2s + a "add your own" footer. Long enough to be useful
 * out of the box; short enough that the user reads every line before
 * shipping it.
 */
export const CONTEXT_MD_TEMPLATE = `# Project Domain Glossary

<!-- cclaw-context: stub -->

This file is the project's domain glossary. It is **optional**: cclaw works without it. When present, every flow-stage specialist (design, ac-author, slice-builder, reviewer) reads it at the start of its dispatch so the LLM has shared vocabulary for the project's terms.

Keep entries short — one or two lines per term, examples welcome. Replace the seed sections below with the terms your project actually uses, then add new H2 sections for project-specific vocabulary at the bottom.

## Slug

A flow identifier of the form \`YYYYMMDD-<semantic-kebab>\` (e.g. \`20260511-context-md-glossary\`). Each slug owns one branch, one PR, one CHANGELOG entry, and one diary entry; it never carries more than one shippable unit.

## Acceptance Criterion

A short, observable, independently verifiable statement of "what shipped means" for one slug. AC entries name a tripwire test or a concrete behaviour, never an implementation detail. Authored by ac-author, verified at review.

## Compound capture

The end-of-flow knowledge-store entry that stamps a slug's lessons, decisions, and surface coverage into \`.cclaw/state/knowledge.jsonl\`. Tagged with \`problemType\` (v8.34) and load-bearing context so future flows can find it via \`findNearKnowledge\`.

## Runbook

An on-demand markdown file at \`.cclaw/lib/runbooks/\` that the orchestrator reads only when a trigger condition fires. Runbooks keep large, path-specific content out of the always-on orchestrator body (v8.22 + v8.31 trimming).

## Triage

The opening step of every \`/cc\` dispatch. The triage gate sets \`complexity\` (\`small-medium\` vs \`large-risky\`), \`path\` (inline / small-medium / large-risky), \`acMode\` (\`strict\` vs \`soft\`), and \`runMode\` (\`auto\` vs \`step\`). Triage is immutable mid-flight **except** for \`runMode\` (v8.34).

## Project-specific terms

Add your project's domain vocabulary below. Examples — replace with your own:

### \`<YourTermHere>\`

One-line definition. Mention adjacent terms, link to source if useful.
`;
