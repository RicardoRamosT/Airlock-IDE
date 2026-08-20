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

// Which account, if any, the machine's ACTIVE gh account should be switched to
// when this project takes focus. Pure -- the caller supplies the resolution, the
// logged-in accounts, the pref, and the repo's configured commit name.
//
// A PINNED project returns null: its repo-local credential helper already
// authenticates every push as the pinned account, so moving the global active
// account buys nothing and costs a lot. Switching on focus made the ONE global
// account follow whichever project you last clicked, so a background push from
// any other project went out as the wrong user -- and it silently propped up
// pins whose helper had been clobbered, hiding the real breakage behind a
// symptom that only looked like churn.
export function autoSwitchTarget(
  resolved: ResolvedAccount,
  accounts: GhAccount[],
  enabled: boolean,
  commitName: string,
): { host: string; username: string } | null {
  if (resolved.source === "override") return null; // pinned: helper handles it
  if (!enabled) return null;

  let target = resolved.account;
  if (!target) {
    // No owner match. Fall back to the repo's commit name matching a logged-in
    // account -- what makes an ORG repo work, where origin's owner is the org
    // but `git config user.name` is the account you actually commit as.
    const name = commitName.trim().toLowerCase();
    const m = name
      ? accounts.find((a) => a.username.toLowerCase() === name)
      : undefined;
    if (m) target = { host: m.host, username: m.username };
  }
  if (!target) return null;

  const active = accounts.find((a) => a.active);
  if (active?.host === target.host && active.username === target.username) {
    return null; // already correct
  }
  return target;
}
