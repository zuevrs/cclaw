import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { checkMandatoryDelegations } from "../../src/delegation.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function writeRuntimeArtifact(
  root: string,
  fileName: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    JSON.stringify({ currentStage: "brainstorm", activeRunId: "run-fixture", completedStages: [] }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(root, ".cclaw/artifacts", fileName), content, "utf8");
}

// ---------------------------------------------------------------------------
// Layer 3.1 — delegation-record helper regressions on dispatch-surface enum.
// ---------------------------------------------------------------------------

describe("delegation-record helper enum + path validation", () => {
  it("rejects deprecated --dispatch-surface=task and lists allowed values", async () => {
    const root = await createTempProject("delegation-helper-rejects-task");
    await initCclaw({ projectRoot: root, harnesses: ["opencode"] });

    const helper = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await expect(
      execFileAsync(
        process.execPath,
        [
          helper,
          "--stage=scope",
          "--agent=planner",
          "--mode=mandatory",
          "--span-id=span-x",
          "--dispatch-id=dispatch-x",
          "--dispatch-surface=task",
          "--agent-definition-path=.opencode/agents/planner.md",
          "--ack-ts=2026-04-28T12:00:00Z",
          "--status=completed",
          "--json"
        ],
        { cwd: root, env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
      )
    ).rejects.toMatchObject({
      stdout: expect.stringMatching(/invalid --dispatch-surface/i)
    });
  });

  it("accepts --dispatch-surface=opencode-agent when path matches harness directory", async () => {
    const root = await createTempProject("delegation-helper-accepts-opencode");
    await initCclaw({ projectRoot: root, harnesses: ["opencode"] });

    const helper = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    const args = [
      helper,
      "--stage=scope",
      "--agent=planner",
      "--mode=mandatory",
      "--span-id=span-ok",
      "--dispatch-id=dispatch-ok",
      "--dispatch-surface=opencode-agent",
      "--agent-definition-path=.opencode/agents/planner.md",
      "--json"
    ];

    for (const status of ["scheduled", "launched", "acknowledged", "completed"]) {
      const result = await execFileAsync(
        process.execPath,
        [...args, `--status=${status}`],
        { cwd: root, env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
      );
      expect(result.stdout).toContain('"ok": true');
    }
  });

  it("rejects --agent-definition-path that does not match the dispatch-surface directory", async () => {
    const root = await createTempProject("delegation-helper-rejects-path");
    await initCclaw({ projectRoot: root, harnesses: ["opencode"] });

    const helper = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await expect(
      execFileAsync(
        process.execPath,
        [
          helper,
          "--stage=scope",
          "--agent=planner",
          "--mode=mandatory",
          "--span-id=span-y",
          "--dispatch-id=dispatch-y",
          "--dispatch-surface=opencode-agent",
          "--agent-definition-path=.codex/agents/planner.toml",
          "--ack-ts=2026-04-28T12:00:00Z",
          "--status=completed",
          "--json"
        ],
        { cwd: root, env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
      )
    ).rejects.toMatchObject({
      stdout: expect.stringMatching(/agent-definition-path does not lie under any allowed prefix/iu)
    });
  });

  it("rejects --agent-definition-path that does not exist on disk", async () => {
    const root = await createTempProject("delegation-helper-rejects-missing-path");
    await initCclaw({ projectRoot: root, harnesses: ["opencode"] });

    const helper = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await expect(
      execFileAsync(
        process.execPath,
        [
          helper,
          "--stage=scope",
          "--agent=planner",
          "--mode=mandatory",
          "--span-id=span-z",
          "--dispatch-id=dispatch-z",
          "--dispatch-surface=opencode-agent",
          "--agent-definition-path=.opencode/agents/does-not-exist.md",
          "--ack-ts=2026-04-28T12:00:00Z",
          "--status=completed",
          "--json"
        ],
        { cwd: root, env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
      )
    ).rejects.toMatchObject({
      stdout: expect.stringMatching(/does not exist on disk/iu)
    });
  });

  // ---------------------------------------------------------------------
  // End-to-end --rerecord coverage. The legacy ledger row is upgraded in
  // place to the v3 shape, the matching event is appended to the audit
  // log with `rerecord: true`, and `checkMandatoryDelegations` no longer
  // trips the legacy-inferred guard for that span.
  // ---------------------------------------------------------------------
  it("upgrades a pre-v3 legacy ledger row in place via --rerecord and clears legacyRequiresRerecord", async () => {
    const root = await createTempProject("delegation-helper-rerecord-upgrades-legacy");
    await initCclaw({ projectRoot: root, harnesses: ["opencode"] });

    const stateDir = path.join(root, ".cclaw/state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "flow-state.json"),
      JSON.stringify(
        { currentStage: "scope", activeRunId: "run-legacy-1", completedStages: [] },
        null,
        2
      ),
      "utf8"
    );

    const legacyRow = {
      stage: "scope",
      agent: "planner",
      mode: "mandatory" as const,
      status: "completed" as const,
      spanId: "legacy-span-1",
      ts: "2026-04-01T12:00:00Z",
      runId: "run-legacy-1"
    };
    await fs.writeFile(
      path.join(stateDir, "delegation-log.json"),
      JSON.stringify({ runId: "run-legacy-1", entries: [legacyRow] }, null, 2),
      "utf8"
    );

    // Sanity: before rerecord, the legacy row should trip both
    // legacy-inferred tagging and the satisfied=false guard.
    const before = await checkMandatoryDelegations(root, "scope");
    expect(before.satisfied).toBe(false);
    expect(
      before.legacyInferredCompletions.some((row) => row.startsWith("planner"))
    ).toBe(true);

    const helper = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    const rerecord = await execFileAsync(
      process.execPath,
      [
        helper,
        "--rerecord",
        "--span-id=legacy-span-1",
        "--dispatch-id=dispatch-1",
        "--dispatch-surface=opencode-agent",
        "--agent-definition-path=.opencode/agents/planner.md",
        "--ack-ts=2026-04-28T12:00:00Z",
        "--completed-ts=2026-04-28T12:01:00Z",
        "--json"
      ],
      { cwd: root, env: { ...process.env, CCLAW_PROJECT_ROOT: root } }
    );
    const rerecordPayload = JSON.parse(rerecord.stdout) as {
      ok: boolean;
      rerecord: boolean;
      event: { rerecord: boolean; event: string; spanId: string };
    };
    expect(rerecordPayload.ok).toBe(true);
    expect(rerecordPayload.rerecord).toBe(true);

    const ledgerRaw = await fs.readFile(
      path.join(stateDir, "delegation-log.json"),
      "utf8"
    );
    const ledger = JSON.parse(ledgerRaw) as {
      schemaVersion?: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(ledger.schemaVersion).toBe(3);
    const planner = ledger.entries.find(
      (entry) => entry.spanId === "legacy-span-1"
    );
    expect(planner).toBeDefined();
    expect(planner?.schemaVersion).toBe(3);
    expect(planner?.dispatchSurface).toBe("opencode-agent");
    expect(planner?.agentDefinitionPath).toBe(".opencode/agents/planner.md");
    expect(planner?.dispatchId).toBe("dispatch-1");
    expect(planner?.ackTs).toBe("2026-04-28T12:00:00Z");
    expect(planner?.completedTs).toBe("2026-04-28T12:01:00Z");
    expect(planner?.fulfillmentMode).toBe("isolated");
    // Only one row per spanId — the legacy v1 row has been replaced, not
    // appended next to.
    expect(
      ledger.entries.filter((entry) => entry.spanId === "legacy-span-1").length
    ).toBe(1);

    const eventsRaw = await fs.readFile(
      path.join(stateDir, "delegation-events.jsonl"),
      "utf8"
    );
    const events = eventsRaw
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const rerecordEvent = events.find(
      (entry) =>
        entry.spanId === "legacy-span-1" &&
        entry.event === "completed" &&
        entry.rerecord === true
    );
    expect(rerecordEvent).toBeDefined();
    expect(rerecordEvent?.dispatchSurface).toBe("opencode-agent");
    expect(rerecordEvent?.schemaVersion).toBe(3);

    const after = await checkMandatoryDelegations(root, "scope");
    expect(
      after.legacyInferredCompletions.some((row) => row.startsWith("planner"))
    ).toBe(false);
    expect(after.missing).not.toContain("planner");
    // The row is now a real v3 isolated completion with full dispatch
    // proof, so it no longer trips legacyRequiresRerecord. Other stage
    // mandatory delegations (critic etc.) may still be missing — we only
    // assert that the *previously legacy* row is now clean.
  });
});

// ---------------------------------------------------------------------------
// Layer 3.1 — Linter fixtures across diverse non-web tasks.
//
// These fixtures intentionally avoid web/UI/CRUD vocabulary and exercise the
// universal structural sections introduced in Layer 2 against three task
// types: a CLI utility, a library, and an infra/migration task.
// ---------------------------------------------------------------------------

describe("brainstorm linter universal structural checks", () => {
  it("fails when Mode Block is present without a recognized mode token (CLI utility)", async () => {
    const root = await createTempProject("brainstorm-mode-missing-cli");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- Mode: <to be picked>
- Why this mode: still deciding

## Approach Tier
- Tier: Standard

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A | baseline | modest | streaming parser | weaker batch perf |  |
| B | challenger | high | structured AST | extra build dep | recommended |

## Approach Reaction
- Closest option: B
- Concerns: dep size
- What changed after reaction: vendored small subset

## Selected Direction
- Approach: B — vendored AST helper
- Rationale: user reaction prefers ergonomics over dep churn
- Approval: approved by user
- Next-stage handoff: scope
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const modeBlock = result.findings.find((f) => f.section === "Mode Block Token");
    expect(modeBlock?.found).toBe(false);
  });

  it("passes when Forcing Questions answers include specific tokens (library task)", async () => {
    const root = await createTempProject("brainstorm-forcing-questions-library");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- Mode: ENGINEERING
- Why this mode: library extraction work

## Forcing Questions
| # | Forcing question | Specific answer | Decision impact | Q<n> decision |
|---|---|---|---|---|
| 1 | Who consumes this library? | Internal CLI \`bin/cli.mjs\` and CI workflow | locks public API surface | decision: accept |
| 2 | What is the perf budget? | parse 10000 records under 200ms | drives streaming choice | decision: accept |
| 3 | What is the rollback path? | revert to commit \`abc1234\` | no migration needed | decision: accept |

## Premise List
- P1: extracting the parser as a library reduces drift across consumers — agreed
- P2: vendored copy is simpler than a separate package — disagreed

## Anti-Sycophancy Stamp
- Forbidden response openers acknowledged: yes
- Posture commitment: push back with reasoning when premises feel weak
- Evidence-that-would-change-the-recommendation: a benchmark showing vendored copy diverges within 30 days

## Approaches
| Approach | Role | Upside | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|---|
| A | baseline | modest | vendored copy | drift risk |  |
| B | challenger | high | shared package | dep coordination | recommended |

#### APPROACH A
- Summary: vendor the parser into each consumer
- Effort: S
- Risk: Medium
- Pros: zero coordination
- Cons: drift across consumers
- Reuses: existing local code

#### APPROACH B
- Summary: extract a shared package
- Effort: M
- Risk: Low
- Pros: single source of truth
- Cons: needs release coordination
- Reuses: existing test fixtures

RECOMMENDATION: B — shared package eliminates drift; perf budget already covered by streaming refactor.

## Approach Reaction
- Closest option: B
- Concerns: release coordination
- What changed after reaction: chose monorepo workspace to skip publish step

## Selected Direction
- Approach: B — shared package via workspace
- Rationale: user reaction agreed coordination cost is one-time
- Approval: approved by user
- Next-stage handoff: scope

## Outside Voice
- source: not used
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const forcingCount = result.findings.find(
      (f) => f.section === "Forcing Questions Count"
    );
    const forcingSpecific = result.findings.find(
      (f) => f.section === "Forcing Questions Specific Answers"
    );
    const premiseShape = result.findings.find((f) => f.section === "Premise List Shape");
    const detailCards = result.findings.find((f) => f.section === "Approach Detail Cards");
    const stamp = result.findings.find((f) => f.section === "Anti-Sycophancy Acknowledgement");
    expect(forcingCount?.found).toBe(true);
    expect(forcingSpecific?.found).toBe(true);
    expect(premiseShape?.found).toBe(true);
    expect(detailCards?.found).toBe(true);
    expect(stamp?.found).toBe(true);
  });

  it("fails Approach Detail Cards when RECOMMENDATION line is missing (infra/migration)", async () => {
    const root = await createTempProject("brainstorm-no-recommendation-infra");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

#### APPROACH A
- Summary: rolling restart
- Effort: M
- Risk: Medium
- Pros: minimal downtime
- Cons: longer rollout window
- Reuses: existing rollout playbook

#### APPROACH B
- Summary: blue/green
- Effort: L
- Risk: Low
- Pros: instant rollback
- Cons: doubled capacity
- Reuses: existing capacity reservations
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const recommendation = result.findings.find(
      (f) => f.section === "Approach Recommendation Marker"
    );
    expect(recommendation?.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 0.51.28 regression — linter must tolerate the actual shipped template
// shape, which renders structural fields with bold markdown emphasis and
// uses the short `lite` Approach Tier label. Earlier fixtures wrote
// `- Mode: ENGINEERING` and `- Tier: Standard` without bold, which let
// regexes that only allowed `\s*` between `Field:` and the value silently
// pass CI even though the runtime artifact (`- **Mode:** STARTUP`) failed.
// ---------------------------------------------------------------------------

describe("0.51.28 — bold-emphasis tolerance and tier vocabulary", () => {
  it("passes Mode Block Token when the field uses the shipped bold form (CLI utility)", async () => {
    const root = await createTempProject("brainstorm-mode-bold-cli");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- **Mode:** ENGINEERING
- **Why this mode:** maintenance work on a CLI utility

## Approach Tier
- Tier: Standard
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const modeBlock = result.findings.find((f) => f.section === "Mode Block Token");
    expect(modeBlock?.found).toBe(true);
  });

  it("rejects Mode Block when the bold-form placeholder lists every option (library)", async () => {
    const root = await createTempProject("brainstorm-mode-placeholder-library");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- **Mode:** STARTUP | BUILDER | ENGINEERING | OPS | RESEARCH (pick exactly one)
- **Why this mode:** placeholder kept verbatim from template

## Approach Tier
- Tier: Standard
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const modeBlock = result.findings.find((f) => f.section === "Mode Block Token");
    expect(modeBlock?.found).toBe(false);
    expect(modeBlock?.details ?? "").toMatch(/multiple|placeholder/i);
  });

  it("passes Anti-Sycophancy Acknowledgement with the shipped bold form (library)", async () => {
    const root = await createTempProject("brainstorm-anti-sycophancy-bold-library");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- **Mode:** ENGINEERING
- **Why this mode:** library extraction

## Anti-Sycophancy Stamp
- **Forbidden response openers acknowledged:** yes (no "you're absolutely right", "great point", "absolutely!", etc.)
- **Posture commitment:** push back with reasoning when premises feel weak.
- **Evidence-that-would-change-the-recommendation:** benchmark showing vendored copy diverges within 30 days.

## Approach Tier
- Tier: Standard
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const stamp = result.findings.find((f) => f.section === "Anti-Sycophancy Acknowledgement");
    expect(stamp?.found).toBe(true);
  });

  it("passes Approach Tier Classification when the value is `lite` (CLI utility)", async () => {
    const root = await createTempProject("brainstorm-tier-lite-cli");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- **Mode:** ENGINEERING
- **Why this mode:** small CLI tweak

## Approach Tier
- Tier: lite
- Why this tier: low-risk one-shot
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const tier = result.findings.find((f) => f.section === "Approach Tier Classification");
    expect(tier?.found).toBe(true);
  });

  it("rejects Approach Tier when the placeholder still lists every option (infra/migration)", async () => {
    const root = await createTempProject("brainstorm-tier-placeholder-infra");
    await writeRuntimeArtifact(
      root,
      "01-brainstorm.md",
      `# Brainstorm Artifact

## Mode Block
- **Mode:** OPS
- **Why this mode:** rolling migration

## Approach Tier
- Tier: lite | standard | deep
- Why this tier:
`
    );

    const result = await lintArtifact(root, "brainstorm");
    const tier = result.findings.find((f) => f.section === "Approach Tier Classification");
    expect(tier?.found).toBe(false);
    expect(tier?.details ?? "").toMatch(/multiple|placeholder/i);
  });

  it("passes Regression Iron Rule when acknowledgement uses the bold form (design)", async () => {
    const root = await createTempProject("design-iron-rule-bold");
    await writeRuntimeArtifact(
      root,
      "03-design.md",
      `# Design Artifact

## Approach Tier
- Tier: Standard

## Regression Iron Rule
- **Iron rule acknowledged:** yes — every diff that changes existing behavior gets a regression test.
`
    );

    const result = await lintArtifact(root, "design");
    const ironRule = result.findings.find(
      (f) => f.section === "Regression Iron Rule Acknowledgement"
    );
    expect(ironRule?.found).toBe(true);
  });
});

describe("scope linter Failure Modes Registry + Reversibility (CLI utility)", () => {
  it("fails when Failure Modes Registry has the canonical header but no decision marker", async () => {
    const root = await createTempProject("scope-failure-modes-no-decision");
    await writeRuntimeArtifact(
      root,
      "02-scope.md",
      `# Scope Artifact

## Implementation Alternatives
| Option | Summary | Effort | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| A | streaming parser | S | Low | fast | weaker errors | parser combinator |
| B | full AST | M | Med | better errors | more memory | AST visitor |

RECOMMENDATION: A — streaming parser meets perf budget without raising memory ceiling.

## Failure Modes Registry
| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? | Q<n> decision |
|---|---|---|---|---|---|---|
| parse() | malformed input | no | unit | error message | warn |  |

## Reversibility Rating
- Score (1-5): 4
- Justification: refactor lives behind feature flag in \`bin/cli.mjs\`
- Rollback plan reference: revert flag default
`
    );

    const result = await lintArtifact(root, "scope");
    const decision = result.findings.find(
      (f) => f.section === "Failure Modes STOP-per-issue"
    );
    expect(decision?.found).toBe(false);
  });

  it("passes Reversibility Rating with score 1-5 (library extraction)", async () => {
    const root = await createTempProject("scope-reversibility-library");
    await writeRuntimeArtifact(
      root,
      "02-scope.md",
      `# Scope Artifact

## Reversibility Rating
- Score (1-5): 2
- Justification: shared package versioning makes a revert two-step (downgrade + republish)
- Rollback plan reference: pin previous version in workspace
`
    );

    const result = await lintArtifact(root, "scope");
    const reversibility = result.findings.find(
      (f) => f.section === "Reversibility Rating Score"
    );
    expect(reversibility?.found).toBe(true);
  });
});

describe("design linter coverage diagram + regression iron rule", () => {
  it("fails ASCII Coverage Diagram tokens when fewer than 3 markers are present", async () => {
    const root = await createTempProject("design-coverage-tokens-low");
    await writeRuntimeArtifact(
      root,
      "03-design.md",
      `# Design Artifact

## ASCII Coverage Diagram
\`\`\`
entry-point
  └── happy path [★★★]
\`\`\`

## Regression Iron Rule
- Iron rule acknowledged: yes
- Detected behavior changes: parser switches from buffered to streaming mode
- Regression test handoff: T-12

## Calibrated Findings
- [P2] (confidence: 7/10) src/parser.ts:42 — streaming code path lacks malformed-input regression test
`
    );

    const result = await lintArtifact(root, "design");
    const coverage = result.findings.find(
      (f) => f.section === "ASCII Coverage Diagram Tokens"
    );
    expect(coverage?.found).toBe(false);
  });

  it("passes Calibrated Findings when format is followed (infra/migration)", async () => {
    const root = await createTempProject("design-calibrated-findings-infra");
    await writeRuntimeArtifact(
      root,
      "03-design.md",
      `# Design Artifact

## Calibrated Findings
- [P1] (confidence: 9/10) ops/migrate.sh:88 — destructive step runs before backup verification
- [P2] (confidence: 8/10) ops/migrate.sh:104 — partial-failure rollback only covers schema, not data
`
    );

    const result = await lintArtifact(root, "design");
    const calibrated = result.findings.find(
      (f) => f.section === "Calibrated Finding Format"
    );
    expect(calibrated?.found).toBe(true);
  });
});

describe("spec linter universal structural checks", () => {
  it("fails Architecture Modules when code fences leak (library)", async () => {
    const root = await createTempProject("spec-arch-modules-code-leak");
    await writeRuntimeArtifact(
      root,
      "04-spec.md",
      `# Specification Artifact

## Architecture Modules
| Module | Responsibility | Maps to design ref |
|---|---|---|
| parser | turn input bytes into events | DD-1 |

\`\`\`ts
function parse(input: Uint8Array): ParseEvent[] {}
\`\`\`
`
    );

    const result = await lintArtifact(root, "spec");
    const noCode = result.findings.find((f) => f.section === "Architecture Modules No-Code");
    expect(noCode?.found).toBe(false);
  });

  it("passes Behavior Contract with given/when/then form (CLI utility)", async () => {
    const root = await createTempProject("spec-behavior-given-when-then");
    await writeRuntimeArtifact(
      root,
      "04-spec.md",
      `# Specification Artifact

## Behavior Contract
- Given a malformed config file, When the user runs \`cli validate\`, Then exit 2 with a non-empty stderr message.
- Given a valid config file, When the user runs \`cli validate\`, Then exit 0 with stdout containing \`OK\`.
- Given an unknown subcommand, When the user runs \`cli foo\`, Then exit 64 and suggest the closest known subcommand.
`
    );

    const result = await lintArtifact(root, "spec");
    const shape = result.findings.find((f) => f.section === "Behavior Contract Shape");
    expect(shape?.found).toBe(true);
  });
});

describe("plan linter Implementation Units + Execution Handoff", () => {
  it("fails Implementation Unit Shape when required fields are missing (CLI utility)", async () => {
    const root = await createTempProject("plan-unit-missing-fields");
    await writeRuntimeArtifact(
      root,
      "05-plan.md",
      `# Plan Artifact

## Plan Header
- Goal: extract parser into shared package
- Architecture: workspace package + thin CLI shim
- Tech Stack: Node.js, TypeScript, vitest

### Implementation Unit U-1
- Goal: scaffold the package
`
    );

    const result = await lintArtifact(root, "plan");
    const unitShape = result.findings.find((f) => f.section === "Implementation Unit Shape");
    expect(unitShape?.found).toBe(false);
  });

  it("passes Execution Handoff when posture is declared (infra/migration)", async () => {
    const root = await createTempProject("plan-execution-handoff-infra");
    await writeRuntimeArtifact(
      root,
      "05-plan.md",
      `# Plan Artifact

## Execution Handoff
- Posture chosen: Subagent-Driven (recommended)
- Why this posture: 4 independent migration units; isolation prevents cross-contamination of failures
- Subagent recipe (if Subagent-Driven): \`opencode\` -> \`opencode-agent\` -> \`.opencode/agents/migrator.md\`
`
    );

    const result = await lintArtifact(root, "plan");
    const handoff = result.findings.find((f) => f.section === "Execution Handoff Posture");
    expect(handoff?.found).toBe(true);
  });
});

describe("tdd linter watched-RED + iron law", () => {
  it("fails Watched-RED Proof when populated rows lack ISO timestamps (library)", async () => {
    const root = await createTempProject("tdd-watched-red-no-iso");
    await writeRuntimeArtifact(
      root,
      "06-tdd.md",
      `# TDD Artifact

## Watched-RED Proof
| Slice | Test name | Observed at | Failure reason | Source command/log |
|---|---|---|---|---|
| S-1 | parses_unicode_input | yesterday | TypeError: undefined | \`npm test parser\` |
`
    );

    const result = await lintArtifact(root, "tdd");
    const proof = result.findings.find((f) => f.section === "Watched-RED Proof Shape");
    expect(proof?.found).toBe(false);
  });

  it("passes Vertical Slice Cycle when RED/GREEN/REFACTOR are present (CLI utility)", async () => {
    const root = await createTempProject("tdd-vertical-slice");
    await writeRuntimeArtifact(
      root,
      "06-tdd.md",
      `# TDD Artifact

## Vertical Slice Cycle
| Slice | RED ts | GREEN ts | REFACTOR ts |
|---|---|---|---|
| S-1 | 2026-04-28T12:00:00Z | 2026-04-28T12:05:00Z | 2026-04-28T12:08:00Z |
`
    );

    const result = await lintArtifact(root, "tdd");
    const cycle = result.findings.find(
      (f) => f.section === "Vertical Slice Cycle Coverage"
    );
    expect(cycle?.found).toBe(true);
  });
});

describe("review linter request frame + critic dispatch", () => {
  it("fails Review Frame Coverage when fields are missing (infra/migration)", async () => {
    const root = await createTempProject("review-frame-missing");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Frame the Review Request
- Goal: rolling migration with rollback plan
- Approach: blue/green with health-gated cutover
`
    );

    const result = await lintArtifact(root, "review");
    const frame = result.findings.find((f) => f.section === "Review Frame Coverage");
    expect(frame?.found).toBe(false);
  });

  it("passes Receiving Posture when anti-sycophancy is acknowledged (library)", async () => {
    const root = await createTempProject("review-posture-anti-sycophancy");
    await writeRuntimeArtifact(
      root,
      "07-review.md",
      `# Review Artifact

## Receiving Posture
- [x] No performative agreement (forbidden openers acknowledged)
- [x] READ -> UNDERSTAND -> VERIFY -> EVALUATE -> RESPOND -> IMPLEMENT one-at-a-time discipline followed
- [x] Push-back recorded with reasoning when the critic was wrong
- Notes: Pushed back on the suggestion to remove the streaming path; benchmark shows 4x throughput.
`
    );

    const result = await lintArtifact(root, "review");
    const posture = result.findings.find(
      (f) => f.section === "Receiving Posture Anti-Sycophancy"
    );
    expect(posture?.found).toBe(true);
  });
});

describe("ship linter four options + structured PR body", () => {
  it("fails Finalization Options when canonical tokens are incomplete (CLI utility)", async () => {
    const root = await createTempProject("ship-options-incomplete");
    await writeRuntimeArtifact(
      root,
      "08-ship.md",
      `# Ship Artifact

## Finalization Options
1. Merge back to base — MERGE_LOCAL
2. Open PR — OPEN_PR
`
    );

    const result = await lintArtifact(root, "ship");
    const options = result.findings.find(
      (f) => f.section === "Finalization Options Coverage"
    );
    expect(options?.found).toBe(false);
  });

  it("passes Structured PR Body when canonical subsections present (infra/migration)", async () => {
    const root = await createTempProject("ship-structured-pr");
    await writeRuntimeArtifact(
      root,
      "08-ship.md",
      `# Ship Artifact

## Structured PR Body

### ## Summary
- Switch migration tool to blue/green cutover
- Add health gate before traffic flip

### ## Test Plan
- [ ] Run \`bin/migrate --dry-run\` and verify 0 destructive ops
- [ ] Run \`bin/migrate --apply\` against staging and verify rollback works

### ## Commits Included
- abc1234 — Migrate runner refactor
- def5678 — Add health gate
`
    );

    const result = await lintArtifact(root, "ship");
    const prBody = result.findings.find((f) => f.section === "Structured PR Body Shape");
    expect(prBody?.found).toBe(true);
  });

  it("fails Verify Tests Gate when Result line is missing (library)", async () => {
    const root = await createTempProject("ship-verify-tests-missing");
    await writeRuntimeArtifact(
      root,
      "08-ship.md",
      `# Ship Artifact

## Verify Tests Gate
- Discovered test command: \`pnpm test\` (from package.json scripts.test)
- Evidence: see CI run #4242
`
    );

    const result = await lintArtifact(root, "ship");
    const gate = result.findings.find((f) => f.section === "Verify Tests Gate Result");
    expect(gate?.found).toBe(false);
  });
});
