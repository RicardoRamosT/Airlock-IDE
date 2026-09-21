// Types and per-kind POLICY for agent-initiated requests -- the corner-card
// surface that replaced the centre modal.
//
// Lives in shared/ because BOTH main and the renderer need it, and the renderer
// must never value-import @airlock/agent-core (its barrel re-exports native deps,
// so electron-vite fails trying to bundle a .node into the browser build).
// Pure data and pure predicates: no imports, no I/O, no Electron.

export type AgentRequestKind = "secret" | "terminalGrant" | "longRunningApp";

// pending -- the agent is still waiting. A NOTICE kind (longRunningApp) has no
//   agent behind it and stays "pending" for as long as the thing it describes is
//   true; it is retired by reconciliation, not by a timeout.
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

// A local app that has been running longer than the threshold. NOT a request:
// nothing is waiting on it, and answering it is not required. It rides this
// registry because the bell, the per-window projection, dismissal and the cap
// are all exactly what it needs -- see main/agent-requests.ts for the two
// invariants that had to generalise to carry a waiter-less entry.
//
// Fields are FLAT rather than a nested app object: this module is deliberately
// import-free so both main and the renderer can load it.
export interface LongRunningAppRequest extends AgentRequestCommon {
  kind: "longRunningApp";
  appType: LocalAppType;
  appId: string; // container id | project root | port, per type
  name: string; // what the user recognises it by
  detail: string; // image, command, or "" when there is nothing to add
  startedAt: number; // epoch ms -- part of the identity, see appIdentity
}

export type LocalAppType = "container" | "managedServer" | "detectedServer";

export type AgentRequest =
  | SecretRequest
  | TerminalGrantRequest
  | LongRunningAppRequest;

export type PruneTrigger = "ptyExit";

export interface KindPolicy {
  /** Where the card lives. A request from an agent interrupts you in the
   * corner; a passive OBSERVATION goes straight to the bell and must never
   * seize the corner. Routed on here rather than on `dismissed` alone. */
  surface: "corner" | "bell";
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
    surface: "corner",
    actionableAfterExpiry: true,
    pruneOn: [],
    dismissible: true,
    resolvesExternally: true,
  },
  // The send already returned timedOut, so approving later authorises nothing,
  // and a dead pty makes it moot even before expiry.
  terminalGrant: {
    surface: "corner",
    actionableAfterExpiry: false,
    pruneOn: ["ptyExit"],
    dismissible: true,
    resolvesExternally: false,
  },
  // Nobody is waiting, so it never expires and never strands anyone. It is
  // retired by RECONCILIATION -- the app stopped, or fell back under the
  // threshold -- and "dismiss" means acknowledge, which suppresses this exact
  // identity rather than merely hiding the card.
  longRunningApp: {
    surface: "bell",
    actionableAfterExpiry: true,
    pruneOn: [],
    dismissible: true,
    resolvesExternally: true,
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
  if (r.kind === "secret")
    return JSON.stringify(["secret", r.root ?? "", r.name]);
  if (r.kind === "longRunningApp") return appIdentity(r);
  return null;
}

// The stable identity of a long-running app, used BOTH to avoid a duplicate
// card on every poll and to remember what the user acknowledged.
//
// `startedAt` IS PART OF THE IDENTITY, and that is the load-bearing detail:
// acknowledging a notice suppresses this identity for good, so without the
// start time "Ignore" would silence that container or port forever. Restarting
// the app gives it a new start time, hence a new identity, so a genuinely new
// 24-hour run is reported again.
export function appIdentity(r: {
  appType: LocalAppType;
  appId: string;
  startedAt: number;
}): string {
  return JSON.stringify(["app", r.appType, r.appId, r.startedAt]);
}

// Default threshold. 24h, per the request; the pref may raise or lower it.
export const DEFAULT_THRESHOLD_HOURS = 24;

// Whether an app has been up long enough to be worth mentioning. Strictly
// greater, so a threshold of 0 does not indict something started this instant.
export function isOverThreshold(
  startedAt: number,
  now: number,
  hours: number,
): boolean {
  return now - startedAt > hours * 60 * 60 * 1000;
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

// Hard cap on the registry. Eviction drops the oldest entry that NOBODY IS
// WAITING ON -- see enforceCap in main/agent-requests.ts for why that is the
// rule rather than "not pending".
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
  // A bell-surface kind belongs there from birth: it is an observation, not an
  // interruption, so it must not take a corner slot from a request that is
  // actually blocking an agent.
  const inBell = (r: AgentRequest) =>
    AGENT_REQUEST_POLICY[r.kind].surface === "bell" ||
    r.dismissed ||
    !isActionable(r);
  const live = newestFirst.filter((r) => !inBell(r));
  const bell = newestFirst.filter(inBell);
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
