import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import type { TerminalInputResult } from "../shared/ipc";

// MAIN-ONLY resolver: the agent (via the request_secret MCP tool) asks the USER
// to vault a secret. This module pushes an event to the renderer (which opens
// the secure modal) and resolves a promise when the renderer reports the user's
// save/cancel. THE INVARIANT: it NEVER reads/returns/handles a secret value --
// the value flows user -> keychain via the existing secretsSet path. The only
// thing that crosses back to the agent is the boolean below.
//
// ASCII-only comments AND string literals: this file is CJS-bundled into the
// Electron main process and Electron's cjs_lexer crashes on multibyte chars.

export interface SecretRequestResult {
  vaulted: boolean;
  timedOut?: boolean;
  busy?: boolean;
}

// ~5 minutes: long enough for the user to find + paste the secret, bounded so a
// dismissed/ignored modal never strands the agent waiting forever.
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

// In-flight requests keyed by requestId. There is at most one at a time (see the
// busy guard in requestSecretFromUser), but a Map keeps the resolve+timer paired
// and makes the resolved-IPC lookup explicit.
const pending = new Map<
  string,
  {
    resolve: (r: SecretRequestResult) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

// DI seam: how we tell the renderer to open the modal. Returns false if there is
// no live window to ask. Injected in tests so the resolver/timeout/busy logic is
// unit-testable WITHOUT Electron.
export type RequestNotifier = (payload: {
  requestId: string;
  name: string;
  providerHint?: string;
}) => boolean;

const realNotify: RequestNotifier = (payload) => {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const wc = win?.webContents;
  if (!wc || wc.isDestroyed()) return false;
  wc.send("agent:request-secret", payload);
  return true;
};

// MAIN-ONLY: ask the user to vault a secret. Opens the modal and awaits the
// user's save/cancel. NEVER returns or handles a value -- the value goes
// user -> keychain via secretsSet; this resolves only a boolean.
export function requestSecretFromUser(
  name: string,
  providerHint?: string,
  notify: RequestNotifier = realNotify,
): Promise<SecretRequestResult> {
  // Single in-flight: a 2nd request while one is pending returns busy rather
  // than stacking a second modal on top of the first.
  if (pending.size > 0) return Promise.resolve({ vaulted: false, busy: true });
  const requestId = randomUUID();
  // No live window to ask -- resolve not-vaulted immediately and leave no
  // pending entry, so the next request can proceed.
  if (!notify({ requestId, name, providerHint })) {
    return Promise.resolve({ vaulted: false });
  }
  return new Promise<SecretRequestResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ vaulted: false, timedOut: true });
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
  });
}

// Resolve a pending request (called from the renderer-resolved IPC). Clears the
// timeout and the pending entry so a late timeout cannot double-resolve. A
// missing/unknown requestId (already resolved or timed out) is a no-op.
export function resolveSecretRequest(
  requestId: string,
  vaulted: boolean,
): void {
  const p = pending.get(requestId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve({ vaulted });
}

// Register the renderer-resolved IPC handler. The renderer reports the outcome
// as (requestId, vaulted: boolean) ONLY -- never a value. Validate the payload
// shape before resolving so a malformed message cannot resolve a request.
export function registerAgentRequestIpc(): void {
  ipcMain.handle(
    "agent:request-secret-resolved",
    (_e, requestId: unknown, vaulted: unknown) => {
      if (typeof requestId !== "string" || typeof vaulted !== "boolean") {
        throw new Error("Invalid payload");
      }
      resolveSecretRequest(requestId, vaulted);
    },
  );
  ipcMain.handle(
    "agent:terminal-grant-resolved",
    (_e, requestId: unknown, granted: unknown) => {
      if (typeof requestId !== "string" || typeof granted !== "boolean") {
        throw new Error("Invalid payload");
      }
      resolveTerminalGrant(requestId, granted);
    },
  );
}

// --- Terminal input grants (the send_terminal_input MCP tool) ----------------
// Mirrors the secret-request flow above: the agent asks to type into a live
// terminal; main opens a modal and awaits the user's allow/deny, then on allow
// remembers that pty id for the rest of the run so later sends skip the prompt.
// THE INVARIANT: this writes the agent's OWN input bytes; it never reads or
// returns a secret value. ASCII-only (CJS-bundled into main).

// PTY ids the user has approved for agent input this run. In-memory: clears on
// quit. Keyed by PTY id (not layout id), so a respawned terminal re-prompts.
const grantedTerminals = new Set<string>();

const GRANT_TIMEOUT_MS = 5 * 60 * 1000;

const grantPending = new Map<
  string,
  {
    ptyId: string;
    resolve: (granted: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

export type GrantNotifier = (payload: {
  requestId: string;
  ptyId: string;
  label: string;
  preview: string;
}) => boolean;

const realGrantNotify: GrantNotifier = (payload) => {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const wc = win?.webContents;
  if (!wc || wc.isDestroyed()) return false;
  wc.send("agent:terminal-grant-request", payload);
  return true;
};

// Ask the user to allow agent input into one terminal. Resolves immediately when
// already granted (no modal). One outstanding request at a time (busy), bounded
// by a timeout so an ignored modal never strands the agent.
export function requestTerminalGrant(
  ptyId: string,
  label: string,
  preview: string,
  notify: GrantNotifier = realGrantNotify,
): Promise<{ granted: boolean; timedOut?: boolean; busy?: boolean }> {
  if (grantedTerminals.has(ptyId)) return Promise.resolve({ granted: true });
  if (grantPending.size > 0)
    return Promise.resolve({ granted: false, busy: true });
  const requestId = randomUUID();
  if (!notify({ requestId, ptyId, label, preview })) {
    return Promise.resolve({ granted: false });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      grantPending.delete(requestId);
      resolve({ granted: false, timedOut: true });
    }, GRANT_TIMEOUT_MS);
    grantPending.set(requestId, {
      ptyId,
      resolve: (granted) => resolve({ granted }),
      timer,
    });
  });
}

// Resolve a pending grant (from the renderer-resolved IPC). On allow, remember
// the pty id so later sends skip the modal. Unknown/late requestId is a no-op.
export function resolveTerminalGrant(
  requestId: string,
  granted: boolean,
): void {
  const p = grantPending.get(requestId);
  if (!p) return;
  clearTimeout(p.timer);
  grantPending.delete(requestId);
  if (granted) grantedTerminals.add(p.ptyId);
  p.resolve(granted);
}

export interface TerminalInputDeps {
  write: (ptyId: string, data: string) => boolean; // false if no live session
  label: (ptyId: string) => string | null; // null if the pty id is unknown
  notify?: GrantNotifier;
}

// A short, single-line echo of the bytes to be typed, for the modal. These are
// the agent's OWN input (never a vault secret -- the agent never holds values);
// control chars become spaces and the length is bounded. ASCII-only literal.
function previewInput(data: string): string {
  const oneLine = data.replace(/[^\x20-\x7e]/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}...` : oneLine;
}

// Orchestrate one send: resolve a label (error if the pty is gone), get/await the
// grant, then write. Value-free outcome.
export async function gatedTerminalInput(
  ptyId: string,
  data: string,
  deps: TerminalInputDeps,
): Promise<TerminalInputResult> {
  const label = deps.label(ptyId);
  if (label === null)
    return { error: "No such terminal (it may have closed)." };
  const g = await requestTerminalGrant(
    ptyId,
    label,
    previewInput(data),
    deps.notify,
  );
  if (g.busy) return { busy: true };
  if (g.timedOut) return { timedOut: true };
  if (!g.granted) return { denied: true };
  if (!deps.write(ptyId, data))
    return { error: "Terminal is no longer running." };
  return { sent: true };
}
