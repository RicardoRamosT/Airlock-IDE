// Instrumentation for MCP tool calls.
//
// Without this, `read_events` with category "tool" returned [] -- AirLock
// logged IPC but never MCP -- so there was no way to tell which of the ~39
// tools are actually used, and any decision to prune or merge one was argument
// rather than measurement.
//
// It decorates registerTool ONCE (in server.ts) rather than touching each
// registration, so tools.ts stays the pure argument-plumbing layer its header
// describes, and a tool added later is instrumented automatically instead of by
// remembering to.
//
// ARGUMENTS ARE DELIBERATELY NOT LOGGED -- only name, outcome and duration.
// send_terminal_input carries whatever the user is typing and run_command
// carries a command line; either can hold a credential the redactor would have
// to be lucky to catch. The tool NAME alone answers the usage question, so
// logging arguments buys nothing for the risk. For the same reason an isError
// result is recorded as outcome "error" WITHOUT its message -- a tool that
// fails on a bad secret should not put that secret in the log.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main
// process and Electron's cjs_lexer crashes on multibyte characters.

import type { EmitInput } from "@airlock/agent-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// The shape this needs from a server: registerTool, whatever its real generics.
type Registrar = (
  name: string,
  config: unknown,
  handler: (...args: unknown[]) => unknown,
) => unknown;

// True when a tool returned the SDK's error-flagged result rather than throwing.
function isErrorResult(out: unknown): boolean {
  return (
    typeof out === "object" &&
    out !== null &&
    "isError" in out &&
    (out as { isError?: boolean }).isError === true
  );
}

// Wrap a server so each registered tool emits one event per call. The emitter
// is injected so this is unit-testable without standing up Electron (wire.ts,
// the real one, imports electron's `app` for the log path).
export function withToolLogging(
  mcp: McpServer,
  emit: (input: EmitInput) => void,
): McpServer {
  const inner = mcp.registerTool.bind(mcp) as Registrar;
  const patched: Registrar = (name, config, handler) =>
    inner(name, config, async (...args: unknown[]) => {
      const started = Date.now();
      try {
        const out = await handler(...args);
        const failed = isErrorResult(out);
        emit({
          level: failed ? "warn" : "info",
          category: "tool",
          op: `tool.${name}`,
          actor: "agent",
          outcome: failed ? "error" : "ok",
          durationMs: Date.now() - started,
        });
        return out;
      } catch (e) {
        emit({
          level: "error",
          category: "tool",
          op: `tool.${name}`,
          actor: "agent",
          outcome: "error",
          durationMs: Date.now() - started,
          error: { message: e instanceof Error ? e.message : String(e) },
        });
        throw e;
      }
    });
  // A Proxy rather than a mutated copy: McpServer is a class instance whose
  // other methods (connect, registerResource) must keep their own `this`.
  return new Proxy(mcp, {
    get: (t, prop, recv) =>
      prop === "registerTool" ? patched : Reflect.get(t, prop, recv),
  });
}
