import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import {
  agentMarkdown,
  CCLAW_AGENTS
} from "../../src/content/core-agents.js";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { TDD as TDD_STAGE } from "../../src/content/stages/tdd.js";
import { createTempProject } from "../helpers/index.js";

const TDD_PREFLIGHT_SECTIONS = `## Test Discovery
- Lists existing tests: tests/unit/dedupe.test.ts
- Fixtures/helpers: test factory and temp project helper
- Exact commands: pnpm vitest run dedupe.test.ts

## System-Wide Impact Check
- Callbacks: none affected
- State transitions: no persisted state transition change
- Interfaces/schemas: public dedupe function contract covered
- Public APIs/config/CLI: no public CLI or config surface change
- Persistence/event contracts: out of scope for this slice

## Iron Law Acknowledgement
- Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Acknowledged: yes
- Exceptions invoked (or \`- None.\`):
  - None.

## Watched-RED Proof
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet | Source command/log |
|---|---|---|---|---|
| S-1 | dedupe fails on duplicate key | 2026-04-30T09:00:00Z | FAIL AssertionError expected unique list | \`pnpm vitest run dedupe.test.ts\` |

## Vertical Slice Cycle
| Slice | RED ts | GREEN ts | REFACTOR ts |
|---|---|---|---|
| S-1 | 2026-04-30T09:00:00Z | 2026-04-30T09:05:00Z | 2026-04-30T09:09:00Z |
`;

const FANOUT_TDD_BODY = `# TDD Artifact

${TDD_PREFLIGHT_SECTIONS}

## RED Evidence
| Slice | Test name | Command | Failure output summary |
|---|---|---|---|
| S-1 | counts unique keys | pnpm vitest run dedupe.test.ts | Cannot find module |

## Acceptance Mapping
| Slice | Plan task ID | Spec criterion ID |
|---|---|---|
| S-1 | T-1 | AC-1 |

## Failure Analysis
| Slice | Expected missing behavior | Actual failure reason |
|---|---|---|
| S-1 | Module not implemented | Module import fails — correct |

## GREEN Evidence
- Full suite command: pnpm vitest run
- Full suite result: 12 passed, 0 failed

## Verification Ladder
- Highest tier reached: command
- Evidence: pnpm vitest run dedupe.test.ts (pass)

## REFACTOR Notes
- What changed: Extracted helper function
- Why: Reuse across tests
- Behavior preserved: Full suite green after refactor

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1
`;

async function seedFanoutFixture(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    JSON.stringify({
      currentStage: "brainstorm",
      activeRunId: "active",
      completedStages: [],
      tddCheckpointMode: "per-slice",
      integrationOverseerMode: "conditional"
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/06-tdd.md"),
    FANOUT_TDD_BODY,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/state/delegation-log.json"),
    JSON.stringify({
      runId: "active",
      schemaVersion: 3,
      entries: [
        {
          stage: "tdd",
          agent: "slice-implementer",
          mode: "mandatory",
          status: "completed",
          spanId: "tdd-slice-implementer-001",
          phase: "green",
          sliceId: "S-1",
          claimedPaths: ["src/auth/login.ts"],
          claimToken: "wave-w01-s1",
          ownerLaneId: "lane-1",
          leasedUntil: "2099-01-01T00:00:00.000Z",
          ts: "2026-05-01T10:00:00Z",
          completedTs: "2026-05-01T10:00:00Z",
          runId: "active",
          evidenceRefs: [".cclaw/artifacts/06-tdd.md#slice-s1"]
        },
        {
          stage: "tdd",
          agent: "slice-implementer",
          mode: "mandatory",
          status: "completed",
          spanId: "tdd-slice-implementer-002",
          phase: "green",
          sliceId: "S-2",
          claimedPaths: ["src/billing/stripe.ts"],
          claimToken: "wave-w01-s2",
          ownerLaneId: "lane-2",
          leasedUntil: "2099-01-01T00:00:00.000Z",
          ts: "2026-05-01T10:02:00Z",
          completedTs: "2026-05-01T10:02:00Z",
          runId: "active",
          evidenceRefs: [".cclaw/artifacts/06-tdd.md#slice-s2"]
        }
      ]
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/cohesion-contract.md"),
    `# Cohesion Contract

## Shared Types & Interfaces
| Symbol | Path | Signature | Owner slice |
|---|---|---|---|
| ContractA | src/auth/login.ts | type ContractA = { ok: boolean } | S-1 |

## Naming Conventions
- Slices use disjoint paths.

## Invariants
- No shared mutable state.

## Integration Touchpoints
| From slice | To slice | Surface | Integration test name |
|---|---|---|---|
| S-1 | S-2 | (disjoint, none) | (none) |

## Behavior Specifications per Slice
### Slice 1
- test: dedupe fails on duplicate key

## Status
| Slice | Implemented | Tests pass | Cohesion verified |
|---|---|---|---|
| S-1 | yes | yes | yes |
| S-2 | yes | yes | yes |
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/cohesion-contract.json"),
    JSON.stringify({
      version: 1,
      sharedTypes: [],
      touchpoints: [],
      slices: [
        { sliceId: "S-1", description: "S1", implemented: true, testsPass: true, cohesionVerified: true },
        { sliceId: "S-2", description: "S2", implemented: true, testsPass: true, cohesionVerified: true }
      ],
      status: { overall: "complete" }
    }, null, 2),
    "utf8"
  );
}

describe("v6.14.1 — TDD controller discipline skill text", () => {
  it("checklist instructs the controller to record scheduled+launched BEFORE Task dispatch", () => {
    const checklistJoined = TDD_STAGE.executionModel.checklist.join("\n");
    expect(checklistJoined).toMatch(/Controller dispatch ordering \(v6\.14\.1/u);
    expect(checklistJoined).toMatch(/record\s+`scheduled`\s+then\s+`launched`/iu);
    expect(checklistJoined).toMatch(/BEFORE\*\* the `Task\(\.\.\.\)`/u);
  });

  it("checklist instructs the controller to call integrationCheckRequired() and emit cclaw_integration_overseer_skipped when required: false", () => {
    const checklistJoined = TDD_STAGE.executionModel.checklist.join("\n");
    expect(checklistJoined).toMatch(/integrationCheckRequired\(events, fanInAudits\)/u);
    expect(checklistJoined).toMatch(/--audit-kind=cclaw_integration_overseer_skipped/u);
    expect(checklistJoined).toMatch(/--audit-reason=/u);
  });

  it("checklist documents inline DOC opt-in for single-slice non-deep waves via slice-implementer --finalize-doc", () => {
    const checklistJoined = TDD_STAGE.executionModel.checklist.join("\n");
    expect(checklistJoined).toMatch(/Inline DOC opt-in/u);
    expect(checklistJoined).toMatch(/slice-implementer --finalize-doc/u);
    expect(checklistJoined).toMatch(/single-slice waves where `flow-state\.json::discoveryMode != "deep"`/u);
  });

  it("checklist documents the stale active-span recovery (--allow-parallel) workaround", () => {
    const checklistJoined = TDD_STAGE.executionModel.checklist.join("\n");
    expect(checklistJoined).toMatch(/Stale active-span recovery/u);
    expect(checklistJoined).toMatch(/dispatch_active_span_collision/u);
    expect(checklistJoined).toMatch(/--allow-parallel/u);
  });

  it("checklist preserves the v6.14.0 refactor-fold rule with the legacyContinuation+global-red carve-out", () => {
    const checklistJoined = TDD_STAGE.executionModel.checklist.join("\n");
    expect(checklistJoined).toMatch(/--refactor-outcome=inline\|deferred/u);
    expect(checklistJoined).toMatch(/legacyContinuation: true/u);
    expect(checklistJoined).toMatch(/global-red/u);
  });
});

describe("v6.14.1 — worker ACK helper template (rendered agent markdown)", () => {
  const tddWorkerAgents = ["test-author", "slice-implementer", "slice-documenter", "integration-overseer"];

  for (const name of tddWorkerAgents) {
    it(`includes the TDD worker self-record template in ${name}.md`, () => {
      const def = CCLAW_AGENTS.find((a) => a.name === name);
      expect(def).toBeDefined();
      const md = agentMarkdown(def!);
      expect(md).toMatch(/## TDD Worker Self-Record Contract \(v6\.14\.\d+\)/u);
      expect(md).toMatch(/--status=acknowledged/u);
      expect(md).toMatch(/--status=completed/u);
      expect(md).toMatch(/delegation-record\.mjs/u);
      expect(md).toMatch(new RegExp(`\\.cclaw/agents/${name}\\.md`, "u"));
    });
  }

  it("does NOT include the TDD worker self-record template on non-TDD agents (e.g. reviewer, planner)", () => {
    for (const name of ["reviewer", "planner", "doc-updater", "researcher"]) {
      const def = CCLAW_AGENTS.find((a) => a.name === name);
      expect(def, `agent ${name} should be defined`).toBeDefined();
      const md = agentMarkdown(def!);
      expect(md).not.toMatch(/## TDD Worker Self-Record Contract \(v6\.14\.\d+\)/u);
    }
  });
});

describe("v6.14.1 — delegation-record.mjs --audit-kind hook surface", () => {
  it("usage block documents the new --audit-kind audit-emit path", () => {
    const script = delegationRecordScript();
    expect(script).toMatch(/--audit-kind=cclaw_integration_overseer_skipped/u);
    expect(script).toMatch(/audit-emit/u);
  });

  it("the embedded script is syntactically valid JavaScript", async () => {
    const script = delegationRecordScript();
    const tmp = path.join(os.tmpdir(), `cclaw-hook-syntax-${Date.now()}.mjs`);
    await fs.writeFile(tmp, script, "utf8");
    const { execFileSync } = await import("node:child_process");
    expect(() => execFileSync("node", ["--check", tmp], { stdio: "pipe" })).not.toThrow();
    await fs.unlink(tmp).catch(() => undefined);
  });

  it("the script accepts --audit-kind=cclaw_integration_overseer_skipped and writes a single audit row", async () => {
    const root = await createTempProject("audit-emit-hook-smoke");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({
        currentStage: "tdd",
        activeRunId: "run-test-audit-001",
        completedStages: []
      }, null, 2),
      "utf8"
    );
    const script = delegationRecordScript();
    const scriptPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, script, "utf8");
    const { execFileSync } = await import("node:child_process");
    const stdout = execFileSync(
      "node",
      [
        scriptPath,
        "--audit-kind=cclaw_integration_overseer_skipped",
        "--audit-reason=disjoint-paths,no-high-risk",
        "--slice-ids=S-1,S-2",
        "--json"
      ],
      { env: { ...process.env, CCLAW_PROJECT_ROOT: root }, stdio: "pipe" }
    ).toString();
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("audit-emit");
    expect(parsed.auditKind).toBe("cclaw_integration_overseer_skipped");
    expect(parsed.runId).toBe("run-test-audit-001");
    expect(parsed.sliceIds).toEqual(["S-1", "S-2"]);
    const eventsRaw = await fs.readFile(
      path.join(root, ".cclaw/state/delegation-events.jsonl"),
      "utf8"
    );
    const lines = eventsRaw.trim().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const auditRow = JSON.parse(lines[0]!);
    expect(auditRow.event).toBe("cclaw_integration_overseer_skipped");
    expect(auditRow.reasons).toEqual(["disjoint-paths", "no-high-risk"]);
    expect(auditRow.sliceIds).toEqual(["S-1", "S-2"]);
  });

  it("rejects unknown --audit-kind values with exit code 2", async () => {
    const root = await createTempProject("audit-emit-hook-rejects");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ activeRunId: "run-x", completedStages: [] }, null, 2),
      "utf8"
    );
    const script = delegationRecordScript();
    const scriptPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, script, "utf8");
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      "node",
      [
        scriptPath,
        "--audit-kind=not_a_real_audit_kind",
        "--json"
      ],
      { env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
    );
    expect(result.status).toBe(2);
    const stdout = result.stdout.toString();
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect((parsed.problems ?? []).join(" ")).toMatch(/invalid --audit-kind/u);
  });
});

describe("v6.14.1 — tdd_integration_overseer_skipped_audit_missing linter rule", () => {
  it("emits an advisory finding when 2+ closed slices closed without overseer dispatch and no audit row", async () => {
    const root = await createTempProject("tdd-overseer-skipped-audit-missing");
    await seedFanoutFixture(root);
    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_integration_overseer_skipped_audit_missing"
    );
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(false);
    expect(finding?.found).toBe(false);
    expect(finding?.details ?? "").toMatch(/Fan-out detected/u);
    expect(finding?.details ?? "").toMatch(/cclaw_integration_overseer_skipped/u);
  });

  it("clears the advisory when the cclaw_integration_overseer_skipped audit row is recorded", async () => {
    const root = await createTempProject("tdd-overseer-skipped-audit-present");
    await seedFanoutFixture(root);
    await fs.appendFile(
      path.join(root, ".cclaw/state/delegation-events.jsonl"),
      JSON.stringify({
        event: "cclaw_integration_overseer_skipped",
        runId: "active",
        ts: "2026-05-01T10:10:00Z",
        eventTs: "2026-05-01T10:10:00Z",
        reasons: ["disjoint-paths"],
        sliceIds: ["S-1", "S-2"]
      }) + "\n",
      "utf8"
    );
    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_integration_overseer_skipped_audit_missing"
    );
    expect(finding).toBeUndefined();
  });

  it("clears the advisory when an integration-overseer dispatch was recorded (even without audit row)", async () => {
    const root = await createTempProject("tdd-overseer-dispatch-present");
    await seedFanoutFixture(root);
    const ledgerPath = path.join(root, ".cclaw/state/delegation-log.json");
    const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    ledger.entries.push({
      stage: "tdd",
      agent: "integration-overseer",
      mode: "proactive",
      status: "completed",
      spanId: "tdd-integration-overseer-001",
      ts: "2026-05-01T10:10:00Z",
      completedTs: "2026-05-01T10:10:00Z",
      runId: "active",
      evidenceRefs: ["integration-overseer: PASS_WITH_GAPS — no P1 findings"]
    });
    await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_integration_overseer_skipped_audit_missing"
    );
    expect(finding).toBeUndefined();
  });

  it("never blocks stage-complete (advisory only)", async () => {
    const root = await createTempProject("tdd-overseer-skipped-audit-advisory-only");
    await seedFanoutFixture(root);
    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find(
      (f) => f.section === "tdd_integration_overseer_skipped_audit_missing"
    );
    expect(finding?.required).toBe(false);
  });
});

describe("v6.14.1 — runtime: completed events clear active-span set across stage boundaries", () => {
  it("a span scheduled+launched+completed under stage=tdd is cleared from active before a new tdd dispatch", async () => {
    const { computeActiveSubagents } = await import("../../src/delegation.js");
    const t0 = "2026-05-04T13:45:16.787Z";
    const t1 = "2026-05-04T13:45:16.838Z";
    const t2 = "2026-05-04T13:45:26.519Z";
    const t3 = "2026-05-04T13:45:26.571Z";
    const stale = [
      { stage: "tdd" as const, agent: "slice-implementer" as const, mode: "mandatory" as const, status: "scheduled" as const, spanId: "tdd-slice-implementer-015", ts: t0, startTs: t0 },
      { stage: "tdd" as const, agent: "slice-implementer" as const, mode: "mandatory" as const, status: "launched" as const, spanId: "tdd-slice-implementer-015", ts: t1, startTs: t0, launchedTs: t1 },
      { stage: "tdd" as const, agent: "slice-implementer" as const, mode: "mandatory" as const, status: "acknowledged" as const, spanId: "tdd-slice-implementer-015", ts: t2, startTs: t0, launchedTs: t1, ackTs: t2 },
      { stage: "tdd" as const, agent: "slice-implementer" as const, mode: "mandatory" as const, status: "completed" as const, spanId: "tdd-slice-implementer-015", ts: t3, startTs: t0, launchedTs: t1, ackTs: t2, completedTs: t3, endTs: t3 }
    ];
    expect(computeActiveSubagents(stale)).toEqual([]);
  });

  it("a stage-boundary completed phase=green clears the span even when REFACTOR is folded into GREEN via refactorOutcome", async () => {
    const { computeActiveSubagents } = await import("../../src/delegation.js");
    const t0 = "2026-05-04T14:00:00.000Z";
    const t1 = "2026-05-04T14:00:00.500Z";
    const t2 = "2026-05-04T14:00:01.000Z";
    const entries = [
      { stage: "tdd" as const, agent: "slice-implementer" as const, mode: "mandatory" as const, status: "scheduled" as const, spanId: "tdd-slice-implementer-fold", phase: "green" as const, sliceId: "S-1", ts: t0, startTs: t0 },
      { stage: "tdd" as const, agent: "slice-implementer" as const, mode: "mandatory" as const, status: "completed" as const, spanId: "tdd-slice-implementer-fold", phase: "green" as const, sliceId: "S-1", ts: t2, startTs: t0, launchedTs: t1, completedTs: t2, refactorOutcome: { mode: "deferred" as const, rationale: "no shared state" } }
    ];
    expect(computeActiveSubagents(entries)).toEqual([]);
  });
});
