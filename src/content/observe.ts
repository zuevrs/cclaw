import { RUNTIME_ROOT } from "../constants.js";

function hookDispatcherCommand(hookName: string): string {
  // RUNTIME_ROOT is a relative path (".cclaw") that currently contains no
  // whitespace, so quoting is unnecessary inside the JSON-encoded command
  // string. If RUNTIME_ROOT ever becomes configurable, wrap the path with
  // JSON.stringify to survive spaces.
  return `node ${RUNTIME_ROOT}/hooks/run-hook.mjs ${hookName}`;
}

export function claudeHooksJsonWithObservation(): string {
  return JSON.stringify({
    cclawHookSchemaVersion: 1,
    hooks: {
      SessionStart: [{
        matcher: "startup|resume|clear|compact",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("session-start")
        }]
      }],
      PreToolUse: [{
        matcher: "*",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("prompt-guard")
        }]
      }, {
        matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("workflow-guard")
        }]
      }],
      PostToolUse: [{
        matcher: "*",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("context-monitor")
        }]
      }],
      Stop: [{
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("stop-checkpoint"),
          timeout: 10
        }]
      }],
      PreCompact: [{
        matcher: "manual|auto",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("pre-compact"),
          timeout: 10
        }]
      }]
    }
  }, null, 2);
}

export function cursorHooksJsonWithObservation(): string {
  return JSON.stringify({
    cclawHookSchemaVersion: 1,
    version: 1,
    hooks: {
      sessionStart: [{
        command: hookDispatcherCommand("session-start")
      }],
      sessionResume: [{
        command: hookDispatcherCommand("session-start")
      }],
      sessionClear: [{
        command: hookDispatcherCommand("session-start")
      }],
      sessionCompact: [{
        command: hookDispatcherCommand("pre-compact")
      }, {
        command: hookDispatcherCommand("session-start")
      }],
      preToolUse: [{
        matcher: "*",
        command: hookDispatcherCommand("prompt-guard")
      }, {
        matcher: "*",
        command: hookDispatcherCommand("workflow-guard")
      }],
      postToolUse: [{
        matcher: "*",
        command: hookDispatcherCommand("context-monitor")
      }],
      stop: [{
        command: hookDispatcherCommand("stop-checkpoint"),
        timeout: 10
      }]
    }
  }, null, 2);
}

export function codexHooksJsonWithObservation(): string {
  return JSON.stringify({
    cclawHookSchemaVersion: 1,
    hooks: {
      SessionStart: [{
        matcher: "startup|resume",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("session-start")
        }]
      }],
      UserPromptSubmit: [{
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("prompt-guard")
        }, {
          type: "command",
          command: hookDispatcherCommand("workflow-guard")
        }, {
          type: "command",
          command: hookDispatcherCommand("verify-current-state")
        }]
      }],
      PreToolUse: [{
        matcher: "Bash|bash",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("prompt-guard")
        }, {
          type: "command",
          command: hookDispatcherCommand("workflow-guard")
        }]
      }],
      PostToolUse: [{
        matcher: "Bash|bash",
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("context-monitor")
        }]
      }],
      Stop: [{
        hooks: [{
          type: "command",
          command: hookDispatcherCommand("stop-checkpoint"),
          timeout: 10
        }]
      }]
    }
  }, null, 2);
}
