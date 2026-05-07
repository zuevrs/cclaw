export interface NodeHookSpec {
  id: string;
  fileName: string;
  description: string;
  events: string[];
  body: string;
  defaultEnabled: boolean;
}

const SESSION_START_HOOK = `#!/usr/bin/env node
// cclaw v8 session-start: rehydrate flow state and surface active slug.
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const statePath = path.join(root, ".cclaw", "state", "flow-state.json");

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

const state = await readState();
if (!state) {
  console.log("[cclaw] no active flow. Use /cc <task> to start.");
  process.exit(0);
}

if (state.schemaVersion !== 2) {
  console.error("[cclaw] flow-state schema is from cclaw 7.x. cclaw v8 cannot resume it.");
  console.error("[cclaw] options: 1) finish/abandon the run with cclaw 7.x; 2) delete .cclaw/state/flow-state.json; 3) start a new v8 plan.");
  process.exit(0);
}

if (!state.currentSlug) {
  console.log("[cclaw] no active slug. Use /cc <task> to start.");
  process.exit(0);
}

const pending = (state.ac || []).filter((item) => item.status !== "committed").length;
const total = (state.ac || []).length;
console.log(\`[cclaw] active: \${state.currentSlug} (stage=\${state.currentStage ?? "n/a"}); AC committed \${total - pending}/\${total}\`);
`;

const STOP_HANDOFF_HOOK = `#!/usr/bin/env node
// cclaw v8 stop-handoff: short reminder when the agent stops mid-flow.
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const statePath = path.join(root, ".cclaw", "state", "flow-state.json");

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

const state = await readState();
if (!state || !state.currentSlug) process.exit(0);
const pending = (state.ac || []).filter((item) => item.status !== "committed");
if (pending.length === 0) process.exit(0);
console.error(\`[cclaw] stopping with \${pending.length} pending AC for \${state.currentSlug}: \${pending.map((item) => item.id).join(", ")}\`);
`;

const COMMIT_HELPER_HOOK = `#!/usr/bin/env node
// cclaw v8 commit-helper: atomic commit per AC + AC traceability check.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const statePath = path.join(root, ".cclaw", "state", "flow-state.json");

function arg(name) {
  const prefix = \`--\${name}=\`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const acId = arg("ac");
const message = arg("message") ?? \`cclaw: progress on \${acId ?? "AC"}\`;

if (!acId || !/^AC-\\d+$/.test(acId)) {
  console.error("[commit-helper] usage: commit-helper.mjs --ac=AC-1 [--message='...']");
  process.exit(2);
}

let state;
try {
  state = JSON.parse(await fs.readFile(statePath, "utf8"));
} catch {
  console.error("[commit-helper] no flow-state.json. Start a flow with /cc first.");
  process.exit(2);
}

if (state.schemaVersion !== 2) {
  console.error("[commit-helper] flow-state schema is not v8.");
  process.exit(2);
}

const matching = (state.ac ?? []).find((item) => item.id === acId);
if (!matching) {
  console.error(\`[commit-helper] AC \${acId} is not declared in plan.md / flow-state.\`);
  process.exit(2);
}

let staged;
try {
  staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).trim();
} catch (error) {
  console.error(\`[commit-helper] git not available: \${error.message}\`);
  process.exit(2);
}
if (!staged) {
  console.error("[commit-helper] nothing staged. Stage AC-related changes before invoking commit-helper.");
  process.exit(2);
}

const commitMessage = \`\${message}\\n\\nrefs: \${acId}\`;
execFileSync("git", ["commit", "-m", commitMessage], { cwd: root, stdio: "inherit" });

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const updated = {
  ...state,
  ac: state.ac.map((item) => item.id === acId ? { ...item, commit: sha, status: "committed" } : item)
};
await fs.writeFile(statePath, \`\${JSON.stringify(updated, null, 2)}\\n\`, "utf8");
console.log(\`[commit-helper] \${acId} committed as \${sha}\`);
`;

export const SESSION_START_HOOK_SPEC: NodeHookSpec = {
  id: "session-start",
  fileName: "session-start.mjs",
  description: "Rehydrate flow state when a new session begins.",
  events: ["session.start"],
  body: SESSION_START_HOOK,
  defaultEnabled: true
};

export const STOP_HANDOFF_HOOK_SPEC: NodeHookSpec = {
  id: "stop-handoff",
  fileName: "stop-handoff.mjs",
  description: "Surface a short handoff message when the agent stops mid-flow.",
  events: ["session.stop"],
  body: STOP_HANDOFF_HOOK,
  defaultEnabled: true
};

export const COMMIT_HELPER_HOOK_SPEC: NodeHookSpec = {
  id: "commit-helper",
  fileName: "commit-helper.mjs",
  description: "Atomic commit per AC plus traceability check (AC -> commit SHA).",
  events: [],
  body: COMMIT_HELPER_HOOK,
  defaultEnabled: true
};

export const NODE_HOOKS: NodeHookSpec[] = [
  SESSION_START_HOOK_SPEC,
  STOP_HANDOFF_HOOK_SPEC,
  COMMIT_HELPER_HOOK_SPEC
];

export const DEFAULT_HOOK_PROFILE = "minimal" as const;
