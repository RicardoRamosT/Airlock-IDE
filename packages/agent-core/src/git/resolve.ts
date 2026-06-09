import type { GhAccount } from "../github/accounts";
import type { ParsedRemote } from "./remote";

export interface ResolvedAccount {
  account: { host: string; username: string } | null;
  source: "override" | "auto" | "none";
  protocol: "https" | "ssh" | "unknown";
}

// Resolve a project's account: a valid override wins; else auto-detect by
// matching the origin owner to a logged-in login; else none. Pure -- the caller
// supplies the override (from config), the parsed origin, and gh accounts.
export function resolveProjectAccount(
  override: { host: string; username: string } | undefined,
  remote: ParsedRemote | null,
  accounts: GhAccount[],
): ResolvedAccount {
  const protocol = remote?.protocol ?? "unknown";
  const known = (host: string, username: string) =>
    accounts.some((a) => a.host === host && a.username === username);

  if (override && known(override.host, override.username)) {
    return { account: { ...override }, source: "override", protocol };
  }
  if (remote) {
    const match = accounts.find(
      (a) => a.host === remote.host && a.username === remote.owner,
    );
    if (match) {
      return {
        account: { host: match.host, username: match.username },
        source: "auto",
        protocol,
      };
    }
  }
  return { account: null, source: "none", protocol };
}
