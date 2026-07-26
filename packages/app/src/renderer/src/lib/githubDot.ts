import type { GithubInfo, ResolvedGithubAccount } from "../../../shared/ipc";

// The status dot on the rail's Accounts button: at a glance, is the GitHub
// account that will actually be used for the FOCUSED project the right one for
// that repo?
//
//   green  -- yes. Either the project is PINNED (its repo-local credential
//             helper serves the pinned account's token for every push, so the
//             machine's active account is irrelevant -- pinned repos are immune),
//             or the account auto-detected for this repo IS the active one.
//   yellow -- no. The repo resolves to one account but a DIFFERENT one is
//             active, so a terminal push would use the wrong account -- the
//             GitHub "404 repo not found" trap. Pin (or switch) to fix.
//   null   -- nothing to report: gh isn't installed, no project is focused, or
//             the repo has no resolvable account (no remote, or an org repo with
//             no matching login). Deliberately NOT yellow: "unknown" must not
//             read as "wrong", or the dot cries wolf on every unrelated repo.
export type GithubDot = { level: "green" | "yellow"; title: string } | null;

const same = (
  a: { host: string; username: string },
  b: { host: string; username: string },
): boolean =>
  a.host === b.host &&
  a.username.toLowerCase() === b.username.toLowerCase();

export function githubAccountDot(
  info: GithubInfo | null,
  resolved: ResolvedGithubAccount | null,
): GithubDot {
  if (!info?.gh.installed) return null;
  // source "none" (or a null account) means we could not tell which account this
  // repo wants -- report nothing rather than a false alarm.
  if (!resolved || resolved.source === "none" || !resolved.account) return null;
  const want = resolved.account;

  if (resolved.source === "override") {
    // An SSH remote authenticates by key, so the pin governs the commit identity
    // only -- say so rather than implying it controls the push.
    return {
      level: "green",
      title:
        resolved.protocol === "ssh"
          ? `GitHub: pinned to ${want.username} (SSH remote — sets commit identity)`
          : `GitHub: pinned to ${want.username} for this project`,
    };
  }

  const active = info.gh.accounts.find((a) => a.active) ?? null;
  if (active && same(active, want))
    return {
      level: "green",
      title: `GitHub: ${active.username} matches this repo`,
    };
  return {
    level: "yellow",
    title: active
      ? `GitHub: ${active.username} is active but this repo wants ${want.username} — pin it to fix`
      : `GitHub: no active account; this repo wants ${want.username}`,
  };
}
