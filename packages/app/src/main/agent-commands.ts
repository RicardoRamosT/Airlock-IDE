import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import type { AgentCommand, AgentCommandResult } from "../shared/ipc";
import { lastFocusedWindow } from "./window";

// MAIN-ONLY resolver: the IDE-control MCP tools (list_tabs/open_tab/close_tab/
// switch_tab/split_view/open_terminal/close_terminal) ask the FOCUSED window to
// change its tab/split/terminal layout. This module mirrors agent-requests.ts:
// it pushes an event to the renderer, which performs the store action and reports
// the resulting layout, and resolves a promise with that layout (or an error).
//
// THE INVARIANT: these commands carry only tab/terminal ids and a folder path,
// and the reply is layout METADATA (tab names + terminal titles) -- NEVER a secret
// value, env value, or terminal output. So this widens no value surface; it sits
// alongside the request_secret round-trip, not the redactor/value-getter path.
//
// It NEVER rejects/throws: a missing window, a timeout, or a renderer error all
// resolve to { ok:false, error } so a tool call degrades gracefully.
//
// ASCII-only comments AND string literals: this file is CJS-bundled into the
// Electron main process and Electron's cjs_lexer crashes on multibyte chars.

// ~5 seconds: a layout change is near-instant in the renderer, so this is just a
// bound so a closed/unresponsive window never strands the agent waiting forever.
const COMMAND_TIMEOUT_MS = 5 * 1000;

// In-flight commands keyed by requestId. Each entry pairs the resolve with its
// timer so the resolved-IPC lookup and the timeout clear are explicit.
const pending = new Map<
  string,
  {
    resolve: (r: AgentCommandResult) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

// MAIN-ONLY: send an IDE-control command to the FOCUSED window and await the
// renderer's reply (the resulting layout metadata). Resolves { ok:false } -- never
// rejects -- when there is no live window, the reply times out, or the renderer
// reports an error. The focused window is resolved via lastFocusedWindow(), the
// same window the agent's other tools target.
export function runAgentCommand(
  cmd: AgentCommand,
): Promise<AgentCommandResult> {
  const win = lastFocusedWindow();
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ ok: false, error: "No airlock window" });
  }
  const id = randomUUID();
  return new Promise<AgentCommandResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "timed out" });
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    try {
      win.webContents.send("agent:command", { id, cmd });
    } catch {
      // The window was destroyed between the isDestroyed() check above and this
      // send. Honor the documented never-rejects contract: clear the timer and
      // resolve gracefully instead of letting send() throw out of the executor
      // (which would reject the promise). (audit PB-H14)
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, error: "window closed" });
    }
  });
}

// Resolve a pending command from the renderer-reported result. Clears the timer
// and the pending entry so a late timeout cannot double-resolve. A missing/unknown
// id (already resolved or timed out) is a no-op.
function resolveAgentCommand(id: string, result: AgentCommandResult): void {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(result);
}

// Register the renderer-reported IPC handler. The renderer replies with
// (id, result) where result is the AgentCommandResult it built from the store.
// Validate the payload shape before resolving so a malformed message is ignored.
export function registerAgentCommandIpc(): void {
  ipcMain.on(
    "agent:command-result",
    (_e, payload: { id?: unknown; result?: unknown }) => {
      const id = payload?.id;
      const result = payload?.result as AgentCommandResult | undefined;
      if (typeof id !== "string" || !result || typeof result.ok !== "boolean") {
        return;
      }
      resolveAgentCommand(id, result);
    },
  );
}
