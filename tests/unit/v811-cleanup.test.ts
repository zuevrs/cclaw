import { describe, expect, it } from "vitest";
import { renderCancelCommand } from "../../src/content/cancel-command.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

const startBody = renderStartCommand();
const cancelBody = renderCancelCommand();

const skillBody = (id: string): string => {
  const found = AUTO_TRIGGER_SKILLS.find((skill) => skill.id === id);
  if (!found) throw new Error(`skill ${id} not found`);
  return found.body;
};

/**
 * v8.11 — cleanup anchors (slimmed in v8.54).
 *
 * Cancel-vs-recovery contract + slug naming format. Detailed two-turn
 * pacing tests live in v847; cancel mechanics live in `cancel.test.ts`.
 */

describe("v8.11 — cancel-vs-recovery contract", () => {
  it("flow-resume picker does NOT offer Cancel as an arm", () => {
    const flowResume = skillBody("flow-resume");
    expect(flowResume).not.toMatch(/\[c\]\s+Cancel/);
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
  it("start-command spells out the mandatory date-prefix slug format + collision fallback", () => {
    expect(startBody).toMatch(/Slug naming \(mandatory format\)/);
    expect(startBody).toMatch(/\\?`?YYYYMMDD-<semantic-kebab>\\?`?/);
    expect(startBody).toMatch(/append\s+\\?`?-2\\?`?,\s*\\?`?-3\\?`?/);
  });
});
