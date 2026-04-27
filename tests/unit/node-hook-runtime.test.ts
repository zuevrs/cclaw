import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";

interface RuntimeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runNodeHook(
  root: string,
  hookName: string,
  scriptBody: string,
  input: unknown = {},
  extraEnv: Record<string, string> = {}
): Promise<RuntimeResult> {
  const scriptPath = path.join(root, "run-hook.mjs");
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);
  const payload = typeof input === "string" ? input : JSON.stringify(input);

  return await new Promise<RuntimeResult>((resolve, reject) => {
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
    const child = spawn(process.execPath, [scriptPath, hookName], {
      cwd: root,
      env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

describe("node hook runtime", () => {
  it("session-start emits bootstrap payload with inline knowledge digest", async () => {
    const root = await createTempProject("node-hook-session-start");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/templates/state-contracts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/review-prompts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-node",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), [
      JSON.stringify({
        type: "pattern",
        trigger: "when review scope is too broad",
        action: "split into focused diffs",
        confidence: "high",
        domain: "review",
        stage: "review",
        origin_stage: "review",
        origin_run: "feature-a",
        frequency: 2,
        universality: "project",
        maturity: "raw",
        created: "2026-04-20T00:00:00Z",
        first_seen_ts: "2026-04-20T00:00:00Z",
        last_seen_ts: "2026-04-20T00:00:00Z",
        project: "cclaw"
      })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/templates/state-contracts/review.json"),
      JSON.stringify({ stage: "review", requiredTopLevelFields: ["stage", "verdict"] }, null, 2),
      "utf8"
    );

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context =
      payload.hookSpecificOutput?.additionalContext ??
      payload.additional_context ??
      "";
    expect(context).toContain("cclaw loaded. Flow: stage=review");
    expect(context).toContain("run=run-node");
    expect(context).toContain("Knowledge digest");
    expect(context).toContain("split into focused diffs");
    expect(context).toContain("Current stage state contract");
    expect(context).toContain('"stage": "review"');
    await expect(fs.stat(path.join(root, ".cclaw/state/knowledge-digest.md"))).rejects.toBeDefined();
  });

  it("session-start refreshes compound-readiness.json and surfaces a nudge during review", async () => {
    const root = await createTempProject("node-hook-compound-readiness");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-compound",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const baseRow = {
      type: "pattern",
      confidence: "medium",
      domain: null,
      stage: "review",
      origin_stage: "review",
      origin_run: null,
      project: "cclaw",
      universality: "project",
      maturity: "raw",
      created: "2026-04-15T00:00:00Z",
      first_seen_ts: "2026-04-15T00:00:00Z",
      last_seen_ts: "2026-04-15T00:00:00Z"
    };
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), [
      JSON.stringify({
        ...baseRow,
        trigger: "swallowed errors",
        action: "rethrow with context",
        frequency: 4
      })
    ].join("\n"), "utf8");
    // Seed enough archived runs so the small-project relaxation does
    // NOT fire — we want to assert the baked-in threshold here.
    for (const name of ["run-a", "run-b", "run-c", "run-d", "run-e"]) {
      await fs.mkdir(path.join(root, ".cclaw/runs", name), { recursive: true });
    }

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context =
      payload.hookSpecificOutput?.additionalContext ??
      payload.additional_context ??
      "";
    expect(context).toContain("Compound readiness: clusters=1, ready=1");

    const readiness = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/compound-readiness.json"), "utf8")
    ) as {
      schemaVersion: number;
      threshold: number;
      baseThreshold: number;
      archivedRunsCount: number;
      smallProjectRelaxationApplied: boolean;
      readyCount: number;
    };
    expect(readiness.schemaVersion).toBe(2);
    expect(readiness.threshold).toBe(3);
    expect(readiness.baseThreshold).toBe(3);
    expect(readiness.archivedRunsCount).toBe(5);
    expect(readiness.smallProjectRelaxationApplied).toBe(false);
    expect(readiness.readyCount).toBe(1);
  });

  it("session-start refreshes compound-readiness.json silently outside review/ship", async () => {
    const root = await createTempProject("node-hook-compound-readiness-silent");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "plan",
      activeRunId: "run-plan",
      completedStages: ["brainstorm", "scope", "design", "spec"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), JSON.stringify({
      type: "pattern",
      confidence: "medium",
      domain: null,
      stage: "review",
      origin_stage: "review",
      origin_run: null,
      project: "cclaw",
      universality: "project",
      maturity: "raw",
      created: "2026-04-15T00:00:00Z",
      first_seen_ts: "2026-04-15T00:00:00Z",
      last_seen_ts: "2026-04-15T00:00:00Z",
      trigger: "x",
      action: "y",
      frequency: 5
    }), "utf8");

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context =
      payload.hookSpecificOutput?.additionalContext ??
      payload.additional_context ??
      "";
    expect(context).not.toContain("Compound readiness:");

    const readiness = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/compound-readiness.json"), "utf8")
    ) as { readyCount: number };
    expect(readiness.readyCount).toBe(1);
  });

  it("session-start acquires the CLI-compatible knowledge lock before reading knowledge.jsonl", async () => {
    const root = await createTempProject("node-hook-knowledge-lock");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "plan",
      activeRunId: "run-lock",
      completedStages: ["brainstorm", "scope", "design", "spec"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), "", "utf8");

    // Pre-acquire the CLI's knowledge lock so the hook MUST wait on it.
    // We release after a short delay; if the hook were still doing a raw
    // readFile it would complete before the delay and the test would be
    // meaningless. With the lock-aware read the hook's elapsed time is
    // bounded below by our hold duration.
    const lockDir = path.join(root, ".cclaw/state/.knowledge.lock");
    await fs.mkdir(path.dirname(lockDir), { recursive: true });
    await fs.mkdir(lockDir);
    const holdMs = 400;
    const release = setTimeout(() => {
      fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
    }, holdMs);

    const started = Date.now();
    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    const elapsed = Date.now() - started;
    clearTimeout(release);
    expect(result.code).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(holdMs - 80);
  });

  it("session-start records a breadcrumb when ralph-loop / compound-readiness fail", async () => {
    const root = await createTempProject("node-hook-breadcrumb");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-bad",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), "", "utf8");

    // Pre-create a FILE at the ralph-loop.json lock directory path; this
    // makes `fs.mkdir(lockPath)` fail repeatedly with ENOTDIR-adjacent
    // errors, which surfaces as "failed to acquire lock". The session
    // must still exit 0 but leave a breadcrumb.
    const ralphPath = path.join(root, ".cclaw/state/ralph-loop.json");
    await fs.writeFile(ralphPath + ".lock", "not-a-dir", "utf8");

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);

    const breadcrumbs = await fs
      .readFile(path.join(root, ".cclaw/state/hook-errors.jsonl"), "utf8")
      .catch(() => "");
    expect(breadcrumbs).toContain("session-start:ralph-loop");
  });

  it("stop-handoff emits a handoff reminder without writing checkpoint state", async () => {
    const root = await createTempProject("node-hook-stop");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "plan",
      activeRunId: "run-plan",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");

    const result = await runNodeHook(
      root,
      "stop-handoff",
      nodeHookRuntimeScript(),
      { loop_count: 0 }
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("session ending (stage=plan");
    await expect(fs.stat(path.join(root, ".cclaw/state/checkpoint.json"))).rejects.toBeDefined();
  });

  it("stop alias includes closeout context after ship", async () => {
    const root = await createTempProject("node-hook-stop-closeout");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "ship",
      activeRunId: "run-ship",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review"],
      closeout: { shipSubstate: "compound_review" }
    }, null, 2), "utf8");

    const result = await runNodeHook(
      root,
      "stop",
      nodeHookRuntimeScript(),
      { loop_count: 0 }
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("session ending (stage=ship");
    expect(result.stdout).toContain("closeout.shipSubstate=compound_review");
    expect(result.stdout).toContain("closeout chain=retro -> compound -> archive");
    expect(result.stdout).toContain("continue closeout with /cc-next");
  });

  it("prompt-guard supports advisory and strict modes", async () => {
    const root = await createTempProject("node-hook-prompt-guard");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const payload = {
      tool_name: "Write",
      tool_input: {
        path: ".cclaw/state/flow-state.json",
        content: "x"
      }
    };

    const advisory = await runNodeHook(
      root,
      "prompt-guard",
      nodeHookRuntimeScript(),
      payload
    );
    expect(advisory.code).toBe(0);
    expect(advisory.stderr).toContain("Cclaw advisory");
    const advisoryPayload = JSON.parse(advisory.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const advisoryContext =
      advisoryPayload.hookSpecificOutput?.additionalContext ??
      advisoryPayload.additional_context ??
      "";
    expect(advisoryContext).toContain("potential risky write intent");
    const log = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(log).toContain("write_to_cclaw_runtime");

    const strict = await runNodeHook(
      root,
      "prompt-guard",
      nodeHookRuntimeScript({ strictness: "strict" }),
      payload
    );
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("blocked by strict mode");
    const strictPayload = JSON.parse(strict.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const strictContext =
      strictPayload.hookSpecificOutput?.additionalContext ??
      strictPayload.additional_context ??
      "";
    expect(strictContext).toContain("Blocked by strict mode");
  });

  it("prompt-guard allows normal artifact writes", async () => {
    const root = await createTempProject("node-hook-prompt-guard-artifacts");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const payload = {
      tool_name: "Write",
      tool_input: {
        path: ".cclaw/artifacts/01-brainstorm.md",
        content: "# brainstorm\n"
      }
    };

    const result = await runNodeHook(
      root,
      "prompt-guard",
      nodeHookRuntimeScript(),
      payload
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("write_to_cclaw_runtime");
  });

  it("workflow-guard enforces per-path RED evidence when tdd-red-before-write is strict", async () => {
    const root = await createTempProject("node-hook-workflow-guard");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    // Keep the project-wide strictness advisory; opt the single TDD iron law
    // into strict mode so this test asserts ironLaws.strictLaws per-law escape.
    // `strictLawSet` in run-hook.mjs reads the `strict` flag off each laws[]
    // entry (see src/content/iron-laws.ts#ironLawRuntimeDocument).
    await fs.writeFile(
      path.join(root, ".cclaw/state/iron-laws.json"),
      JSON.stringify(
        {
          mode: "advisory",
          strictLaws: ["tdd-red-before-write"],
          laws: [{ id: "tdd-red-before-write", strict: true }]
        },
        null,
        2
      ),
      "utf8"
    );
    // Pretend a recent flow-state read already happened so staleness reasons
    // don't fire alongside the TDD evidence check.
    const nowEpoch = Math.floor(Date.now() / 1000);
    await fs.writeFile(
      path.join(root, ".cclaw/state/workflow-guard.json"),
      JSON.stringify({ lastFlowReadAtEpoch: nowEpoch }, null, 2),
      "utf8"
    );

    const missingRed = await runNodeHook(
      root,
      "workflow-guard",
      nodeHookRuntimeScript(),
      {
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 1;\n"
        }
      }
    );
    expect(missingRed.code).toBe(1);
    expect(missingRed.stderr).toContain("missing failing RED evidence");

    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({
        ts: "2026-04-20T00:00:00Z",
        runId: "run-tdd",
        stage: "tdd",
        slice: "S-1",
        phase: "red",
        command: "npm test -- tests/unit/app.test.ts",
        files: ["src/app.ts"],
        exitCode: 1
      })
    ].join("\n"), "utf8");

    const hasRed = await runNodeHook(
      root,
      "workflow-guard",
      nodeHookRuntimeScript(),
      {
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 2;\n"
        }
      }
    );
    expect(hasRed.code).toBe(0);
    expect(hasRed.stderr).not.toContain("missing failing RED evidence");
  });


  it("workflow-guard treats notebook edits as mutating writes in tdd", async () => {
    const root = await createTempProject("node-hook-workflow-guard-notebook-edit");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-tdd-notebook",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/state/workflow-guard.json"),
      JSON.stringify({ lastFlowReadAtEpoch: Math.floor(Date.now() / 1000) }, null, 2),
      "utf8"
    );

    const result = await runNodeHook(
      root,
      "workflow-guard",
      nodeHookRuntimeScript({ strictness: "strict" }),
      {
        tool_name: "NotebookEdit",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 3;\n"
        }
      }
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missing failing RED evidence");
  });

  it("verify-current-state uses local CLI entrypoint instead of cclaw on PATH", async () => {
    const root = await createTempProject("node-hook-verify-current-state");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const callsPath = path.join(root, "verify-calls.log");
    const cliPath = path.join(root, "local-cli.mjs");
    await fs.writeFile(
      cliPath,
      `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "internal" && process.argv[3] === "verify-current-state") {
  process.exit(Number(process.env.CCLAW_FAKE_VERIFY_EXIT || "0"));
}
process.exit(0);
`,
      "utf8"
    );
    await fs.chmod(cliPath, 0o755);
    const emptyPathEnv = process.platform === "win32" ? { PATH: "", Path: "" } : { PATH: "" };

    const runtime = nodeHookRuntimeScript();
    expect(runtime).not.toContain('spawn(\n        isWindows ? "cmd.exe" : "cclaw"');
    expect(runtime).toContain("process.execPath");

    const strictFail = await runNodeHook(
      root,
      "verify-current-state",
      runtime,
      {},
      {
        ...emptyPathEnv,
        CCLAW_CLI_JS: cliPath,
        CCLAW_STRICTNESS: "strict",
        CCLAW_FAKE_VERIFY_EXIT: "1"
      }
    );
    expect(strictFail.code, strictFail.stderr).toBe(1);

    const advisoryFail = await runNodeHook(
      root,
      "verify-current-state",
      runtime,
      {},
      {
        ...emptyPathEnv,
        CCLAW_CLI_JS: cliPath,
        CCLAW_STRICTNESS: "advisory",
        CCLAW_FAKE_VERIFY_EXIT: "1"
      }
    );
    expect(advisoryFail.code, advisoryFail.stderr).toBe(0);

    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal verify-current-state --quiet");

    const advisoryMissingEntrypoint = await runNodeHook(
      root,
      "verify-current-state",
      nodeHookRuntimeScript(),
      {},
      {
        ...emptyPathEnv,
        CCLAW_CLI_JS: path.join(root, "missing-cli.mjs")
      }
    );
    expect(advisoryMissingEntrypoint.code).toBe(0);
    expect(advisoryMissingEntrypoint.stderr).toContain("local Node runtime entrypoint not found");

    const strictMissingEntrypoint = await runNodeHook(
      root,
      "verify-current-state",
      nodeHookRuntimeScript(),
      {},
      {
        ...emptyPathEnv,
        CCLAW_CLI_JS: path.join(root, "missing-cli.mjs"),
        CCLAW_STRICTNESS: "strict"
      }
    );
    expect(strictMissingEntrypoint.code).toBe(1);
    expect(strictMissingEntrypoint.stderr).toContain("local Node runtime entrypoint not found");
  });

  it("context-monitor debounces advisories and auto-captures failing tests", async () => {
    const root = await createTempProject("node-hook-context-monitor");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-context",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");

    const warningPayload = {
      context: { remaining_percent: 18 }
    };
    const first = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      warningPayload
    );
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("Cclaw advisory");
    const firstPayload = JSON.parse(first.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const firstContext =
      firstPayload.hookSpecificOutput?.additionalContext ??
      firstPayload.additional_context ??
      "";
    expect(firstContext).toContain("context remaining is");

    const second = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      warningPayload
    );
    expect(second.code).toBe(0);
    expect(second.stderr).toBe("");

    const forced = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      warningPayload,
      { CCLAW_CONTEXT_MONITOR_TTL_SEC: "0" }
    );
    expect(forced.code).toBe(0);
    expect(forced.stderr).toContain("Cclaw advisory");

    const autoEvidence = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      {
        input: {
          tool: "RunCommand",
          tool_input: { cmd: "npm test -- tests/unit/app.test.ts" }
        },
        output: {
          exitCode: 1,
          stderr: "FAIL src/app.ts"
        }
      }
    );
    expect(autoEvidence.code).toBe(0);
    const evidenceLog = await fs.readFile(
      path.join(root, ".cclaw/state/tdd-red-evidence.jsonl"),
      "utf8"
    );
    expect(evidenceLog).toContain('"source":"posttool-auto"');
    expect(evidenceLog).toContain("src/app.ts");
  });

  it("exits 0 silently when no .cclaw runtime is present in any candidate root", async () => {
    const root = await createTempProject("node-hook-no-runtime");
    // Deliberately do NOT create .cclaw/ — simulates running the hook in a
    // directory that has never been `cclaw init`-ed.
    const result = await runNodeHook(
      root,
      "prompt-guard",
      nodeHookRuntimeScript({ strictness: "strict" }),
      {
        tool_name: "Write",
        tool_input: { path: "src/app.ts", content: "x" }
      }
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });
});
