import { describe, expect, it } from "vitest";
import {
  CANCELLED_DIR_REL_PATH,
  CCLAW_VERSION,
  FLOWS_ROOT,
  FLOW_STATE_REL_PATH,
  HOOKS_REL_PATH,
  KNOWLEDGE_LOG_REL_PATH,
  LIB_ROOT,
  RUNTIME_ROOT,
  SHIPPED_DIR_REL_PATH,
  STATE_REL_PATH
} from "../../src/constants.js";

describe("constants", () => {
  it("locks the 8.1.1 release name", () => {
    expect(CCLAW_VERSION).toBe("8.1.1");
  });

  it("uses .cclaw as runtime root with grouped layout", () => {
    expect(RUNTIME_ROOT).toBe(".cclaw");
    expect(STATE_REL_PATH).toBe(".cclaw/state");
    expect(HOOKS_REL_PATH).toBe(".cclaw/hooks");
    expect(FLOWS_ROOT).toBe(".cclaw/flows");
    expect(LIB_ROOT).toBe(".cclaw/lib");
    expect(FLOW_STATE_REL_PATH).toBe(".cclaw/state/flow-state.json");
    expect(KNOWLEDGE_LOG_REL_PATH).toBe(".cclaw/knowledge.jsonl");
    expect(SHIPPED_DIR_REL_PATH).toBe(".cclaw/flows/shipped");
    expect(CANCELLED_DIR_REL_PATH).toBe(".cclaw/flows/cancelled");
  });
});
