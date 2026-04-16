/**
 * Per-harness tool-mapping reference files.
 *
 * Addresses A.1#4: the four supported harnesses (claude, cursor, opencode, codex)
 * expose different primitive names for the same capabilities (ask-user,
 * delegate/Task, web fetch, file edit, code execution, ...). cclaw's stage skills
 * need to pick the right name at runtime without bloating every stage with per-harness
 * if/else ladders.
 *
 * Each file below is short (one table per capability), authoritative, and materialised
 * at `.cclaw/references/harness-tools/<harness>.md`. Stage skills and the meta-skill
 * cite the folder instead of duplicating the mappings inline.
 *
 * When a new harness is added (or an existing one renames a tool), update the
 * corresponding entry here — do NOT scatter tool names across skill text.
 */

import type { HarnessId } from "../types.js";

export const HARNESS_TOOL_REFS_DIR = "references/harness-tools";

const CLAUDE_TOOLS_MD = `---
harness: claude
name: Claude Code tool map
description: "Canonical mapping of cclaw capability names → Claude Code tool names. Cited by stage skills; do not duplicate in per-stage text."
---

# Claude Code — Tool Map

Use this file as the single source of truth for which Claude Code tool to call when a cclaw skill references a generic capability.

## Core capabilities

| cclaw capability | Claude Code tool | Notes |
|---|---|---|
| Ask user a structured question | \`AskUserQuestion\` | Max 4 options; lettered labels ≤12 chars. Fall back to plain-text lettered list on schema error. |
| Dispatch a subagent (read-only or write) | \`Task\` with \`subagent_type\` | \`explore\` = read-only; \`generalPurpose\` = read-write. Background via \`run_in_background: true\`. |
| Read file | \`Read\` | Prefer this over \`cat\` / \`head\` / \`tail\`. |
| Edit file | \`StrReplace\` (exact match) or \`Write\` (overwrite) | Always \`Read\` before editing; avoid \`sed\`/\`awk\` unless asked. |
| Create file | \`Write\` | Reject if the task can be solved by editing an existing file. |
| Search file contents | \`Grep\` (ripgrep-backed) | Use \`output_mode: files_with_matches\` for file lists. |
| Find files by name / glob | \`Glob\` | Pattern matches mtime-sorted. |
| Shell command | \`Shell\` | Background long-running jobs with \`block_until_ms: 0\`; poll with \`Await\`. |
| Fetch URL | \`WebFetch\` | Returns markdown. No auth, no binaries. |
| Web search | \`WebSearch\` | Use for docs, real-time info, version lookups. |
| Semantic code search | \`SemanticSearch\` | One directory per call; whole-repo via \`[]\`. |
| Todo tracking | \`TodoWrite\` | Use \`merge: true\` to update; keep one task \`in_progress\`. |
| Ask tool (multi-question) | \`AskQuestion\` (Cursor-only, unavailable in Claude) | NOT available in Claude — use \`AskUserQuestion\` instead. |
| MCP tool call | \`CallMcpTool\` | Always read the tool's schema descriptor first. |

## Decision-protocol mapping

When a stage skill says "ask the user a structured question", in Claude Code that means:

\`\`\`
AskUserQuestion({
  questions: [{
    id: "...",
    prompt: "One-sentence decision, plain English",
    options: [
      { id: "a", label: "Short label" },   // ≤12 chars
      { id: "b", label: "Alt label" },
      { id: "c", label: "Recommended" }
    ]
  }]
})
\`\`\`

One question per call. Never batch.

## Escalation / fall-back

If a tool returns a schema error twice in a row (see the meta-skill's Error / Retry Budget), switch to plain-text equivalents:

- \`AskUserQuestion\` → write a numbered list in the response, wait for reply.
- \`Task\` (dispatch) → inline the work in the current turn.
- \`WebFetch\` → ask the user for the URL's content.
`;

const CURSOR_TOOLS_MD = `---
harness: cursor
name: Cursor tool map
description: "Canonical mapping of cclaw capability names → Cursor agent tool names. Cited by stage skills; do not duplicate in per-stage text."
---

# Cursor — Tool Map

Use this file as the single source of truth for which Cursor agent tool to call when a cclaw skill references a generic capability.

## Core capabilities

| cclaw capability | Cursor tool | Notes |
|---|---|---|
| Ask user a structured question | \`AskQuestion\` | \`questions\` is an array; each question has \`id\`, \`prompt\`, \`options\`, optional \`allow_multiple\`. |
| Dispatch a subagent | \`Task\` with \`subagent_type\` | Available types: \`generalPurpose\`, \`explore\` (readonly), \`shell\`, \`browser-use\`, \`best-of-n-runner\`. |
| Read file | \`Read\` | Line-numbered output; avoid \`cat\` / \`head\` / \`tail\`. |
| Edit file | \`StrReplace\` | Unique \`old_string\` required; use \`replace_all: true\` for bulk renames. |
| Create file | \`Write\` | Prefer editing existing files. |
| Search file contents | \`Grep\` (ripgrep-backed) | Output modes: \`content\`, \`files_with_matches\`, \`count\`. |
| Find files by name / glob | \`Glob\` | Auto-prepends \`**/\` when pattern does not start with it. |
| Shell command | \`Shell\` | Long-running jobs go to background via \`block_until_ms: 0\`; poll with \`Await\`. |
| Fetch URL | \`WebFetch\` | Markdown output. |
| Web search | \`WebSearch\` | Use for real-time info, framework docs, news. |
| Semantic code search | \`SemanticSearch\` | Prefer for exploratory "how does X work?" queries. |
| Todo tracking | \`TodoWrite\` | Supports \`merge: true\` for partial updates. |
| Generate image | \`GenerateImage\` | Only on explicit user request. |
| Ask structured questions (Claude-style) | \`AskUserQuestion\` | NOT available in Cursor — use \`AskQuestion\`. |
| MCP tool call | \`CallMcpTool\` | Cursor exposes MCP tools via this wrapper; read the descriptor first. |
| Jupyter notebook edit | \`EditNotebook\` | Use for \`.ipynb\` only; cell-granular edits. |
| Mode switching | \`SwitchMode\` | Propose plan/agent mode changes when task character shifts. |

## Decision-protocol mapping

In Cursor, structured asks look like:

\`\`\`
AskQuestion({
  questions: [{
    id: "...",
    prompt: "One-sentence decision",
    options: [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B" }
    ]
  }]
})
\`\`\`

## Escalation / fall-back

On repeated tool errors, fall back to plain-text equivalents just like Claude — see the meta-skill's Error / Retry Budget.
`;

const OPENCODE_TOOLS_MD = `---
harness: opencode
name: OpenCode tool map
description: "Canonical mapping of cclaw capability names → OpenCode primitives. Cited by stage skills; do not duplicate in per-stage text."
---

# OpenCode — Tool Map

OpenCode exposes a leaner tool surface than Claude Code / Cursor. When a cclaw skill describes a capability that OpenCode lacks, fall back to the plain-text equivalent listed below.

## Core capabilities

| cclaw capability | OpenCode primitive | Notes |
|---|---|---|
| Ask user a structured question | **Not available as a tool.** | Emit a plain-text numbered list: \`A) ... B) ... C) (recommended) ...\`. Wait for the user's letter. |
| Dispatch a subagent | **Not available as a tool.** | Inline the work in the current turn, or split across multiple turns with the user driving. |
| Read file | file-read primitive | Same role as \`Read\`. |
| Edit file | file-edit primitive | Same role as \`StrReplace\`; confirm diff before writing. |
| Create file | file-write primitive | Prefer editing existing files. |
| Search file contents | \`rg\` via shell | Cite \`rg\` output verbatim as evidence when a skill requires a grep result. |
| Find files by name / glob | \`fd\` or \`find\` via shell | Capture the command + output. |
| Shell command | shell primitive | Long-running jobs require explicit background + polling — check the OpenCode docs for \`&\` semantics. |
| Fetch URL | \`curl\` via shell | No markdown conversion; extract manually. |
| Web search | **Not available.** | Ask the user to paste docs or provide a URL, then fetch via shell. |
| Todo tracking | **Not available as a tool.** | Maintain a \`### TODO\` block inline in your response; keep one item in progress. |
| MCP tool call | Depends on runtime config. | If MCP is enabled, use the documented invocation; otherwise treat as unavailable. |

## Decision-protocol mapping

\`\`\`
Decision: <one sentence>.

A) <label> — <trade-off>
B) <label> — <trade-off>
C) <label> — <trade-off>  (recommended, because <one-line reason>)

Please reply with the letter.
\`\`\`

## Escalation / fall-back

Because OpenCode lacks native ask-user and dispatch tools, more of cclaw's protocols degrade to plain text. This is expected — the flow gates and artifacts are identical; only the delivery channel changes.
`;

const CODEX_TOOLS_MD = `---
harness: codex
name: Codex tool map
description: "Canonical mapping of cclaw capability names → Codex CLI primitives. Cited by stage skills; do not duplicate in per-stage text."
---

# Codex — Tool Map

Codex (OpenAI Codex CLI) exposes roughly the same core surface as OpenCode: file I/O, shell, no native ask-user, no dispatch. Fall back to plain text for anything else.

## Core capabilities

| cclaw capability | Codex primitive | Notes |
|---|---|---|
| Ask user a structured question | **Not available as a tool.** | Emit a plain-text lettered list; wait for the user's reply. |
| Dispatch a subagent | **Not available as a tool.** | Inline the work; split turns if needed. |
| Read file | \`read\` / \`open\` primitive | Same role as \`Read\`. |
| Edit file | \`edit\` / \`patch\` primitive | Same role as \`StrReplace\`. |
| Create file | \`write\` primitive | Prefer editing existing files. |
| Search file contents | \`rg\` via shell | Capture command + output verbatim. |
| Find files by name / glob | \`fd\` / \`find\` / \`ls\` via shell | Capture command + output. |
| Shell command | shell primitive | Codex CLI may restrict some binaries by default — check the effective permissions. |
| Fetch URL | \`curl\` via shell | Extract markdown manually. |
| Web search | **Not available.** | Ask user for docs / URL. |
| Todo tracking | **Not available as a tool.** | Keep an inline \`### TODO\` section; update it as you progress. |
| MCP tool call | Depends on runtime config. | If MCP is wired, cite the descriptor; otherwise treat as unavailable. |

## Decision-protocol mapping

\`\`\`
Decision: <one sentence>.

A) <label> — <trade-off>
B) <label> — <trade-off>  (recommended, because <reason>)
C) <label> — <trade-off>

Please reply with the letter.
\`\`\`

## Escalation / fall-back

Treat missing tools as "plain-text required", not "skip the step". The gate still has to pass; only the channel changes.
`;

const HARNESS_TOOL_REFS: Record<HarnessId, string> = {
  claude: CLAUDE_TOOLS_MD,
  cursor: CURSOR_TOOLS_MD,
  opencode: OPENCODE_TOOLS_MD,
  codex: CODEX_TOOLS_MD
};

export function harnessToolRefMarkdown(harness: HarnessId): string {
  return HARNESS_TOOL_REFS[harness];
}

export const HARNESS_TOOL_REFS_INDEX_MD = `---
name: Harness tool maps
description: "Index file. One reference per supported harness — cite the per-harness file instead of hardcoding tool names in stage skills."
---

# Harness Tool Maps

cclaw supports four harnesses; each exposes different primitive names for the same capabilities. Stage skills and utility skills cite the file matching the currently active harness and fall back to plain-text equivalents for capabilities that the harness lacks.

| Harness | File | Notes |
|---|---|---|
| Claude Code | \`.cclaw/${HARNESS_TOOL_REFS_DIR}/claude.md\` | Richest tool surface (AskUserQuestion, Task, WebFetch, WebSearch, MCP, …). |
| Cursor | \`.cclaw/${HARNESS_TOOL_REFS_DIR}/cursor.md\` | Near-parity with Claude; uses \`AskQuestion\` instead of \`AskUserQuestion\`. |
| OpenCode | \`.cclaw/${HARNESS_TOOL_REFS_DIR}/opencode.md\` | No native ask-user / dispatch; more plain-text fallbacks. |
| Codex | \`.cclaw/${HARNESS_TOOL_REFS_DIR}/codex.md\` | No native ask-user / dispatch; shell + file I/O only by default. |

When a new harness is added or an existing one renames a tool, update the corresponding file (and this index) — do NOT scatter tool names across skill text.
`;
