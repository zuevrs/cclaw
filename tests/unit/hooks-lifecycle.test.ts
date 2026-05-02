import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { issueWaiverToken } from "../../src/internal/waiver-grant.js";
import { ensureRunSystem, readFlowState } from "../../src/runs.js";
import { stageSchema } from "../../src/content/stage-schema.js";
import { appendDelegation } from "../../src/delegation.js";
import type { FlowStage } from "../../src/types.js";
import { opencodePluginJs, runHookCmdScript, stageCompleteScript, startFlowScript } from "../../src/content/hooks.js";
import {
  claudeHooksJsonWithObservation,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation
} from "../../src/content/observe.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";
import { createTempProject } from "../helpers/index.js";

interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function requiredGateEvidenceJson(stage: Parameters<typeof stageSchema>[0]): string {
  const requiredGateIds = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  return JSON.stringify(Object.fromEntries(
    requiredGateIds.map((gateId) => [gateId, `evidence for ${gateId}`])
  ));
}

async function proactiveWaiverFlags(
  projectRoot: string,
  stage: FlowStage,
  reason: string = "unit_test_proactive"
): Promise<string[]> {
  const record = await issueWaiverToken(projectRoot, {
    stage,
    reason,
    issuerSubsystem: "hooks-lifecycle-test"
  });
  return [
    `--accept-proactive-waiver=${record.token}`,
    `--accept-proactive-waiver-reason=${reason}`
  ];
}

async function writeBrainstormArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), `# Brainstorm Artifact

## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |

## Context
- Project state: greenfield static landing page.
- Relevant existing code/patterns: none; initial flow stage.

## Problem Decision Record
- Stage depth: lite
- Work type: product
- User / Persona: landing page visitor
- Job To Be Done: understand the offer and choose a clear next action
- Pain / Trigger: current direction is undecided before implementation
- Value Hypothesis: a static frontend direction gives fast launch with traceable trade-offs
- Evidence / Signal: user selected the richer frontend ecosystem direction
- Success Metric: approved direction and traceable trade-offs
- Why now: implementation should not start until the frontend direction is approved
- What happens if we do nothing: frontend work starts with unstable assumptions
- Non-goals: no implementation during brainstorm

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Static or dynamic? | Static | removes backend/CMS from v1 |

## Approach Tier
- Tier: Lightweight
- Why this tier: single static landing page.

## Short-Circuit Decision
- Status: bypassed
- Why: options still needed comparison.
- Scope handoff: continue with selected frontend direction.

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A | baseline | modest | Astro static site | fastest, smaller ecosystem |  |
| B | baseline | high | Next.js static export | richer ecosystem, more overhead | recommended |
| C | challenger | higher | Vite vanilla | maximum control, more manual work |  |

## Approach Reaction
- Closest option: B
- Concerns: wants ecosystem and animation support.
- What changed after reaction: recommendation moved to Next.js static export.

## Selected Direction
- Approach: B - Next.js static export
- Rationale: user reaction favored ecosystem and ready animation tooling.
- Approval: approved
- Next-stage handoff: scope — carry the static-export landing slice forward.

## Design
- Architecture: static exported Next.js app.
- Key components: app router page, Tailwind styles, animation layer.
- Data flow: static content -> build -> exported HTML/CSS/JS.

## Assumptions and Open Questions
- Assumptions: single-page landing v1.
- Open questions (or "None"): None

## Learnings
- {"type":"pattern","trigger":"when stage completion runs without global cclaw","action":"invoke the generated Node stage-complete helper so learnings harvest still writes knowledge","confidence":"high"}
`, "utf8");
}

async function seedMandatoryDelegationWaivers(root: string, stage: "brainstorm" = "brainstorm"): Promise<void> {
  const state = await readFlowState(root);
  const mandatoryAgents = stageSchema(stage, state.track).mandatoryDelegations;
  for (const agent of mandatoryAgents) {
    await appendDelegation(root, {
      stage,
      agent,
      mode: "mandatory",
      status: "waived",
      waiverReason: "unit_test_seeded_waiver",
      fulfillmentMode: "role-switch",
      runId: state.activeRunId,
      ts: new Date().toISOString()
    });
  }
}

async function runNodeScript(
  root: string,
  scriptName: string,
  scriptBody: string,
  args: string[] = [],
  input = "",
  extraEnv: Record<string, string> = {}
): Promise<ScriptResult> {
  const scriptPath = path.join(root, scriptName);
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);

  return await new Promise<ScriptResult>((resolve, reject) => {
    const env = {
      ...process.env,
      CCLAW_PROJECT_ROOT: root,
      ...extraEnv
    } as Record<string, string | undefined>;
    if (process.platform === "win32") {
      const normalizedPath = extraEnv.Path ?? extraEnv.PATH ?? process.env.Path ?? process.env.PATH ?? "";
      delete env.PATH;
      delete env.Path;
      env.Path = normalizedPath;
    }
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    if (input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

describe("hooks lifecycle wiring", () => {
  it("uses node runtime commands for all harness hook configs", () => {
    const claude = claudeHooksJsonWithObservation();
    const cursor = cursorHooksJsonWithObservation();
    const codex = codexHooksJsonWithObservation();

    expect(claude).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd stop-handoff");
    expect(claude).not.toContain("prompt-guard");
    expect(claude).not.toContain("workflow-guard");
    expect(claude).not.toContain("context-monitor");
    expect(claude).not.toContain(".sh");

    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd stop-handoff");
    expect(cursor).not.toContain("pre-tool-pipeline");
    expect(cursor).not.toContain("prompt-guard");
    expect(cursor).not.toContain("workflow-guard");
    expect(cursor).not.toContain("context-monitor");
    expect(cursor).not.toContain(".sh");

    expect(codex).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd stop-handoff");
    expect(codex).not.toContain("prompt-pipeline");
    expect(codex).not.toContain("prompt-guard");
    expect(codex).not.toContain("pre-tool-pipeline");
    expect(codex).not.toContain("workflow-guard");
    expect(codex).not.toContain("context-monitor");
    expect(codex).not.toContain("verify-current-state");
    expect(codex).toContain("statusMessage");
    expect(codex).toContain("Running cclaw session startup checks");
    expect(codex).toContain("Preparing cclaw handoff checklist");
    const codexHooks = JSON.parse(codex) as {
      hooks: {
        SessionStart?: Array<{ hooks?: Array<{ command?: string; statusMessage?: string }> }>;
        Stop?: Array<{ hooks?: Array<{ command?: string; statusMessage?: string }> }>;
      };
    };
    expect(JSON.stringify(codexHooks.hooks.SessionStart)).toContain("session-start");
    expect(JSON.stringify(codexHooks.hooks.Stop)).toContain("stop-handoff");
    expect(JSON.stringify(codexHooks.hooks)).not.toContain("prompt-pipeline");
    expect(JSON.stringify(codexHooks.hooks)).not.toContain("pre-tool-pipeline");
    expect(codex).not.toContain(".sh");
  });

  it("run-hook wrapper reports missing node instead of silently skipping", () => {
    const wrapper = runHookCmdScript();
    expect(wrapper).toContain("node not found; cclaw hook skipped");
    expect(wrapper).toContain("Run npx cclaw-cli sync");
  });

  it("run-hook wrapper dispatches to node runtime on POSIX shells", async () => {
    if (process.platform === "win32") return;

    const root = await createTempProject("run-hook-cmd-posix");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    const callsPath = path.join(root, "run-hook-wrapper-calls.log");
    await fs.writeFile(path.join(root, ".cclaw/hooks/run-hook.cmd"), runHookCmdScript(), "utf8");
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.cmd"), 0o755);
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);

    const result = await new Promise<ScriptResult>((resolve, reject) => {
      const child = spawn("sh", [path.join(root, ".cclaw/hooks/run-hook.cmd"), "session-start"], {
        cwd: root,
        env: { ...process.env, CCLAW_PROJECT_ROOT: root }
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

    expect(result.code, result.stderr).toBe(0);
    await expect(fs.readFile(callsPath, "utf8")).resolves.toBe("session-start\n");
  });

  it("stage-complete helper reports missing CLI entrypoint before spawning", async () => {
    const root = await createTempProject("stage-complete-missing-entrypoint");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });

    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      stageCompleteScript(),
      ["brainstorm"],
      "",
      { CCLAW_CLI_JS: path.join(root, "missing-cli.mjs") }
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("local Node runtime entrypoint not found");
  });

  it("stage-complete helper prints usage when stage is omitted", async () => {
    const root = await createTempProject("stage-complete-usage");
    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      stageCompleteScript()
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage: node .cclaw/hooks/stage-complete.mjs <stage>");
  });

  it("start-flow helper invokes managed start through the local Node runtime without cclaw on PATH", async () => {
    const root = await createTempProject("start-flow-helper-no-path");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });

    const callsPath = path.join(root, "start-flow-calls.log");
    const runtimeShimPath = path.join(root, "local-runtime.mjs");
    await fs.writeFile(runtimeShimPath, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
`, "utf8");
    await fs.chmod(runtimeShimPath, 0o755);

    const result = await runNodeScript(
      root,
      ".cclaw/hooks/start-flow.mjs",
      startFlowScript(),
      ["--track=standard", "--class=software-standard", "--prompt=простое веб приложение"],
      "",
      process.platform === "win32"
        ? { PATH: "", Path: "", CCLAW_CLI_JS: runtimeShimPath }
        : { PATH: "", CCLAW_CLI_JS: runtimeShimPath }
    );

    expect(result.code, result.stderr).toBe(0);
    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal start-flow --track=standard --class=software-standard --prompt=простое веб приложение");
    expect(calls).toContain("--quiet");
  });

  it("start-flow helper allows disabling default quiet mode via env override", async () => {
    const root = await createTempProject("start-flow-helper-quiet-disabled");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });

    const callsPath = path.join(root, "start-flow-calls.log");
    const runtimeShimPath = path.join(root, "local-runtime.mjs");
    await fs.writeFile(runtimeShimPath, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
`, "utf8");
    await fs.chmod(runtimeShimPath, 0o755);

    const result = await runNodeScript(
      root,
      ".cclaw/hooks/start-flow.mjs",
      startFlowScript(),
      ["--track=standard", "--class=software-standard", "--prompt=quiet override test"],
      "",
      process.platform === "win32"
        ? { PATH: "", Path: "", CCLAW_CLI_JS: runtimeShimPath, CCLAW_START_FLOW_QUIET: "0" }
        : { PATH: "", CCLAW_CLI_JS: runtimeShimPath, CCLAW_START_FLOW_QUIET: "0" }
    );

    expect(result.code, result.stderr).toBe(0);
    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal start-flow --track=standard --class=software-standard --prompt=quiet override test");
    expect(calls).not.toContain("--quiet");
  });

  it("stage-complete helper invokes a local Node runtime instead of a cclaw PATH binary", async () => {
    const root = await createTempProject("stage-complete-helper");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });

    const callsPath = path.join(root, "node-runtime-calls.log");
    const runtimeShimPath = path.join(root, "local-runtime.mjs");
    await fs.writeFile(runtimeShimPath, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
`, "utf8");
    await fs.chmod(runtimeShimPath, 0o755);

    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      stageCompleteScript(),
      ["scope", "--passed=scope_contract_written"],
      "",
      process.platform === "win32"
        ? { PATH: "", Path: "", CCLAW_CLI_JS: runtimeShimPath }
        : { PATH: "", CCLAW_CLI_JS: runtimeShimPath }
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal advance-stage scope --passed=scope_contract_written");
  });

  it("stage-complete helper advances state and harvests learnings without cclaw on PATH", { timeout: 30000 }, async () => {
    const root = await createTempProject("stage-complete-no-path-harvest");
    await initCclaw({ projectRoot: root });
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);
    await seedMandatoryDelegationWaivers(root);

    const scriptBody = await fs.readFile(path.join(root, ".cclaw/hooks/stage-complete.mjs"), "utf8");
    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      scriptBody,
      [
        "brainstorm",
        "--evidence-json",
        requiredGateEvidenceJson("brainstorm"),
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...(await proactiveWaiverFlags(root, "brainstorm"))
      ],
      "",
      process.platform === "win32" ? { PATH: "", Path: "" } : { PATH: "" }
    );

    expect(result.code, result.stderr).toBe(0);
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");

    const knowledgeRaw = await fs.readFile(path.join(root, ".cclaw/knowledge.jsonl"), "utf8");
    expect(knowledgeRaw).toContain("when stage completion runs without global cclaw");

    const artifact = await fs.readFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), "utf8");
    expect(artifact).toContain("<!-- cclaw:learnings-harvested:");
    expect(state.guardEvidence.brainstorm_approaches_compared).toBe("evidence for brainstorm_approaches_compared");
  });

  it("stage-complete helper accepts boolean evidence from copied shell commands", { timeout: 30000 }, async () => {
    const root = await createTempProject("stage-complete-boolean-evidence");
    await initCclaw({ projectRoot: root });
    await ensureRunSystem(root);
    await writeBrainstormArtifact(root);
    await seedMandatoryDelegationWaivers(root);

    const scriptBody = await fs.readFile(path.join(root, ".cclaw/hooks/stage-complete.mjs"), "utf8");
    const evidence = JSON.stringify({
      brainstorm_approaches_compared: true,
      brainstorm_direction_approved: true,
      brainstorm_artifact_reviewed: true
    });
    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      scriptBody,
      [
        "brainstorm",
        `--evidence-json=${evidence}`,
        "--passed=brainstorm_approaches_compared,brainstorm_direction_approved,brainstorm_artifact_reviewed",
        "--waive-delegation=product-discovery,critic",
        "--waiver-reason=unit_test",
        ...(await proactiveWaiverFlags(root, "brainstorm"))
      ],
      "",
      process.platform === "win32" ? { PATH: "", Path: "" } : { PATH: "" }
    );

    expect(result.code, result.stderr).toBe(0);
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.guardEvidence.brainstorm_approaches_compared).toBe("passed");
  });

  it("opencode plugin source references only session-start + stop-handoff", () => {
    const plugin = opencodePluginJs();
    expect(plugin).toContain("run-hook.mjs");
    expect(plugin).toContain('runHookScript("session-start"');
    expect(plugin).toContain('runHookScript("stop-handoff"');
    expect(plugin).not.toContain('runHookScript("prompt-guard"');
    expect(plugin).not.toContain('runHookScript("workflow-guard"');
    expect(plugin).not.toContain('runHookScript("context-monitor"');
  });

  it("opencode plugin rehydrates and runs node hook runtime", async () => {
    const root = await createTempProject("opencode-runtime");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/templates/state-contracts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/review-prompts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "design",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), [
      JSON.stringify({
        type: "rule",
        trigger: "when making architecture decisions",
        action: "make trade-offs explicit and include risk notes in the design artifact",
        confidence: "high",
        domain: "architecture",
        stage: "design",
        created: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using Cclaw\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/templates/state-contracts/design.json"),
      JSON.stringify({ stage: "design", requiredTopLevelFields: ["architecture", "dataFlow"] }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/skills/review-prompts/design-eng-review.md"),
      "# Design Eng Review\n\n## Calibration\nCheck architecture, data flow, failure modes.\n",
      "utf8"
    );

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    const hookRuntimePath = path.join(root, ".cclaw/hooks/run-hook.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(hookRuntimePath, nodeHookRuntimeScript(), "utf8");
    await fs.chmod(hookRuntimePath, 0o755);

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      event: (payload: unknown) => Promise<void>;
      "experimental.chat.system.transform": (payload: unknown) => unknown;
    };
    const plugin = pluginFactory({ directory: root }) as {
      event: (payload: unknown) => Promise<void>;
      "experimental.chat.system.transform": (payload: unknown) => unknown;
      "tool.execute.before"?: unknown;
      "tool.execute.after"?: unknown;
    };

    await plugin.event({ event: { type: "session.compacted", data: {} } });
    await plugin.event({ event: { type: "session.idle", data: {} } });

    const transformed = plugin["experimental.chat.system.transform"]({ system: "base system" }) as {
      system: string;
    };
    expect(transformed.system).toContain("Active artifacts: .cclaw/artifacts/");
    expect(transformed.system).toContain("Knowledge digest");
    expect(transformed.system).toContain("make trade-offs explicit");
    expect(transformed.system).toContain("Current stage state contract");
    expect(transformed.system).toContain('"stage": "design"');
    expect(transformed.system).toContain("Current stage calibrated review prompt");
    expect(transformed.system).toContain("Check architecture, data flow");
    expect(plugin["tool.execute.before"]).toBeUndefined();
    expect(plugin["tool.execute.after"]).toBeUndefined();
  });
});
