/**
 * v8.113 — refine-mode INLINE (post-ship micro-edit) path.
 *
 * The former `/cc patch <slug> <task>` keyword fork was folded into the
 * unified refine-mode fork (a leading shipped-slug token IS the refine
 * signal; triage decides the ceremony). When triage lands
 * `ceremonyMode: inline` on a refine, the orchestrator runs the
 * micro-edit path: builder-only, one commit `patch(<slug>):`, a
 * `patch-N.md` artifact next to the parent's shipped plan, no new slug.
 *
 * Three tests cover the inline-path deliverables:
 *   - WIRING — refine-mode.md is registered + the start-command Detect
 *     fork + on-demand pointer table + invocation matrix reference it,
 *     and the runbook carries the inline-path skip contract.
 *   - BEHAVIOR — the inline path reuses loadParentContext for slug
 *     validation (the same helper that backs the full refine path).
 *   - SECTION CONTRACT — builder carries the Patch-mode flow envelope,
 *     triage carries the §1.6 trivial-shape downgrade (now refine-mode),
 *     and handoff-gates carries the post-ship refine hint.
 */
import { describe, expect, it } from "vitest";
import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import {
  BUILDER_PROMPT,
  TRIAGE_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { loadParentContext } from "../../src/parent-context.js";

describe("v8.113 — refine-mode inline path wiring", () => {
  it("WIRING — ON_DEMAND_RUNBOOKS registers refine-mode.md with the inline (patch) path contract, the index section surfaces it, and start-command's Detect-hop fork + on-demand pointer table + invocation matrix reference it", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "refine-mode.md");
    expect(runbook).toBeDefined();
    expect(runbook?.id).toBe("refine-mode");
    expect(runbook?.body.length).toBeGreaterThan(2000);
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
    expect(runbook?.body).toContain("loadParentContext");
    expect(runbook?.body).toContain("patchMode: true");
    expect(runbook?.body).toContain("patch(<slug>):");
    expect(runbook?.body).toContain("patch-N.md");

    // The inline branch is keyed off triage's ceremony decision, not a
    // user keyword. The runbook names both ceremony branches.
    expect(runbook?.body).toMatch(/Micro-edit \(patch\) path/u);
    expect(runbook?.body).toContain('triage.ceremonyMode == "inline"');
    expect(runbook?.body).toMatch(
      /NO architect, NO plan-critic, NO qa, NO critic, NO ship-gate/u
    );

    // Index section surfaces refine-mode.md among the other runbooks.
    expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain("refine-mode.md");

    // Start-command's Detect-hop body references the refine-mode runbook
    // + the unified fork section + the invocation-matrix update.
    const startCommand = renderStartCommand();
    expect(startCommand).toMatch(/### Detect — refine-mode fork/u);
    expect(startCommand).toContain("runbooks/refine-mode.md");
    expect(startCommand).toContain("/cc <slug> <task>");
    expect(startCommand).toMatch(
      /Start with \/cc <task>, \/cc <slug> <task> \(refine a shipped slug\), or \/cc research <topic>/u
    );
    // Detect-hop on-demand pointer table carries the refine-mode trigger
    // row (first token is a shipped slug) alongside the other pointers.
    expect(startCommand).toMatch(
      /\| `\/cc <task>` first token is a shipped slug \(refine a parent; triage picks ceremony\) \| `refine-mode\.md` \|/u
    );

    // The old `extend`/`patch` keyword forks are gone — no stale forks.
    expect(startCommand).not.toMatch(/### Detect — patch-mode fork/u);
    expect(startCommand).not.toMatch(/### Detect — extend-mode fork/u);
  });
});

describe("v8.113 — refine-mode inline path behavior (loadParentContext reuse)", () => {
  it("BEHAVIOR — the inline path REUSES loadParentContext for slug validation; the four error reasons (in-flight / cancelled / missing / corrupted) apply verbatim; an invalid slug returns the discriminated-union shape the runbook documents", async () => {
    // loadParentContext is the SINGLE helper that backs both refine
    // ceremony branches; the runbook documents the reuse (no new
    // validator). Smoke-level tripwire on the missing-slug path.
    const result = await loadParentContext(
      "/tmp/does-not-exist-cclaw-v8113",
      "20260101-no-such-slug"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["in-flight", "cancelled", "missing", "corrupted"]).toContain(result.reason);
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    }

    // The refine-mode runbook documents all four error reasons.
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "refine-mode.md");
    expect(runbook).toBeDefined();
    for (const reason of ["in-flight", "cancelled", "missing", "corrupted"]) {
      expect(runbook?.body).toContain(reason);
    }
    expect(runbook?.body).toMatch(/Ship it first, then refine it/u);

    // Empty slug returns the canonical missing-slug error, now pointing
    // at the refine invocation hint (the keyword was dropped).
    const empty = await loadParentContext("/tmp/whatever", "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe("missing");
      expect(empty.message).toMatch(/refine|slug/iu);
      expect(empty.message).not.toMatch(/\/cc extend|\/cc patch/u);
    }
  });
});

describe("v8.113 — refine-mode inline path section contract (builder envelope + triage downgrade + ship hint)", () => {
  it("SECTION CONTRACT — builder carries the Patch-mode flow section with patchMode envelope + DO-NOT-DO carve-outs + patch(slug) commit prefix; triage carries §1.6 trivial-shape downgrade in refine-mode AND the anti-rationalization table allows tiny-tweak/minor/small-adjustment in refine-mode only; handoff-gates carries the post-ship refine hint", () => {
    // Builder envelope — the internal patch-mode flow (the patchMode flag
    // is preserved; only its docs pointer changed to refine-mode.md).
    expect(BUILDER_PROMPT).toMatch(/## Patch-mode flow \(when envelope carries/u);
    expect(BUILDER_PROMPT).toContain("patchMode: true");
    expect(BUILDER_PROMPT).toMatch(/patch\(<slug>\):/u);
    expect(BUILDER_PROMPT).toMatch(/patch-N\.md|patch-<N>\.md/u);
    expect(BUILDER_PROMPT).toMatch(/No slice topology/iu);
    expect(BUILDER_PROMPT).toMatch(/No per-slice review loop/iu);
    expect(BUILDER_PROMPT).toMatch(/No `verify\(AC-N\): passing` discipline/u);
    expect(BUILDER_PROMPT).toMatch(/No flow-state assumption row flipping/iu);
    expect(BUILDER_PROMPT).toMatch(/Stage: build \(patch-mode\)/u);
    expect(BUILDER_PROMPT).toMatch(/One commit only/u);
    // Builder's patch-mode docs now point at the unified refine runbook.
    expect(BUILDER_PROMPT).toContain("refine-mode.md");

    // Triage §1.6 trivial-shape downgrade — now refine-mode, and fires
    // when the parent was soft OR strict (broadened from strict-only).
    expect(TRIAGE_PROMPT).toMatch(/§1\.6 Trivial-shape downgrade/u);
    expect(TRIAGE_PROMPT).toMatch(/refine-trivial-shape/u);
    expect(TRIAGE_PROMPT).not.toMatch(/extend-mode-trivial-shape/u);
    // The four signals of the AND gate are documented.
    expect(TRIAGE_PROMPT).toMatch(/≤2 file references in the task text/u);
    expect(TRIAGE_PROMPT).toMatch(/No schema words present/u);
    expect(TRIAGE_PROMPT).toMatch(/No AC additions implied/u);
    expect(TRIAGE_PROMPT).toMatch(/Single concrete verb/u);
    // Downgrade now keys off a soft-or-strict parent, not strict-only.
    expect(TRIAGE_PROMPT).toMatch(/the parent's `ceremony_mode` was `soft` or `strict`/u);
    // Asymmetry between refine-mode (downgrade allowed) and fresh-mode.
    expect(TRIAGE_PROMPT).toMatch(/applies \*\*ONLY in refine-mode\*\*/u);

    // Anti-rationalization table: tiny tweak / minor / small adjustment
    // is an ALLOWED downgrade signal in refine-mode only.
    expect(TRIAGE_PROMPT).toMatch(/tiny tweak/u);
    expect(TRIAGE_PROMPT).toContain("refine-mode (`parentContext` is set)");
    expect(TRIAGE_PROMPT).toContain("fresh-mode (no `parentContext`)");
    expect(TRIAGE_PROMPT).toMatch(/four-AND gate fires/u);

    // handoff-gates ship section carries the post-ship refine hint
    // pointing at /cc <slug> <description> as the fast follow-up route.
    const handoffGates = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "handoff-gates.md");
    expect(handoffGates).toBeDefined();
    expect(handoffGates?.body).toMatch(/### Post-ship micro-edit hint/u);
    expect(handoffGates?.body).toContain("/cc <slug> <description>");
    expect(handoffGates?.body).toMatch(/triage picks the ceremony/u);
    expect(handoffGates?.body).not.toContain("/cc patch <slug>");
    // The hint is non-coercive — emitted on every clean ship.
    expect(handoffGates?.body).toMatch(/non-coercive|does NOT block/iu);
  });
});
