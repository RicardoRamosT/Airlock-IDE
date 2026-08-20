import {
  autoSwitchTarget,
  buildCredentialHelperConfig,
  credentialHelperIntact,
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

// Read every value of a multi-valued local git config key, in git's own order.
// An absent key throws (exit 1) => []. An empty value is MEANINGFUL here (it is
// our reset), so only the trailing newline is stripped -- never blank entries.
async function localValues(root: string, key: string): Promise<string[]> {
  const out = await runGit(root, ["config", "--local", "--get-all", key]).catch(
    () => "",
  );
  return out === "" ? [] : out.replace(/\n$/, "").split("\n");
}

// Re-assert a pin whose credential helper no longer matches it. A pin recorded
// in .airlock/config.json is not proof of a pin in force: `gh auth setup-git`
// (which an agent reaches for the moment a push 404s) replaces our per-account
// helper with an account-agnostic one, and pins written before the helper
// existed never had one at all. Both leave the repo pushing as the machine's
// ACTIVE account while the UI still shows it pinned. Returns whether it
// repaired. Best-effort: focus must never fail on a git issue.
export async function ensurePinnedHelper(root: string): Promise<boolean> {
  try {
    const pin = (await readProjectConfig(root)).githubAccount;
    if (!pin) return false; // not pinned: nothing to assert
    const originUrl = await getOrigin(root).catch(() => null);
    const remote = originUrl ? parseRemote(originUrl) : null;
    if (remote?.protocol !== "https") return false; // ssh pushes by key
    const [helper, scoped] = await Promise.all([
      localValues(root, "credential.helper"),
      localValues(root, `credential.https://${pin.host}.helper`),
    ]);
    if (credentialHelperIntact({ helper, scoped }, pin.host, pin.username)) {
      return false;
    }
    await applyCredentialHelper(root, pin);
    return true;
  } catch {
    return false;
  }
}

// On focusing a NON-PINNED project, switch the machine's active gh account to
// the project's detected account (best-effort), gated by the pref. PINNED
// projects are skipped -- their credential helper authenticates every push on
// its own, so the global account never has to follow focus. Never throws.
export async function autoSwitchForFocus(
  root: string,
  enabled: boolean,
): Promise<void> {
  try {
    const r = await resolveFor(root);
    if (r.source === "override") return; // pinned: the helper is authoritative
    const gh = await ghAccounts();
    // The commit-name fallback only matters when the owner match came up empty.
    const commitName = r.account
      ? ""
      : await runGit(root, ["config", "user.name"]).catch(() => "");
    const target = autoSwitchTarget(r, gh.accounts, enabled, commitName);
    if (!target) return;
    await switchGhAccount(target.host, target.username);
  } catch {
    // best-effort
  }
}
