// The Slack workspace pool, as pure rules.
//
// Connecting Slack in one project used to vault a token for THAT project only,
// so a second project meant a second browser authorization for a workspace you
// were already in. The pool makes a connected workspace reusable; the per-
// project binding keeps projects isolated unless the user says otherwise.
//
// Mirrors the Neon account pool (main/neon/accounts.ts) deliberately: same
// shape, same split of pure rules here from IO at the edge.

export interface SlackWorkspaceRef {
  // The Slack team id, from auth.test. The VERIFIED one -- never the requested
  // `workspacePin`, which may be a typo the user entered.
  id: string;
  name: string;
  domain: string;
}

// Add or refresh a workspace, keyed by team id. Re-connecting an existing
// workspace updates its label rather than adding a second row.
export function upsertWorkspace(
  pool: SlackWorkspaceRef[],
  ref: SlackWorkspaceRef,
): SlackWorkspaceRef[] {
  return [...pool.filter((w) => w.id !== ref.id), ref];
}

// The workspace a project resolves to, or null.
//
// Unlike Neon's resolver there is NO sole-account default: a project with no
// binding is not connected, however many workspaces are pooled. Auto-binding
// would quietly undo the isolation this whole feature is built to preserve.
// A binding pointing at a removed workspace also resolves to null, so a
// dangling id reads as disconnected rather than as an error.
export function resolveSlackWorkspaceId(
  bound: string | null,
  pool: SlackWorkspaceRef[],
): string | null {
  if (!bound) return null;
  return pool.some((w) => w.id === bound) ? bound : null;
}

// Stable display order. By NAME, not by recency: recency needs a timestamp the
// pool does not carry, and a list that reorders itself between visits is worse
// than one that does not.
export function sortWorkspaces(pool: SlackWorkspaceRef[]): SlackWorkspaceRef[] {
  return [...pool].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
