import {
  ensureCommitIdentity,
  getOrigin,
  ghAccounts,
  ghToken,
  ghUserIdentity,
  parseRemote,
  type ResolvedAccount,
  readProjectConfig,
  resolveProjectAccount,
} from "@airlock/agent-core";

// Resolve which account a project uses (override > auto > none) + its protocol.
export async function resolveFor(root: string): Promise<ResolvedAccount> {
  const [cfg, originUrl, gh] = await Promise.all([
    readProjectConfig(root),
    getOrigin(root),
    ghAccounts(),
  ]);
  return resolveProjectAccount(
    cfg.githubAccount,
    originUrl ? parseRemote(originUrl) : null,
    gh.accounts,
  );
}

// Token for the project's account, but only when injection applies (https).
// null => the caller runs the op with today's default behavior.
export async function tokenFor(root: string): Promise<string | null> {
  const r = await resolveFor(root);
  if (!r.account || r.protocol !== "https") return null;
  try {
    return await ghToken(r.account.host, r.account.username);
  } catch {
    return null; // logged out / no token -> fall back to default auth
  }
}

// Memoized identity per account (rarely changes within a session).
const identityCache = new Map<string, { name: string; email: string }>();

// Set the repo's commit identity to match its account. Best-effort: never throw.
export async function ensureIdentityFor(root: string): Promise<void> {
  try {
    const r = await resolveFor(root);
    if (!r.account) return;
    const key = `${r.account.host}/${r.account.username}`;
    let id = identityCache.get(key);
    if (!id && r.protocol === "https") {
      const token = await ghToken(r.account.host, r.account.username);
      id = await ghUserIdentity(r.account.host, r.account.username, token);
      identityCache.set(key, id);
    }
    if (id) await ensureCommitIdentity(root, id);
  } catch {
    // best-effort: identity stays as-is if gh/network is unavailable
  }
}
