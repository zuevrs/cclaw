/**
 * In-thread research playbooks.
 *
 * These files intentionally have no YAML frontmatter and are not standalone
 * delegated personas. The primary agent loads and executes them directly.
 */

export const RESEARCH_PLAYBOOKS: Record<string, string> = {
  "repo-scan.md": `# Repo Scan Playbook

## Purpose

Build a grounded map of existing modules and reuse candidates before design lock.

## Steps

1. Identify 3-8 task keywords (feature nouns + action verbs).
2. Search for likely modules with \`rg\` and \`Glob\` patterns.
3. List existing implementations or close analogs with file citations.
4. Flag duplication risk and obvious extension points.

## Output Contract

- Relevant modules: \`path - purpose\`
- Reuse candidates: \`file:line - why reusable\`
- Gaps: capabilities not currently present

## Guardrails

- Read-only procedure.
- Never invent paths or ownership.
- If scope is too broad, return bounded partial coverage explicitly.
`,
  "learnings-lookup.md": `# Learnings Lookup Playbook

## Purpose

Reuse prior project knowledge before choosing a direction.

## Steps

1. Read \`.cclaw/knowledge.jsonl\`.
2. Match by stage/domain keywords from the current task.
3. Rank matches by confidence and recency.
4. Return the top entries verbatim.

## Output Contract

- Matched rules
- Matched patterns
- Matched lessons
- Matched compounds
- Explicit no-match note when empty

## Guardrails

- Append-only store: do not rewrite history entries.
- Prefer exact quote over paraphrase.
`,
  "framework-docs-lookup.md": `# Framework Docs Lookup Playbook

## Purpose

Anchor design decisions to version-accurate framework/library docs.

## Steps

1. Resolve the actual dependency version from lockfiles/manifests.
2. Fetch official docs for that version (context7 when available).
3. Extract APIs used by the task and any migration or deprecation notes.

## Output Contract

- Library + version
- APIs/signatures touched
- Relevant breaking changes or gotchas
- Source links/references

## Guardrails

- No speculative APIs.
- If docs conflict or are unclear, mark UNKNOWN and escalate.
`,
  "best-practices-lookup.md": `# Best Practices Lookup Playbook

## Purpose

Summarize citable domain practices for a narrow design decision.

## Steps

1. Narrow the domain to one concrete sub-problem.
2. Gather 3-5 authoritative sources.
3. Produce short practice and anti-pattern lists tied to sources.

## Output Contract

- Recommended practices (\`practice - rationale - source\`)
- Common traps (\`trap - why it fails - source\`)
- Decision hooks (1-3 questions to resolve before proceeding)

## Guardrails

- Cite authoritative sources (official docs/standards).
- State uncertainty explicitly when consensus is weak.
`,
  "git-history.md": `# Git History Playbook

## Purpose

Detect churn, regressions, and ownership signals before locking scope/design.

## Steps

1. For impacted paths, inspect recent history and themes:
   - \`git log --follow -n 20 -- <path>\`
2. Check ownership hotspots:
   - \`git blame <path>\`
   - \`git log --since="<window>" --format="%an" -- <path>\`
3. Search for regression signals:
   - \`git log --since="<window>" --grep="revert|regression" -- <path>\`

## Output Contract

- Recent themes
- Revert/regression signals (with SHAs)
- Ownership hints
- Collision risks with ongoing refactors

## Guardrails

- Read-only git usage.
- If there is no history, say so explicitly.
`
};

export const RESEARCH_PLAYBOOK_FILES = Object.keys(RESEARCH_PLAYBOOKS).sort();

