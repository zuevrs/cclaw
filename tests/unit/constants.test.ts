import { describe, expect, it } from "vitest";
import { CCLAW_VERSION, RUNTIME_ROOT, FLOW_STATE_REL_PATH, KNOWLEDGE_LOG_REL_PATH, SHIPPED_DIR_REL_PATH } from "../../src/constants.js";

describe("constants", () => {
  it("locks the v8.0.0 release name", () => {
    expect(CCLAW_VERSION).toBe("8.0.0");
  });

  it("uses .cclaw as runtime root", () => {
    expect(RUNTIME_ROOT).toBe(".cclaw");
    expect(FLOW_STATE_REL_PATH).toBe(".cclaw/state/flow-state.json");
    expect(KNOWLEDGE_LOG_REL_PATH).toBe(".cclaw/knowledge.jsonl");
    expect(SHIPPED_DIR_REL_PATH).toBe(".cclaw/shipped");
  });
});
