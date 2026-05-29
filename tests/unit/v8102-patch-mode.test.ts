/**
 * v8.102 — `/cc patch <slug> <task>` post-ship micro-edit mode.
 *
 * Slimmed to one WIRING + one BEHAVIOR + one SECTION CONTRACT test
 * (the v8.99 test slim-down A2 pattern). The three tests cover the
 * five spec deliverables:
 *
 *   - CLI parses `/cc patch <slug> <task>` — the orchestrator's Detect
 *     hop section in start-command.ts carries the parsing prose;
 *     loadParentContext (REUSED from v8.59) handles slug validation.
 *   - Orchestrator routes patch mode through the new runbook —
 *     ON_DEMAND_RUNBOOKS registers `patch-mode.md`; start-command body
 *     references the runbook from its Detect-hop fork.
 *   - Builder accepts `patchMode: true` flag — BUILDER_PROMPT carries
 *     the "Patch-mode flow (v8.102…)" section with the dispatch envelope
 *     shape, the "What you DO NOT do" carve-outs, and the
 *     `patch(<slug>):` commit prefix discipline.
 *   - Triage extend-mode allows trivial-shape downgrade — TRIAGE_PROMPT
 *     carries the §1.6 trivial-shape downgrade subsection with the
 *     four-AND gate (≤2 files, no schema words, no AC additions, single
 *     concrete verb) AND the anti-rationalization table now allows
 *     "tiny tweak" / "minor" / "small adjustment" as a valid downgrade
 *     signal IN EXTEND-MODE only (not fresh-mode).
 *   - Ship hint includes `/cc patch` reference — HANDOFF_GATES carries
 *     the "Post-ship micro-edit hint (v8.102)" section pointing at the
 *     patch-mode fork after every clean ship.
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

describe("v8.102 — patch-mode wiring", () => {
  it("WIRING — ON_DEMAND_RUNBOOKS registers patch-mode.md with non-trivial body + canonical heading, the index section surfaces it, and start-command's Detect-hop invocation matrix + on-demand pointer table reference it", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "patch-mode.md");
    expect(runbook).toBeDefined();
    expect(runbook?.id).toBe("patch-mode");
    expect(runbook?.body.length).toBeGreaterThan(2000);
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
    expect(runbook?.body).toContain("loadParentContext");
    expect(runbook?.body).toContain("patchMode: true");
    expect(runbook?.body).toContain("patch(<slug>):");
    expect(runbook?.body).toContain("patch-N.md");

    // Index section surfaces patch-mode.md among the other runbooks.
    expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain("patch-mode.md");

    // Start-command's Detect-hop body references the patch-mode runbook
    // + the patch-mode fork section + the invocation-matrix update.
    const startCommand = renderStartCommand();
    expect(startCommand).toMatch(/### Detect — patch-mode fork/u);
    expect(startCommand).toContain("runbooks/patch-mode.md");
    expect(startCommand).toContain("/cc patch <slug> <task>");
    expect(startCommand).toMatch(
      /Start with \/cc <task>, \/cc research <topic>, \/cc extend <slug> <task>, or \/cc patch <slug> <task>/u
    );
    // Detect-hop on-demand pointer table carries the patch-mode trigger
    // row alongside the other runbook pointers.
    expect(startCommand).toMatch(
      /\| `\/cc` argument starts with `patch ` \(post-ship micro-edit fork\) \| `patch-mode\.md` \|/u
    );
    // The patch-mode fork dispatches builder directly (no triage / no
    // architect / no plan-critic (all rubrics — generic / design / devex)
    // / no qa / no critic / no ship-gate) per the runbook's contract.
    // start-command.ts carries the concise dispatch summary; the runbook
    // body documents each skip with per-specialist bullets.
    expect(startCommand).toMatch(
      /skip triage \/ architect \/ plan-critic \(all rubrics — generic \/ design \/ devex\) \/ qa \/ critic \/ ship-gate/iu
    );
    // Runbook body carries the per-specialist skip bullets.
    expect(runbook?.body).toMatch(/Skip the triage dispatch entirely/u);
    expect(runbook?.body).toMatch(/Skip the architect dispatch entirely/u);
    expect(runbook?.body).toMatch(
      /Skip plan-critic \(every rubric mode — generic \/ design \/ devex\) \/ qa \/ critic/u
    );
    expect(runbook?.body).toMatch(/Skip the ship-gate structured ask/u);
  });
});

describe("v8.102 — patch-mode behavior (loadParentContext reuse + envelope parser shape)", () => {
  it("BEHAVIOR — patch-mode REUSES loadParentContext (the v8.59 helper) for slug validation; the same four error reasons (in-flight / cancelled / missing / corrupted) apply verbatim; an invalid slug returns the same discriminated-union shape patch-mode docs", async () => {
    // loadParentContext is the SAME helper that backs /cc extend; the
    // patch-mode runbook explicitly notes the reuse (no new validator).
    // We exercise the missing-slug path here as a smoke-level integration
    // tripwire — patch-mode's contract is that slug validation goes
    // through this helper, not a re-implementation. (The full per-reason
    // matrix is tested in v8.59-continuation.test.ts; we re-assert here
    // only that the shape patch-mode docs reference is the actual API.)
    const result = await loadParentContext("/tmp/does-not-exist-cclaw-v8102", "20260101-no-such-slug");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The four reasons patch-mode reuses verbatim from extend-mode.
      expect(["in-flight", "cancelled", "missing", "corrupted"]).toContain(result.reason);
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    }

    // Patch-mode runbook documents all four error reasons with the
    // patch-mode-specific message templates (the templates substitute
    // "/cc patch" for "/cc extend" in the prose).
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "patch-mode.md");
    expect(runbook).toBeDefined();
    for (const reason of ["in-flight", "cancelled", "missing", "corrupted"]) {
      expect(runbook?.body).toContain(reason);
    }
    expect(runbook?.body).toMatch(/Ship it first, then run \/cc patch/u);
    expect(runbook?.body).toMatch(/Cannot use as parent for patch-mode/u);

    // Empty slug returns the canonical missing-slug error message that
    // points at the patch-mode invocation hint OR the extend-mode hint
    // (loadParentContext is shared; the message template is from v8.59).
    const empty = await loadParentContext("/tmp/whatever", "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe("missing");
      // The shared helper's empty-slug message references extend-mode by
      // name (v8.59 contract); patch-mode reuses the helper as-is and
      // the orchestrator's Detect-hop prose surfaces the patch-specific
      // hint when the fork was patch-mode. We only assert the shared
      // helper still works.
      expect(empty.message).toMatch(/extend|patch|slug/iu);
    }
  });
});

describe("v8.102 — patch-mode section contract (builder envelope + triage downgrade + ship hint)", () => {
  it("SECTION CONTRACT — builder carries the Patch-mode flow section with patchMode envelope + DO-NOT-DO carve-outs + patch(slug) commit prefix; triage carries §1.6 trivial-shape downgrade in extend-mode AND the anti-rationalization table allows tiny-tweak/minor/small-adjustment in extend-mode only; HANDOFF_GATES ship section carries the /cc patch post-ship hint", () => {
    // Builder envelope extension — patch-mode flow section + the
    // patchMode: true flag + the carve-outs (no slice topology, no
    // per-slice review, no verify(AC-N) discipline, no flow-state
    // assumption row flipping) + the patch(<slug>) commit prefix.
    expect(BUILDER_PROMPT).toMatch(/## Patch-mode flow \(when envelope carries/u);
    expect(BUILDER_PROMPT).toContain("patchMode: true");
    expect(BUILDER_PROMPT).toMatch(/patch\(<slug>\):/u);
    expect(BUILDER_PROMPT).toMatch(/patch-N\.md|patch-<N>\.md/u);
    expect(BUILDER_PROMPT).toMatch(/No slice topology/iu);
    expect(BUILDER_PROMPT).toMatch(/No per-slice review loop/iu);
    expect(BUILDER_PROMPT).toMatch(/No `verify\(AC-N\): passing` discipline/u);
    expect(BUILDER_PROMPT).toMatch(/No flow-state assumption row flipping/iu);
    // Builder's slim summary in patch-mode names the patch artifact path
    // verbatim (orchestrator parses it for the user-facing echo).
    expect(BUILDER_PROMPT).toMatch(/Stage: build \(patch-mode\)/u);
    // One commit only is the hard rule that distinguishes patch-mode
    // from extend-mode (extend-mode walks the full slice chain).
    expect(BUILDER_PROMPT).toMatch(/One commit only/u);

    // Triage §1.6 trivial-shape downgrade — only fires in extend-mode
    // (parentContext is set) AND parent was strict AND the four-AND
    // trivial-shape gate fires.
    expect(TRIAGE_PROMPT).toMatch(/§1\.6 Trivial-shape downgrade/u);
    expect(TRIAGE_PROMPT).toMatch(/extend-mode-trivial-shape/u);
    // All four signals of the AND gate are documented.
    expect(TRIAGE_PROMPT).toMatch(/≤2 file references in the task text/u);
    expect(TRIAGE_PROMPT).toMatch(/No schema words present/u);
    expect(TRIAGE_PROMPT).toMatch(/No AC additions implied/u);
    expect(TRIAGE_PROMPT).toMatch(/Single concrete verb/u);
    // Asymmetry between extend-mode (downgrade allowed) and fresh-mode
    // (downgrade NOT allowed) is explicitly named.
    expect(TRIAGE_PROMPT).toMatch(/applies \*\*ONLY in extend-mode\*\*/u);

    // Anti-rationalization table updated: tiny tweak / minor / small
    // adjustment is an ALLOWED downgrade signal in extend-mode only.
    expect(TRIAGE_PROMPT).toMatch(/tiny tweak/u);
    expect(TRIAGE_PROMPT).toContain("extend-mode (`parentContext` is set)");
    expect(TRIAGE_PROMPT).toContain("fresh-mode (no `parentContext`)");
    // The four-AND gate is referenced from the anti-rat row.
    expect(TRIAGE_PROMPT).toMatch(/four-AND gate fires/u);

    // HANDOFF_GATES ship section carries the v8.102 post-ship hint
    // pointing at /cc patch as the fast follow-up route.
    const handoffGates = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "handoff-gates.md");
    expect(handoffGates).toBeDefined();
    expect(handoffGates?.body).toMatch(/### Post-ship micro-edit hint/u);
    expect(handoffGates?.body).toContain("/cc patch <slug>");
    expect(handoffGates?.body).toMatch(/fast follow-up without full ceremony/u);
    // The hint is non-coercive — emitted on every clean ship, not a
    // structured ask.
    expect(handoffGates?.body).toMatch(/non-coercive|does NOT block/iu);
  });
});
