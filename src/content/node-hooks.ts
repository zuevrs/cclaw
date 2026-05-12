export interface NodeHookSpec {
  id: string;
  fileName: string;
  description: string;
  body: string;
}

const SESSION_START_HOOK = `#!/usr/bin/env node
// cclaw session-start: rehydrate flow state and surface active slug.
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

// Sum the byte size of all .md artefacts under flows/<slug>/. Used as a proxy
// for "context pressure" — a long-running flow with many fix iterations and
// reviewer rounds accumulates artefact bytes that every sub-agent dispatch has
// to re-read. The thresholds are deliberately advisory: the goal is to
// surface the cost honestly, not to gate or block.
async function flowArtifactBytes(slug) {
  const dir = path.join(root, "flows", slug);
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry.name));
      total += stat.size;
    } catch {
      // ignore — single-file failures should not break the hook
    }
  }
  return total;
}

const FLOW_PRESSURE_LIGHT_KB = 30;
const FLOW_PRESSURE_HIGH_KB = 60;
const FLOW_PRESSURE_CRITICAL_KB = 100;

function pressureAdvice(bytes) {
  const kb = Math.round(bytes / 1024);
  if (kb >= FLOW_PRESSURE_CRITICAL_KB) {
    return \`[cclaw] context: flow artefacts ~\${kb} KB. Critical pressure — every sub-agent dispatch re-reads this. Consider \\\`/cc-cancel\\\` and resplitting into smaller slugs, or finalising the current slug now and continuing in a follow-up flow.\`;
  }
  if (kb >= FLOW_PRESSURE_HIGH_KB) {
    return \`[cclaw] context: flow artefacts ~\${kb} KB. High pressure — finish the active slice in this session and resume from a clean session for the next AC instead of pushing further here.\`;
  }
  if (kb >= FLOW_PRESSURE_LIGHT_KB) {
    return \`[cclaw] context: flow artefacts ~\${kb} KB. Elevated — let the orchestrator dispatch a fresh sub-agent for the next AC rather than continuing inline.\`;
  }
  return null;
}

const state = await readState();
if (!state) {
  console.log("[cclaw] no active flow. Use /cc <task> to start.");
  process.exit(0);
}

if (state.schemaVersion === 1 || state.schemaVersion === undefined) {
  console.error("[cclaw] flow-state predates cclaw v8 and cannot be auto-migrated.");
  console.error("[cclaw] options: 1) finish/abandon the run with the older cclaw; 2) delete .cclaw/state/flow-state.json; 3) start a new flow.");
  process.exit(0);
}

if (state.schemaVersion !== 3 && state.schemaVersion !== 2) {
  console.error(\`[cclaw] unknown flow-state schemaVersion \${state.schemaVersion}.\`);
  process.exit(0);
}

if (!state.currentSlug) {
  console.log("[cclaw] no active slug. Use /cc <task> to start.");
  process.exit(0);
}

const acMode = state.triage?.acMode ?? "strict";
const ac = state.ac ?? [];
if (acMode === "strict" && ac.length > 0) {
  const pending = ac.filter((item) => item.status !== "committed").length;
  console.log(\`[cclaw] active: \${state.currentSlug} (stage=\${state.currentStage ?? "n/a"}, mode=strict); AC committed \${ac.length - pending}/\${ac.length}\`);
} else {
  console.log(\`[cclaw] active: \${state.currentSlug} (stage=\${state.currentStage ?? "n/a"}, mode=\${acMode}).\`);
}

const pressureBytes = await flowArtifactBytes(state.currentSlug);
const advice = pressureAdvice(pressureBytes);
if (advice) console.log(advice);
`;

const COMMIT_HELPER_HOOK = `#!/usr/bin/env node
// cclaw commit-helper: ac_mode-aware atomic commit hook.
//
// strict mode (large-risky / security-flagged):
//   commit-helper.mjs --ac=AC-N --phase=red|green|refactor|test|docs [--skipped] [--message="..."]
//   enforces TDD cycle, AC trace, no production files in RED, full chain RED -> GREEN -> REFACTOR.
//   v8.36 — per-AC posture annotation drives which phases are required:
//     - test-first              standard RED -> GREEN -> REFACTOR (default)
//     - characterization-first  same shape; pin existing behaviour first
//     - tests-as-deliverable    single \`--phase=test\` commit (recorded as GREEN)
//     - refactor-only           skip RED requirement; single \`--phase=refactor\` commit
//     - docs-only               single \`--phase=docs\` commit; touchSurface must be non-behaviour-adding
//     - bootstrap               GREEN-only for AC-1, full cycle for AC-2+ (legacy buildProfile=bootstrap honoured)
//
// soft / inline mode (small-medium / trivial):
//   commit-helper.mjs --message="..."
//   advisory only — proxies to git commit, prints a one-line note. --ac/--phase ignored.
//
// the mode is read from flow-state.json: state.triage.acMode. if no triage is recorded,
// default to strict (preserves v8.0/v8.1 behaviour for migrated projects).
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const statePath = path.join(root, ".cclaw", "state", "flow-state.json");

// v8.36 — is_behavior_adding predicate inlined from src/is-behavior-adding.ts.
// Returns false iff every file in touchSurface matches the exclusion set
// (markdown / config / dotenv / tests / docs / .cclaw / .github).
// Returns true when at least one file is OUTSIDE the exclusion set, i.e.
// the diff is touching production behaviour. Empty list returns false.
// The canonical exclusion set:
//   *.md, *.json, *.yml, *.yaml, *.toml, *.ini, *.cfg, *.conf,
//   .env*, tests/**, **/*.test.*, **/*.spec.*, __tests__/**,
//   docs/**, .cclaw/**, .github/**
function isExcludedFile(p) {
  const lower = p.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\\.(md|json|ya?ml|toml|ini|cfg|conf)$/.test(lower)) return true;
  if (lower.startsWith("tests/")) return true;
  if (lower.includes("/__tests__/") || lower.startsWith("__tests__/")) return true;
  if (/\\.(test|spec)\\.[a-z0-9.]+$/.test(lower)) return true;
  if (lower.startsWith("docs/")) return true;
  if (lower.startsWith(".cclaw/")) return true;
  if (lower.startsWith(".github/")) return true;
  return false;
}

function isBehaviorAdding(touchSurface) {
  if (!Array.isArray(touchSurface) || touchSurface.length === 0) return false;
  return touchSurface.some((entry) => typeof entry === "string" && !isExcludedFile(entry));
}

// v8.36 — six canonical postures (everyinc-compound pattern).
const POSTURES = [
  "test-first",
  "characterization-first",
  "tests-as-deliverable",
  "refactor-only",
  "docs-only",
  "bootstrap"
];
const DEFAULT_POSTURE = "test-first";

function arg(name) {
  const prefix = \`--\${name}=\`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(\`--\${name}\`);
}

let state;
try {
  state = JSON.parse(await fs.readFile(statePath, "utf8"));
} catch {
  console.error("[commit-helper] no flow-state.json. Start a flow with /cc first.");
  process.exit(2);
}

if (state.schemaVersion !== 3 && state.schemaVersion !== 2) {
  console.error(\`[commit-helper] unsupported flow-state schemaVersion \${state.schemaVersion}.\`);
  process.exit(2);
}

const acMode = state.triage?.acMode ?? "strict";

// v8.23 — detect no-git working trees up front. Soft / inline mode treats the
// absence as a one-line warning + exit 0 (graceful no-op); strict mode hard-
// fails below because AC trace requires SHAs that no-git cannot produce.
async function hasGitDir() {
  try {
    const stat = await fs.stat(path.join(root, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

const gitPresent = await hasGitDir();

if (acMode !== "strict") {
  // soft / inline mode: advisory passthrough.
  const message = arg("message");
  if (!message) {
    console.error("[commit-helper] --message=\\"...\\" is required.");
    process.exit(2);
  }
  if (!gitPresent) {
    // v8.23 no-git fallback: graceful no-op. Hop 1 should have already
    // auto-downgraded acMode to soft with downgradeReason: "no-git", so
    // reaching this branch is the expected steady-state for a no-git
    // project. Emit a single-line warning to stderr (machine-readable
    // stdout stays empty) and exit 0 so the calling specialist's wrapper
    // script proceeds.
    console.error(\`[commit-helper] no-git: \${acMode} mode running without VCS, commit skipped (no-op). Run \\\`git init\\\` if you want commit traces.\`);
    process.exit(0);
  }
  let staged;
  try {
    staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    // git binary is present but the command failed for a reason other
    // than the missing .git/ dir (e.g. shallow clone, permission). Still
    // a graceful no-op in soft mode — surface the reason on stderr.
    console.error(\`[commit-helper] no-git: git command failed (\${error.message}); soft mode commit skipped (no-op).\`);
    process.exit(0);
  }
  if (!staged) {
    console.error("[commit-helper] nothing staged. Stage your changes before invoking commit-helper.");
    process.exit(2);
  }
  execFileSync("git", ["commit", "-m", message], { cwd: root, stdio: "inherit" });
  console.log(\`[commit-helper] committed in \${acMode} mode (no AC trace recorded).\`);
  process.exit(0);
}

// strict mode below — git is mandatory; hard-fail if missing.
if (!gitPresent) {
  console.error("[commit-helper] strict mode requires git, but no .git/ found at projectRoot. Hop 1 should have auto-downgraded to soft acMode with downgradeReason: \\"no-git\\" — your flow-state.json is inconsistent. Run /cc-cancel and re-triage.");
  process.exit(2);
}

// strict mode below.
const acId = arg("ac");
const phase = arg("phase");
const message = arg("message") ?? \`cclaw: progress on \${acId ?? "AC"}\`;
const skipped = flag("skipped");

if (!acId || !/^AC-\\d+$/.test(acId)) {
  console.error("[commit-helper] strict mode usage: commit-helper.mjs --ac=AC-N --phase=red|green|refactor|test|docs [--skipped] [--message='...']");
  process.exit(2);
}

// v8.36 — the accepted phase set depends on the AC's posture. The
// classic three (red / green / refactor) still cover the test-first
// and characterization-first majority; \`test\` and \`docs\` are the
// single-commit shortcuts for tests-as-deliverable and docs-only.
const ALLOWED_PHASES = ["red", "green", "refactor", "test", "docs"];
if (!phase || !ALLOWED_PHASES.includes(phase)) {
  console.error("[commit-helper] --phase is required in strict mode. Allowed: red, green, refactor, test, docs.");
  console.error("[commit-helper] strict-mode build is a TDD cycle: test-first AC need RED -> GREEN -> REFACTOR.");
  console.error("[commit-helper] posture-aware shortcuts: --phase=test (tests-as-deliverable) | --phase=docs (docs-only).");
  process.exit(2);
}

if (skipped && phase !== "refactor") {
  console.error("[commit-helper] --skipped is only valid for --phase=refactor.");
  process.exit(2);
}

const matching = (state.ac ?? []).find((item) => item.id === acId);
if (!matching) {
  console.error(\`[commit-helper] AC \${acId} is not declared in plan.md / flow-state.\`);
  process.exit(2);
}

// v8.36 — resolve the AC's posture (default test-first when absent).
// The legacy \`state.buildProfile === "bootstrap"\` override is still
// honoured for in-flight projects whose flow-state predates v8.36 —
// when set, treat the AC as posture=bootstrap regardless of what its
// stanza says.
let posture = typeof matching.posture === "string" ? matching.posture : DEFAULT_POSTURE;
if (!POSTURES.includes(posture)) {
  console.error(\`[commit-helper] AC \${acId} has an unknown posture \${JSON.stringify(posture)}. Allowed: \${POSTURES.join(" | ")}.\`);
  process.exit(2);
}
const legacyProfile = state.buildProfile ?? "default";
if (legacyProfile === "bootstrap") posture = "bootstrap";

// v8.36 — predicate-as-double-check. The ac-author's posture
// annotation is the routing key; the predicate refuses commits whose
// touchSurface contradicts it (the most common failure: an AC tagged
// docs-only that actually edits src/**).
const touchSurface = Array.isArray(matching.touchSurface) ? matching.touchSurface : [];
if (posture === "docs-only" && isBehaviorAdding(touchSurface)) {
  console.error(\`[commit-helper] \${acId} posture=docs-only contradicts touchSurface containing source files: \${touchSurface.join(", ")}\`);
  console.error("[commit-helper] either remove source files from touchSurface (true docs-only) or re-classify the AC's posture to test-first / characterization-first.");
  process.exit(2);
}

// v8.36 — posture-aware phase routing.
//
//   tests-as-deliverable: accept ONLY --phase=test (or --phase=green
//     for back-compat with operators who type "green" out of habit).
//     The recorded SHA goes under \`phases.green\` because the test IS
//     the deliverable; cycle closes on the single commit. RED is not
//     required.
//   refactor-only: accept ONLY --phase=refactor. RED + GREEN are not
//     required. Cycle closes on the single commit.
//   docs-only: accept ONLY --phase=docs. RED + GREEN are not
//     required. Cycle closes on the single commit.
//   bootstrap: GREEN-only is allowed for AC-1 (legacy semantics); AC-2+
//     uses the full RED -> GREEN -> REFACTOR cycle.
//   test-first / characterization-first (default): unchanged; the
//     full RED -> GREEN -> REFACTOR cycle applies.
if (posture === "tests-as-deliverable") {
  if (phase !== "test" && phase !== "green") {
    console.error(\`[commit-helper] AC \${acId} posture=tests-as-deliverable accepts --phase=test (single commit). Got --phase=\${phase}.\`);
    process.exit(2);
  }
} else if (posture === "refactor-only") {
  if (phase !== "refactor") {
    console.error(\`[commit-helper] AC \${acId} posture=refactor-only accepts --phase=refactor only. Got --phase=\${phase}.\`);
    console.error("[commit-helper] refactor-only AC are pure structural changes; no RED or GREEN is required.");
    process.exit(2);
  }
} else if (posture === "docs-only") {
  if (phase !== "docs") {
    console.error(\`[commit-helper] AC \${acId} posture=docs-only accepts --phase=docs only. Got --phase=\${phase}.\`);
    process.exit(2);
  }
} else if (phase === "test" || phase === "docs") {
  console.error(\`[commit-helper] AC \${acId} posture=\${posture} does not accept --phase=\${phase}. Use --phase=red|green|refactor.\`);
  process.exit(2);
}

const phases = matching.phases ?? {};

// Phase-chain enforcement for the test-first / characterization-first
// / bootstrap postures. The simple postures (tests-as-deliverable,
// refactor-only, docs-only) skip these guards entirely because the
// cycle has been collapsed to a single commit.
const isStandardCycle = posture === "test-first" || posture === "characterization-first" || posture === "bootstrap";
const isBootstrap = posture === "bootstrap" || legacyProfile === "bootstrap";

if (isStandardCycle) {
  if (phase === "green" && !phases.red && !isBootstrap) {
    console.error(\`[commit-helper] cannot record GREEN for \${acId}: no RED commit on record.\`);
    console.error("[commit-helper] write a failing test first and commit it with --phase=red.");
    console.error("[commit-helper] (override: set posture: bootstrap on the AC for test-framework bootstrap slugs only.)");
    process.exit(2);
  }
  if (phase === "refactor" && (!phases.red || !phases.green)) {
    console.error(\`[commit-helper] cannot record REFACTOR for \${acId}: missing \${!phases.red ? "RED" : "GREEN"} commit.\`);
    process.exit(2);
  }
}

if (phase === "refactor" && skipped) {
  if (!arg("message") || !arg("message").includes("skipped:")) {
    console.error("[commit-helper] --phase=refactor --skipped requires --message=\\"refactor(AC-N) skipped: <reason>\\".");
    process.exit(2);
  }
  const updated = {
    ...state,
    ac: state.ac.map((item) => {
      if (item.id !== acId) return item;
      const nextPhases = { ...(item.phases ?? {}), refactor: { skipped: true, reason: arg("message") } };
      const allDone = nextPhases.red && nextPhases.green && nextPhases.refactor;
      return {
        ...item,
        phases: nextPhases,
        commit: allDone ? (nextPhases.green.sha ?? item.commit ?? null) : item.commit ?? null,
        status: allDone ? "committed" : "pending"
      };
    })
  };
  await fs.writeFile(statePath, \`\${JSON.stringify(updated, null, 2)}\\n\`, "utf8");
  console.log(\`[commit-helper] \${acId} phase=refactor skipped (recorded).\`);
  if (updated.ac.find((item) => item.id === acId)?.status === "committed") {
    console.log(\`[commit-helper] \${acId} cycle complete (red, green, refactor=skipped).\`);
  }
  process.exit(0);
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

if (phase === "red") {
  const stagedFiles = staged.split("\\n").filter(Boolean);
  const looksLikeProduction = stagedFiles.find((file) => /^src\\//.test(file) || /^lib\\//.test(file) || /^app\\//.test(file));
  if (looksLikeProduction) {
    console.error(\`[commit-helper] RED phase rejects production files: \${looksLikeProduction}\`);
    console.error("[commit-helper] RED commits must contain test files only. Write the failing test first; commit production code under --phase=green.");
    process.exit(2);
  }
}

// v8.36 — docs-only commits refuse staged source files. Defence in
// depth: the touchSurface check above caught the AC declaration; this
// catches the case where the operator hand-staged something outside
// the declared surface.
if (phase === "docs") {
  const stagedFiles = staged.split("\\n").filter(Boolean);
  const looksLikeProduction = stagedFiles.find((file) => /^src\\//.test(file) || /^lib\\//.test(file) || /^app\\//.test(file));
  if (looksLikeProduction) {
    console.error(\`[commit-helper] docs phase rejects production files: \${looksLikeProduction}\`);
    console.error("[commit-helper] docs-only AC stage only markdown / config / docs files. Use --phase=green for source changes.");
    process.exit(2);
  }
}

const commitMessage = \`\${message}\\n\\nrefs: \${acId} (phase=\${phase}, posture=\${posture})\`;
execFileSync("git", ["commit", "-m", commitMessage], { cwd: root, stdio: "inherit" });

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
// v8.36 — \`test\` / \`docs\` shortcuts record under \`phases.green\`
// because that is the slot the orchestrator reads as the canonical
// "AC committed" SHA. The phase label is preserved alongside so the
// audit trail tells the next reader which posture was used.
const recordSlot = phase === "test" || phase === "docs" ? "green" : phase;
const updated = {
  ...state,
  ac: state.ac.map((item) => {
    if (item.id !== acId) return item;
    const nextPhases = { ...(item.phases ?? {}), [recordSlot]: { sha, phase } };
    let cycleDone = false;
    if (posture === "tests-as-deliverable" || posture === "docs-only") {
      cycleDone = Boolean(nextPhases.green);
    } else if (posture === "refactor-only") {
      cycleDone = Boolean(nextPhases.refactor);
    } else {
      cycleDone = Boolean(nextPhases.red && nextPhases.green && nextPhases.refactor);
    }
    return {
      ...item,
      phases: nextPhases,
      commit: cycleDone ? (nextPhases.green?.sha ?? nextPhases.refactor?.sha ?? sha) : item.commit ?? null,
      status: cycleDone ? "committed" : "pending"
    };
  })
};
await fs.writeFile(statePath, \`\${JSON.stringify(updated, null, 2)}\\n\`, "utf8");
console.log(\`[commit-helper] \${acId} phase=\${phase} (posture=\${posture}) committed as \${sha}\`);
const after = updated.ac.find((item) => item.id === acId);
if (after && after.status === "committed") {
  console.log(\`[commit-helper] \${acId} cycle complete (posture=\${posture}).\`);
}
`;

export const SESSION_START_HOOK_SPEC: NodeHookSpec = {
  id: "session-start",
  fileName: "session-start.mjs",
  description: "Rehydrate flow state when a new session begins.",
  body: SESSION_START_HOOK
};

export const COMMIT_HELPER_HOOK_SPEC: NodeHookSpec = {
  id: "commit-helper",
  fileName: "commit-helper.mjs",
  description: "Atomic commit per AC plus traceability check (AC -> commit SHA).",
  body: COMMIT_HELPER_HOOK
};

export const NODE_HOOKS: NodeHookSpec[] = [
  SESSION_START_HOOK_SPEC,
  COMMIT_HELPER_HOOK_SPEC
];

/**
 * Hook filenames that previous cclaw versions wrote into `.cclaw/hooks/`
 * but the current version no longer ships. The installer removes these
 * files (when present) so existing projects upgrade cleanly without
 * leaving dead hook bodies on disk.
 *
 * v8.38 — `stop-handoff.mjs` retired (advisory hook with no consumers).
 */
export const RETIRED_HOOK_FILES: readonly string[] = ["stop-handoff.mjs"];
