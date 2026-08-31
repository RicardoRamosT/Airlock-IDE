import { randomUUID } from "node:crypto";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import {
  AGENT_REQUEST_POLICY,
  type AgentRequest,
  coalesceKey,
  REGISTRY_MAX,
  type SecretRequest,
  shouldPruneOn,
  shouldPruneOnExpiry,
  type TerminalGrantRequest,
} from "../shared/agentRequests";
import type { TerminalInputResult } from "../shared/ipc";
import { appWindows, isAppWindow, windowForRoot } from "./window";

// MAIN-ONLY registry of agent-initiated requests (request_secret, and
// send_terminal_input's grant). MAIN OWNS THE STATE and the renderer renders a
// per-window projection of it -- that is load-bearing, not a preference: if the
// list lived in renderer state, a window close, a renderer reload or a project
// tear-off would destroy it while the agent kept waiting.
//
// THE INVARIANT: this module NEVER reads/returns/handles a secret value. A
// vaulted value flows user -> keychain via the existing secretsSet path; the only
// thing that crosses back to the agent is a boolean.
//
// ASCII-only comments AND string literals: this file is CJS-bundled into the
// Electron main process and Electron's cjs_lexer crashes on multibyte chars.

export interface SecretRequestResult {
  vaulted: boolean;
  timedOut?: boolean;
}

// ~5 minutes: long enough for the user to find + paste the secret, bounded so an
// ignored card never strands the agent waiting forever.
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const GRANT_TIMEOUT_MS = 5 * 60 * 1000;

// How main reaches windows. A DI seam so the registry's queueing, coalescing,
// expiry, pruning and re-routing are all unit-testable WITHOUT Electron.
export interface RequestHost {
  // Ids of live windows.
  windowIds(): number[];
  // Which window should own a request for this root.
  pickWindow(root: string | null): number | null;
  // Push one window its own projection.
  send(windowId: number, requests: AgentRequest[]): void;
}

// Exported for its OWN test. The fake host used by the rest of the suite
// replaces this wholesale, so every branch below was previously unexercised --
// which is exactly how the focused-window bug survived.
export const electronHost: RequestHost = {
  windowIds: () => appWindows().map((w) => w.id),
  pickWindow: (root) => {
    // The focused window must be an APP window. Atlas's chat window and the
    // tray popover are real BrowserWindows that never enter appWindowIds, and
    // they outlive their own close (the handler hides rather than destroys), so
    // getFocusedWindow can hand back a window that mounts no AgentRequestStack
    // and that broadcast() -- which iterates appWindows() -- never sends to.
    // Targeting one puts the card in no window at all: not the stack, not the
    // bell, invisible everywhere until it expires. See the same trap documented
    // in window.ts, which is why isAppWindow exists.
    const focused = BrowserWindow.getFocusedWindow();
    const win =
      (root ? windowForRoot(root) : null) ??
      (focused && isAppWindow(focused.id) ? focused : null) ??
      appWindows()[0] ??
      null;
    return win ? win.id : null;
  },
  send: (windowId, requests) => {
    const wc = BrowserWindow.fromId(windowId)?.webContents;
    if (wc && !wc.isDestroyed()) wc.send("agent:requests-changed", requests);
  },
};

let host: RequestHost = electronHost;

export function setRequestHost(h: RequestHost): void {
  host = h;
}

interface Entry {
  req: AgentRequest;
  targetWindowId: number | null;
  // Coalesced waiters: several agents can await the SAME card.
  waiters: ((o: { ok: boolean; timedOut?: boolean }) => void)[];
  timer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();

// PTY ids the user has approved for agent input this run. In-memory: clears on
// quit. Keyed by PTY id (not layout id), so a respawned terminal re-prompts.
const grantedTerminals = new Set<string>();

// Test-only: drop all state and timers between cases.
export function __resetAgentRequests(): void {
  for (const e of entries.values()) if (e.timer) clearTimeout(e.timer);
  entries.clear();
  grantedTerminals.clear();
}

export function listRequestsForWindow(windowId: number): AgentRequest[] {
  const out: AgentRequest[] = [];
  for (const e of entries.values())
    if (e.targetWindowId === windowId) out.push(e.req);
  return out;
}

function broadcast(): void {
  for (const id of host.windowIds()) host.send(id, listRequestsForWindow(id));
}

// Resolve every waiter exactly once and drop the entry. A missing id (already
// settled) is a no-op, so a late timeout cannot double-resolve.
function settle(
  requestId: string,
  outcome: { ok: boolean; timedOut?: boolean },
): void {
  const e = entries.get(requestId);
  if (!e) return;
  if (e.timer) clearTimeout(e.timer);
  entries.delete(requestId);
  for (const w of e.waiters) w(outcome);
  broadcast();
}

// Evict the oldest NON-pending entries when over the cap. NEVER a pending one --
// dropping a pending entry strands the agent waiting on it.
function enforceCap(): void {
  if (entries.size <= REGISTRY_MAX) return;
  const evictable = [...entries.values()]
    .filter((e) => e.req.state !== "pending")
    .sort((a, b) => a.req.createdAt - b.req.createdAt);
  for (const e of evictable) {
    if (entries.size <= REGISTRY_MAX) break;
    entries.delete(e.req.requestId);
  }
}

// On timeout the agent stops waiting. The card does NOT vanish: it flips to
// "expired" so the user can see why, UNLESS the kind is worthless once expired
// (a terminal grant), in which case it is pruned.
function expire(requestId: string): void {
  const e = entries.get(requestId);
  if (!e) return;
  e.timer = null;
  e.req = { ...e.req, state: "expired" };
  const waiters = e.waiters;
  e.waiters = [];
  if (shouldPruneOnExpiry(e.req)) entries.delete(requestId);
  for (const w of waiters) w({ ok: false, timedOut: true });
  broadcast();
}

function register(
  req: AgentRequest,
  timeoutMs: number,
  waiter: (o: { ok: boolean; timedOut?: boolean }) => void,
): void {
  entries.set(req.requestId, {
    req,
    targetWindowId: host.pickWindow(req.root),
    waiters: [waiter],
    timer: setTimeout(() => expire(req.requestId), timeoutMs),
  });
  enforceCap();
  broadcast();
}

// Find an existing card that means the same thing, so a second agent asking for
// the same secret in the same project joins it rather than opening a duplicate.
function findCoalescable(req: AgentRequest): Entry | null {
  const key = coalesceKey(req);
  if (key === null) return null;
  for (const e of entries.values())
    if (e.req.state === "pending" && coalesceKey(e.req) === key) return e;
  return null;
}

// MAIN-ONLY: ask the user to vault a secret. Resolves only a boolean -- the value
// goes user -> keychain via secretsSet and never passes through here. `root`
// identifies the CALLING SESSION's project so the card lands in that project's
// window rather than following GUI focus.
export function requestSecretFromUser(
  name: string,
  providerHint: string | undefined,
  root: string | null,
): Promise<SecretRequestResult> {
  // No live window to ask -- resolve not-vaulted immediately and store nothing.
  if (host.pickWindow(root) === null)
    return Promise.resolve({ vaulted: false });
  const req: SecretRequest = {
    kind: "secret",
    requestId: randomUUID(),
    state: "pending",
    createdAt: Date.now(),
    dismissed: false,
    root,
    projectName: root ? path.basename(root) : null,
    name,
    providerHint,
  };
  return new Promise<SecretRequestResult>((resolve) => {
    const waiter = (o: { ok: boolean; timedOut?: boolean }) =>
      resolve(
        o.timedOut ? { vaulted: o.ok, timedOut: true } : { vaulted: o.ok },
      );
    const existing = findCoalescable(req);
    if (existing) {
      existing.waiters.push(waiter);
      return;
    }
    register(req, REQUEST_TIMEOUT_MS, waiter);
  });
}

export function resolveSecretRequest(
  requestId: string,
  vaulted: boolean,
): void {
  settle(requestId, { ok: vaulted });
}

// --- Terminal input grants (the send_terminal_input MCP tool) ----------------
// THE INVARIANT: this writes the agent's OWN input bytes; it never reads or
// returns a secret value.

export function requestTerminalGrant(
  ptyId: string,
  label: string,
  preview: string,
): Promise<{ granted: boolean; timedOut?: boolean }> {
  // Already-granted pty opens NO card, so it must short-circuit FIRST.
  if (grantedTerminals.has(ptyId)) return Promise.resolve({ granted: true });
  if (host.pickWindow(null) === null)
    return Promise.resolve({ granted: false });
  const req: TerminalGrantRequest = {
    kind: "terminalGrant",
    requestId: randomUUID(),
    state: "pending",
    createdAt: Date.now(),
    dismissed: false,
    root: null,
    projectName: label,
    ptyId,
    label,
    preview,
  };
  return new Promise((resolve) => {
    register(req, GRANT_TIMEOUT_MS, (o) =>
      resolve(
        o.timedOut ? { granted: o.ok, timedOut: true } : { granted: o.ok },
      ),
    );
  });
}

export function resolveTerminalGrant(
  requestId: string,
  granted: boolean,
): void {
  const e = entries.get(requestId);
  if (e && e.req.kind === "terminalGrant" && granted)
    grantedTerminals.add(e.req.ptyId);
  settle(requestId, { ok: granted });
}

// --- Lifecycle: the events that make a request moot or move it ---------------

// Dismiss means LATER, not gone: the card moves to the bell and the agent keeps
// waiting. It does NOT resolve anything.
export function dismissAgentRequest(requestId: string): void {
  const e = entries.get(requestId);
  if (!e || !AGENT_REQUEST_POLICY[e.req.kind].dismissible) return;
  e.req = { ...e.req, dismissed: true };
  broadcast();
}

// A dead pty makes its pending grant moot -- approving it could only fail.
export function pruneRequestsOnPtyExit(ptyId: string): void {
  for (const e of [...entries.values()])
    if (
      e.req.kind === "terminalGrant" &&
      e.req.ptyId === ptyId &&
      shouldPruneOn(e.req, "ptyExit")
    )
      settle(e.req.requestId, { ok: false });
}

// The user vaulted the requested secret by hand while the card was open. The
// request is satisfied -- resolve it rather than leave a card asking for
// something that now exists.
export function resolveExternallyVaulted(root: string, name: string): void {
  for (const e of [...entries.values()])
    if (
      e.req.kind === "secret" &&
      AGENT_REQUEST_POLICY.secret.resolvesExternally &&
      e.req.root === root &&
      e.req.name === name
    )
      settle(e.req.requestId, { ok: true });
}

// A window closing must not take pending requests with it. Re-route to a
// surviving window; only when NOTHING survives do we resolve them, rather than
// letting them hang to the timeout with nothing on screen anywhere.
export function rerouteRequestsFromClosedWindow(closedId: number): void {
  const survivors = host.windowIds().filter((w) => w !== closedId);
  for (const e of [...entries.values()]) {
    if (e.targetWindowId !== closedId) continue;
    const preferred = host.pickWindow(e.req.root);
    const next =
      preferred !== null && preferred !== closedId
        ? preferred
        : (survivors[0] ?? null);
    if (next === null) settle(e.req.requestId, { ok: false });
    else e.targetWindowId = next;
  }
  broadcast();
}

// --- IPC ---------------------------------------------------------------------

export function registerAgentRequestIpc(): void {
  ipcMain.handle("agent:requests-list", (e) => {
    const id = BrowserWindow.fromWebContents(e.sender)?.id;
    return id === undefined ? [] : listRequestsForWindow(id);
  });
  ipcMain.handle("agent:request-dismiss", (_e, requestId: unknown) => {
    if (typeof requestId !== "string") throw new Error("Invalid payload");
    dismissAgentRequest(requestId);
  });
  ipcMain.handle(
    "agent:request-secret-resolved",
    (_e, requestId: unknown, vaulted: unknown) => {
      if (typeof requestId !== "string" || typeof vaulted !== "boolean")
        throw new Error("Invalid payload");
      resolveSecretRequest(requestId, vaulted);
    },
  );
  ipcMain.handle(
    "agent:terminal-grant-resolved",
    (_e, requestId: unknown, granted: unknown) => {
      if (typeof requestId !== "string" || typeof granted !== "boolean")
        throw new Error("Invalid payload");
      resolveTerminalGrant(requestId, granted);
    },
  );
}

export interface TerminalInputDeps {
  write: (ptyId: string, data: string) => boolean; // false if no live session
  label: (ptyId: string) => string | null; // null if the pty id is unknown
}

// A short, single-line echo of the bytes to be typed, for the card. These are
// the agent's OWN input (never a vault secret -- the agent never holds values);
// control chars become spaces and the length is bounded.
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
  const g = await requestTerminalGrant(ptyId, label, previewInput(data));
  if (g.timedOut) return { timedOut: true };
  if (!g.granted) return { denied: true };
  if (!deps.write(ptyId, data))
    return { error: "Terminal is no longer running." };
  return { sent: true };
}
