import { describe, expect, it } from "vitest";
import {
  shouldDemoteArtifactValidationByTrack,
  mandatoryAgentsFor,
  mandatoryDelegationsForStage
} from "../../src/content/stage-schema.js";
import {
  validateInteractionEdgeCaseMatrix,
  validateArchitectureDiagram
} from "../../src/artifact-linter/shared.js";
import { FLOW_STAGES } from "../../src/types.js";

/**
 * — track-aware ARTIFACT validation escape.
 *
 * Mirrors Phase B's `mandatoryAgentsFor` predicate
 * (`track === "quick"` OR `taskClass === "software-bugfix"`) but
 * applies it to ARTIFACT VALIDATION rules instead of delegation
 * gates. The user's quick-tier 3-file landing page test reported
 * ~10 sequential ceremony-only failures on the design stage —
 * this suite proves the predicate triggers for the small-fix
 * lanes and stays silent on standard tracks.
 */

describe("— shouldDemoteArtifactValidationByTrack predicate", () => {
  it("demotes for the quick track regardless of taskClass", () => {
    expect(shouldDemoteArtifactValidationByTrack("quick")).toBe(true);
    expect(shouldDemoteArtifactValidationByTrack("quick", null)).toBe(true);
    expect(shouldDemoteArtifactValidationByTrack("quick", "software-standard")).toBe(true);
    expect(shouldDemoteArtifactValidationByTrack("quick", "software-bugfix")).toBe(true);
    expect(shouldDemoteArtifactValidationByTrack("quick", "software-trivial")).toBe(true);
  });

  it("demotes for software-bugfix on every track", () => {
    expect(shouldDemoteArtifactValidationByTrack("standard", "software-bugfix")).toBe(true);
    expect(shouldDemoteArtifactValidationByTrack("medium", "software-bugfix")).toBe(true);
  });

  it("does NOT demote for standard/medium tracks with no task-class hint", () => {
    expect(shouldDemoteArtifactValidationByTrack("standard")).toBe(false);
    expect(shouldDemoteArtifactValidationByTrack("medium")).toBe(false);
    expect(shouldDemoteArtifactValidationByTrack("standard", null)).toBe(false);
    expect(shouldDemoteArtifactValidationByTrack("medium", "software-standard")).toBe(false);
    expect(shouldDemoteArtifactValidationByTrack("standard", "software-trivial")).toBe(false);
  });

  it("matches the mandatory-agents predicate (same trigger logic)", () => {
    // The two predicates intentionally share the same trigger so we
    // never end up in a state where the artifact escape fires but
    // the mandatory-agents drop does not (or vice versa).
    for (const stage of FLOW_STAGES) {
      const registered = mandatoryDelegationsForStage(stage);
      if (registered.length === 0) continue;
      // Every track/taskClass combo where the agents drop kicks in
      // must also flip the artifact predicate to true.
      const combos = [
        { track: "quick" as const, taskClass: null },
        { track: "quick" as const, taskClass: "software-bugfix" as const },
        { track: "standard" as const, taskClass: "software-bugfix" as const }
      ];
      for (const combo of combos) {
        const agents = mandatoryAgentsFor(stage, combo.track, combo.taskClass);
        const artifactDemote = shouldDemoteArtifactValidationByTrack(combo.track, combo.taskClass);
        expect(agents).toEqual([]);
        expect(artifactDemote).toBe(true);
      }
    }
  });
});

describe("— Interaction Edge Case matrix lite-tier relaxations", () => {
  const standardEdgeMatrixWithMissingNetworkRows = [
    "| Edge case | Handled? | Design response | Deferred item |",
    "|---|---|---|---|",
    "| double-click | yes | request idempotency dedupes submits | None |"
  ].join("\n");

  it("standard track still requires network-dependent rows", () => {
    const result = validateInteractionEdgeCaseMatrix(standardEdgeMatrixWithMissingNetworkRows, {
      sections: null,
      liteTier: false
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/missing required row/iu);
    expect(result.details).toMatch(/nav-away-mid-request/u);
  });

  it("lite-tier with no Architecture Diagram + no Failure Mode demotes network rows to advisory", () => {
    const result = validateInteractionEdgeCaseMatrix(standardEdgeMatrixWithMissingNetworkRows, {
      sections: new Map(),
      liteTier: true
    });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/network-dependent row/iu);
    // double-click row remains mandatory; matrix passes because it's present.
    expect(result.details).not.toMatch(/double-click/iu);
  });

  it("lite-tier with external-dependency keywords in the Architecture Diagram still enforces network rows", () => {
    const sections = new Map<string, string>();
    sections.set("Architecture Diagram", "Browser -->|sync: HTTP API call| Service\nService -.->|async: queue write| Database");
    const result = validateInteractionEdgeCaseMatrix(standardEdgeMatrixWithMissingNetworkRows, {
      sections,
      liteTier: true
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/missing required row/iu);
  });

  it("lite-tier with rows in Failure Mode Table still enforces network rows", () => {
    const sections = new Map<string, string>();
    sections.set("Failure Mode Table", [
      "| Method | Exception | Rescue | UserSees |",
      "|---|---|---|---|",
      "| Persist | timeout | RESCUED=Y TEST=Y (fallback) | stale ok |"
    ].join("\n"));
    const result = validateInteractionEdgeCaseMatrix(standardEdgeMatrixWithMissingNetworkRows, {
      sections,
      liteTier: true
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/missing required row/iu);
  });

  it("accepts `N/A — reason` in Handled? cell (no D-XX requirement)", () => {
    const matrix = [
      "| Edge case | Handled? | Design response | Deferred item |",
      "|---|---|---|---|",
      "| double-click | yes | dedupe via idempotency key | None |",
      "| nav-away-mid-request | N/A — static page has no requests | not applicable | None |",
      "| 10K-result dataset | N/A — only renders 3 hard-coded sections | not applicable | None |",
      "| background-job abandonment | N/A — no background jobs in scope | not applicable | None |",
      "| zombie connection | N/A — page has no persistent connections | not applicable | None |"
    ].join("\n");
    const result = validateInteractionEdgeCaseMatrix(matrix, { sections: null, liteTier: false });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/contains all required rows/iu);
  });

  it("accepts `N/A` with reason on em-dash, en-dash, hyphen, and colon separators", () => {
    const variants = [
      "N/A — explicit em-dash reason",
      "N/A – en-dash reason variant",
      "N/A - hyphen reason variant",
      "N/A: colon reason variant"
    ];
    for (const handled of variants) {
      const matrix = [
        "| Edge case | Handled? | Design response | Deferred item |",
        "|---|---|---|---|",
        "| double-click | yes | dedupe | None |",
        `| nav-away-mid-request | ${handled} | not applicable | None |`,
        "| 10K-result dataset | yes | paginate | None |",
        "| background-job abandonment | yes | watchdog sweep | None |",
        "| zombie connection | yes | heartbeat reset | None |"
      ].join("\n");
      const result = validateInteractionEdgeCaseMatrix(matrix, { sections: null, liteTier: false });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects bare `N/A` without any reason in Handled? OR Design response", () => {
    const matrix = [
      "| Edge case | Handled? | Design response | Deferred item |",
      "|---|---|---|---|",
      "| double-click | yes | dedupe | None |",
      "| nav-away-mid-request | N/A | -- | None |",
      "| 10K-result dataset | yes | paginate | None |",
      "| background-job abandonment | yes | watchdog sweep | None |",
      "| zombie connection | yes | heartbeat reset | None |"
    ].join("\n");
    const result = validateInteractionEdgeCaseMatrix(matrix, { sections: null, liteTier: false });
    // `N/A` + non-empty Design response counts as a reason; the row passes.
    expect(result.ok).toBe(true);
  });

  it("error message mentions the `N/A — <reason>` escape when Handled? is unparseable", () => {
    const matrix = [
      "| Edge case | Handled? | Design response | Deferred item |",
      "|---|---|---|---|",
      "| double-click | yes | dedupe | None |",
      "| nav-away-mid-request | maybe | undecided | None |",
      "| 10K-result dataset | yes | paginate | None |",
      "| background-job abandonment | yes | watchdog | None |",
      "| zombie connection | yes | heartbeat | None |"
    ].join("\n");
    const result = validateInteractionEdgeCaseMatrix(matrix, { sections: null, liteTier: false });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/N\/A — <reason>/u);
  });

  it("missing matrix entirely passes for lite-tier no-network designs", () => {
    const result = validateInteractionEdgeCaseMatrix("", {
      sections: new Map(),
      liteTier: true
    });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/advisory for lite-tier no-network/iu);
  });
});

describe("— Architecture Diagram failure-edge conditional enforcement", () => {
  const minimalDiagram = "```mermaid\nflowchart LR\n  Hero -->|sync: render| Section\n  Section -.->|async: log analytics| Telemetry\n```";

  it("skips failure-edge requirement when no Failure Mode rows AND no external-dep keywords in diagram", () => {
    const result = validateArchitectureDiagram(minimalDiagram, { sections: new Map() });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/failure-edge enforcement skipped/iu);
  });

  it("enforces failure-edge requirement when Failure Mode Table has rows", () => {
    const sections = new Map<string, string>();
    sections.set("Failure Mode Table", [
      "| Method | Exception | Rescue | UserSees |",
      "|---|---|---|---|",
      "| Persist | timeout | RESCUED=Y TEST=Y (fallback) | stale ok |"
    ].join("\n"));
    const result = validateArchitectureDiagram(minimalDiagram, { sections });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/failure-edge arrow/iu);
  });

  it("enforces failure-edge requirement when diagram body mentions external-dep keywords", () => {
    const externalDiagram = "```mermaid\nflowchart LR\n  WebApp -->|sync: HTTP API call| BackendApi\n  BackendApi -.->|async: cache write| RedisCache\n```";
    const result = validateArchitectureDiagram(externalDiagram, { sections: new Map() });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/failure-edge arrow/iu);
  });

  it("error message lists ALL accepted sync/async patterns when distinction missing", () => {
    const allSync = "```mermaid\nflowchart LR\n  A -->|render| B\n  B -->|persist| C\n```";
    const result = validateArchitectureDiagram(allSync, { sections: new Map() });
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/sync vs async/iu);
    // Each accepted-pattern bucket the user's agent kept guessing about.
    expect(result.details).toMatch(/Solid arrows/u);
    expect(result.details).toMatch(/Dotted\/async arrows/u);
    expect(result.details).toMatch(/Text labels/u);
    expect(result.details).toMatch(/Bracket labels/u);
    expect(result.details).toMatch(/Cell-prefix labels/u);
  });

  it("accepts mixed sync/async representations: solid+dotted, sync:/async: prefixes, [sync]/[async] labels", () => {
    const variants = [
      // solid + dotted classic
      "```mermaid\nflowchart LR\n  A -->|render| B\n  B -.->|enqueue| C\n```",
      // sync:/async: prefixes inside cell labels
      "```mermaid\nflowchart LR\n  A -->|sync: render| B\n  B -->|async: enqueue| C\n```",
      // [sync]/[async] bracket labels
      "```mermaid\nflowchart LR\n  A -->|[sync] render| B\n  B -->|[async] enqueue| C\n```"
    ];
    for (const diagram of variants) {
      const result = validateArchitectureDiagram(diagram, { sections: new Map() });
      expect(result.ok).toBe(true);
    }
  });
});
