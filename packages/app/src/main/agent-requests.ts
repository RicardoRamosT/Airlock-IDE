import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

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
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
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
}
