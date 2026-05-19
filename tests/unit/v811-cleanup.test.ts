import { describe, expect, it } from "vitest";
import { renderCancelCommand } from "../../src/content/cancel-command.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";

const startBody = renderStartCommand();
const cancelBody = renderCancelCommand();

/**
 * v8.11 — cleanup anchors (slimmed in v8.54).
 *
 * Cancel-vs-recovery contract + slug naming format. Detailed two-turn
 * pacing tests live in v847; cancel mechanics live in `cancel.test.ts`.
 *
 * v8.103 — the dedicated `### Slug naming (mandatory format)` heading was
 * folded into the `## Triage` paragraph as part of the orchestrator token
 * diet; the assertion now checks the slug format + collision fallback prose
 * rather than the heading text.
 *
 * v8.106 — the `flow-resume` skill was retired (reference-only doc whose
 * actual logic is the start-command Detect matrix + the canonical
 * `runbooks/detect-matrix.md`). The Cancel-arm assertion now runs against
 * the Detect matrix runbook body instead of the retired skill body.
 */

describe("v8.11 — cancel-vs-recovery contract", () => {
  it("detect-matrix runbook (v8.106 successor of flow-resume skill) does NOT offer Cancel as a picker arm", () => {
    const detectMatrix = ON_DEMAND_RUNBOOKS.find((r) => r.id === "detect-matrix");
    expect(detectMatrix, "detect-matrix runbook must exist").toBeDefined();
    expect(detectMatrix!.body).not.toMatch(/\[c\]\s+Cancel/);
  });

  it("/cc-cancel is never a clickable option from start-command (explicit-only nuke)", () => {
    expect(startBody).toMatch(/\\?`?\/cc-cancel\\?`?\s+is\s+never\s+a\s+clickable\s+option/i);
  });

  it("cancel-command prose: stops the flow without finishing, never deletes artifacts", () => {
    expect(cancelBody).toMatch(/Stop the current flow without finishing it/);
    expect(cancelBody).toMatch(/never deletes artifacts/);
  });
});

describe("v8.11 — slug naming format (YYYYMMDD-<semantic-kebab>)", () => {
  it("start-command spells out the mandatory date-prefix slug format + collision fallback (v8.103 — heading folded into the Triage paragraph)", () => {
    expect(startBody).toMatch(/\\?`?YYYYMMDD-<semantic-kebab>\\?`?/);
    expect(startBody).toMatch(/append(ing)?\s+\\?`?-2\\?`?,\s*\\?`?-3\\?`?/);
  });
});
