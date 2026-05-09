export const CCLAW_VERSION = "8.5.0";
export const RUNTIME_ROOT = ".cclaw";

export const STATE_REL_PATH = `${RUNTIME_ROOT}/state`;
export const HOOKS_REL_PATH = `${RUNTIME_ROOT}/hooks`;
export const FLOWS_ROOT = `${RUNTIME_ROOT}/flows`;
export const LIB_ROOT = `${RUNTIME_ROOT}/lib`;

export const FLOW_STATE_REL_PATH = `${STATE_REL_PATH}/flow-state.json`;
export const KNOWLEDGE_LOG_REL_PATH = `${RUNTIME_ROOT}/knowledge.jsonl`;
export const IDEAS_REL_PATH = `${RUNTIME_ROOT}/ideas.md`;

export const SHIPPED_DIR_REL_PATH = `${FLOWS_ROOT}/shipped`;
export const CANCELLED_DIR_REL_PATH = `${FLOWS_ROOT}/cancelled`;

export const LIB_DIRS = [
  "agents",
  "skills",
  "templates",
  "runbooks",
  "patterns",
  "research",
  "recovery",
  "examples"
] as const;
