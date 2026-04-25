import { describe, expect, it } from "vitest";
import claudeSchema from "../../src/hook-schemas/claude-hooks.v1.json" with { type: "json" };
import cursorSchema from "../../src/hook-schemas/cursor-hooks.v1.json" with { type: "json" };
import codexSchema from "../../src/hook-schemas/codex-hooks.v1.json" with { type: "json" };
import {
  HOOK_MANIFEST,
  HOOK_MANIFEST_HARNESSES,
  HOOK_HANDLERS,
  groupBindingsByEvent,
  requiredEventsFor,
  semanticEventCoverage
} from "../../src/content/hook-manifest.js";
import {
  claudeHooksJsonWithObservation,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation
} from "../../src/content/observe.js";

const SCHEMA_BY_HARNESS = {
  claude: claudeSchema as { requiredEvents: string[] },
  cursor: cursorSchema as { requiredEvents: string[] },
  codex: codexSchema as { requiredEvents: string[] }
};

describe("hook manifest", () => {
  it("declares every handler used in the generators", () => {
    const declared = new Set(HOOK_MANIFEST.map((spec) => spec.handler));
    for (const handler of HOOK_HANDLERS) {
      expect(declared.has(handler), `manifest missing handler ${handler}`).toBe(true);
    }
  });

  it("covers every harness listed in HOOK_MANIFEST_HARNESSES", () => {
    for (const harness of HOOK_MANIFEST_HARNESSES) {
      const seen = HOOK_MANIFEST.some((spec) => !!spec.bindings[harness]?.length);
      expect(seen, `no bindings for ${harness}`).toBe(true);
    }
  });

  it("keeps requiredEvents in hook-schemas/*.json aligned with the manifest", () => {
    for (const harness of HOOK_MANIFEST_HARNESSES) {
      const manifestEvents = new Set(requiredEventsFor(harness));
      const schemaEvents = new Set(SCHEMA_BY_HARNESS[harness].requiredEvents);
      expect(
        [...manifestEvents].sort(),
        `manifest → schema drift for ${harness}`
      ).toEqual([...schemaEvents].sort());
    }
  });

  it("sorts entries within an event group by (priority, declaration)", () => {
    const cursorSessionCompact = groupBindingsByEvent("cursor").find(
      (group) => group.event === "sessionCompact"
    );
    expect(cursorSessionCompact).toBeDefined();
    expect(cursorSessionCompact?.entries.map((entry) => entry.handler)).toEqual([
      "pre-compact",
      "session-start"
    ]);
  });

  it("emits valid generator output that references only declared handlers", () => {
    const payloads = [
      claudeHooksJsonWithObservation(),
      cursorHooksJsonWithObservation(),
      codexHooksJsonWithObservation()
    ];
    const handlerSet = new Set<string>(HOOK_HANDLERS);
    for (const payload of payloads) {
      const handlers = [...payload.matchAll(/run-hook\.(?:mjs|cmd) ([a-z-]+)/g)].map(
        (match) => match[1] as string
      );
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        expect(handlerSet.has(handler), `undeclared handler ${handler}`).toBe(true);
      }
    }
  });

  it("derives the semantic coverage table so docs stay in sync with the manifest", () => {
    for (const harness of HOOK_MANIFEST_HARNESSES) {
      const coverage = semanticEventCoverage(harness);
      expect(coverage.session_rehydrate).toBeTruthy();
      expect(coverage.pre_tool_prompt_guard).toBeTruthy();
      expect(coverage.stop_handoff).toBeTruthy();
    }
  });
});
