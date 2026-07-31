// Types and per-kind POLICY for agent-initiated requests -- the corner-card
// surface that replaced the centre modal.
//
// Lives in shared/ because BOTH main and the renderer need it, and the renderer
// must never value-import @airlock/agent-core (its barrel re-exports native deps,
// so electron-vite fails trying to bundle a .node into the browser build).
// Pure data and pure predicates: no imports, no I/O, no Electron.

export type AgentRequestKind = "secret" | "terminalGrant";

// pending -- the agent is still waiting.
// expired -- the timeout fired and the agent already received timedOut.
export type AgentRequestState = "pending" | "expired";

export interface AgentRequestCommon {
  requestId: string;
  state: AgentRequestState;
  createdAt: number; // epoch ms
  dismissed: boolean; // moved to the bell -- NOT answered
  root: string | null;
  projectName: string | null;
}

export interface SecretRequest extends AgentRequestCommon {
  kind: "secret";
  name: string;
  providerHint?: string;
}

export interface TerminalGrantRequest extends AgentRequestCommon {
  kind: "terminalGrant";
  ptyId: string;
  label: string;
  preview: string;
}

export type AgentRequest = SecretRequest | TerminalGrantRequest;

export type PruneTrigger = "ptyExit";

export interface KindPolicy {
  /** May the user still act once the agent stopped waiting? */
  actionableAfterExpiry: boolean;
  /** External events that make this request moot. */
  pruneOn: readonly PruneTrigger[];
  /** May it be moved to the bell instead of answered? */
  dismissible: boolean;
  /** Can something other than this card satisfy it? */
  resolvesExternally: boolean;
}

// Per-kind behaviour is DATA, not `if (kind === ...)` scattered across the stack
// and the bell -- the same rule extensionActions follows. Adding a kind is one
// row plus a card renderer; no surface re-derives any of this.
//
// NOTE: the design spec also listed a `captureOverwrite` kind. It is absent on
// purpose: capture_secret v1 REFUSES an already-vaulted name rather than
// prompting, so nothing produces that request and the kind would be dead code.
// When a producer exists it is one row here.
export const AGENT_REQUEST_POLICY: Record<AgentRequestKind, KindPolicy> = {
  // Vaulting a secret stays useful whenever the user gets to it -- the agent
  // simply finds it on the next attempt. And the user may vault it by hand in
  // the sidebar while the card is open, which should resolve the request.
  secret: {
    actionableAfterExpiry: true,
    pruneOn: [],
    dismissible: true,
    resolvesExternally: true,
  },
  // The send already returned timedOut, so approving later authorises nothing,
  // and a dead pty makes it moot even before expiry.
  terminalGrant: {
    actionableAfterExpiry: false,
    pruneOn: ["ptyExit"],
    dismissible: true,
    resolvesExternally: false,
  },
};

// Two requests with the same key are the SAME request: one card, and answering
// it resolves every awaiting promise. Grants are keyed by ptyId and naturally
// distinct, so they never coalesce.
//
// JSON-encoded rather than joined by a separator character: a root is an
// arbitrary filesystem path, so any printable separator could also occur inside
// it and make two different (root, name) pairs collide. (An earlier draft used a
// NUL separator, which is collision-proof but puts a NUL byte in the source and
// makes the file read as binary to grep.)
export function coalesceKey(r: AgentRequest): string | null {
  return r.kind === "secret"
    ? JSON.stringify(["secret", r.root ?? "", r.name])
    : null;
}

export function isActionable(r: AgentRequest): boolean {
  return (
    r.state === "pending" || AGENT_REQUEST_POLICY[r.kind].actionableAfterExpiry
  );
}

// An expired request the user can no longer act on is noise -- drop it rather
// than leave a button that does nothing.
export function shouldPruneOnExpiry(r: AgentRequest): boolean {
  return !AGENT_REQUEST_POLICY[r.kind].actionableAfterExpiry;
}

export function shouldPruneOn(r: AgentRequest, trigger: PruneTrigger): boolean {
  return AGENT_REQUEST_POLICY[r.kind].pruneOn.includes(trigger);
}

// Cards shown in the corner stack at once; the rest collapse to "+N more".
export const VISIBLE_STACK_MAX = 3;

// Hard cap on the registry. Eviction drops the oldest NON-pending entry first
// and NEVER a pending one -- dropping a pending entry strands an agent.
export const REGISTRY_MAX = 50;

// Split one window's requests into the corner stack and the bell. An expired but
// undismissed request stays in the stack (showing its expired state) as long as
// it is still actionable -- it must not vanish silently.
export function partitionRequests(all: AgentRequest[]): {
  stack: AgentRequest[];
  overflow: number;
  bell: AgentRequest[];
} {
  const newestFirst = [...all].sort((a, b) => b.createdAt - a.createdAt);
  const live = newestFirst.filter((r) => !r.dismissed && isActionable(r));
  const bell = newestFirst.filter((r) => r.dismissed || !isActionable(r));
  return {
    stack: live.slice(0, VISIBLE_STACK_MAX),
    overflow: Math.max(0, live.length - VISIBLE_STACK_MAX),
    bell,
  };
}

// The badge counts what you can still DO something about.
export function bellCount(bell: AgentRequest[]): number {
  return bell.filter(isActionable).length;
}
