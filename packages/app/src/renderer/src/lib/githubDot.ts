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
//   grey   -- UNKNOWN, shown "deactivated": gh isn't installed, no project is
//             focused, or the repo has no resolvable account (no remote, or an
//             org repo with no matching login). Deliberately not yellow --
//             "unknown" must not read as "wrong" -- but still a dot, so the
//             button's state is always legible instead of silently absent.
//
// `title` is a SUFFIX phrase: the rail renders it as "Accounts -- <title>", the
// same "label -- status" tooltip shape the section icons use, so the button keeps
// saying what it does while also reporting state.
export type GithubDot = { level: "green" | "yellow" | "grey"; title: string };

// Grey placeholders for the states the pure comparison can't speak to: before the
// first read lands, and when the read itself failed.
export const GH_DOT_CHECKING: GithubDot = {
  level: "grey",
  title: "checking account…",
};
export const GH_DOT_UNAVAILABLE: GithubDot = {
  level: "grey",
  title: "account status unavailable",
};

const same = (
  a: { host: string; username: string },
  b: { host: string; username: string },
): boolean =>
  a.host === b.host && a.username.toLowerCase() === b.username.toLowerCase();

export function githubAccountDot(
  info: GithubInfo | null,
  resolved: ResolvedGithubAccount | null,
): GithubDot {
  if (!info) return GH_DOT_CHECKING;
  if (!info.gh.installed)
    return { level: "grey", title: "GitHub CLI (gh) not found" };
  // source "none" (or a null account) means we could not tell which account this
  // repo wants -- stay grey rather than raise a false alarm.
  if (!resolved || resolved.source === "none" || !resolved.account)
    return {
      level: "grey",
      title: "no account resolved for this project",
    };
  const want = resolved.account;

  if (resolved.source === "override") {
    // An SSH remote authenticates by key, so the pin governs the commit identity
    // only -- say so rather than implying it controls the push.
    return {
      level: "green",
      title:
        resolved.protocol === "ssh"
          ? `pinned to ${want.username} (SSH remote — sets commit identity)`
          : `pinned to ${want.username} for this project`,
    };
  }

  const active = info.gh.accounts.find((a) => a.active) ?? null;
  if (active && same(active, want))
    return {
      level: "green",
      title: `${active.username} matches this repo`,
    };
  return {
    level: "yellow",
    title: active
      ? `${active.username} is active but this repo wants ${want.username} — pin it to fix`
      : `no active account; this repo wants ${want.username}`,
  };
}
