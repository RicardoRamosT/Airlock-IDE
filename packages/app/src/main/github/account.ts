import {
  buildCredentialHelperConfig,
  ensureCommitIdentity,
  getOrigin,
  ghAccounts,
  ghToken,
  ghUserIdentity,
  parseRemote,
  type ResolvedAccount,
  readProjectConfig,
  resolveProjectAccount,
  runGit,
  switchGhAccount,
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
    if (!id) {
      // Identity comes from `gh api user` (the account token), independent of
      // the git remote transport -- so set it for SSH-origin repos too, even
      // though token injection (tokenFor) only applies to https.
      const token = await ghToken(r.account.host, r.account.username);
      id = await ghUserIdentity(r.account.host, r.account.username, token);
      identityCache.set(key, id);
    }
    if (id) await ensureCommitIdentity(root, id);
  } catch {
    // best-effort: identity stays as-is if gh/network is unavailable
  }
}

// Install (pin) or remove (unpin) a per-repo git credential helper so this
// repo's https pushes ALWAYS use `account`'s gh token -- terminal, agent, or
// GUI -- independent of the machine's active account. https only (SSH pushes by
// key). Always unsets any prior pin first (idempotent). Best-effort per write.
export async function applyCredentialHelper(
  root: string,
  account: { host: string; username: string } | null,
): Promise<void> {
  const originUrl = await getOrigin(root).catch(() => null);
  const remote = originUrl ? parseRemote(originUrl) : null;
  // Build with the account (or a placeholder just to get the unset key list).
  const cfg = buildCredentialHelperConfig(
    account?.host ?? "github.com",
    account?.username ?? "x",
  );
  for (const key of cfg.unset) {
    await runGit(root, ["config", "--local", "--unset-all", key]).catch(
      () => {},
    );
  }
  // Unpin, or an SSH remote (token injection doesn't apply): leave it cleared.
  if (!account || remote?.protocol !== "https") return;
  for (const { key, value } of cfg.set) {
    await runGit(root, ["config", "--local", key, value]).catch(() => {});
  }
}

// On focusing a NON-PINNED project, switch the machine's active gh account to
// the project's detected account (best-effort). Skipped for pinned projects
// (source==="override" -- they carry their own credential helper) and when the
// pref is off. Never throws: focus must not fail on gh issues.
export async function autoSwitchForFocus(
  root: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  try {
    const r = await resolveFor(root);
    if (r.source === "override" || !r.account) return;
    const gh = await ghAccounts();
    const active = gh.accounts.find((a) => a.active);
    if (
      active &&
      active.host === r.account.host &&
      active.username === r.account.username
    ) {
      return; // already correct
    }
    await switchGhAccount(r.account.host, r.account.username);
  } catch {
    // best-effort
  }
}
