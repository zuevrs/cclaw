import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  it("CCLAW_VERSION mirrors package.json's version field (single source of truth)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(CCLAW_VERSION).toBe(pkg.version);
    expect(CCLAW_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
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
