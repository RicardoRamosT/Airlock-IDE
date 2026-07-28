import { useEffect, useState } from "react";
import type { GhAccount } from "../../../shared/ipc";

import { Loading } from "./Loading";
// The gh accounts, and a one-click pin, inside the GitHub extension pane.
//
// NO new storage and NO new pinning logic: `gh` owns the accounts, and
// github:setProjectAccount is the one path that also installs the local
// credential helper (see the GitHub-account-per-project design). A second
// route that pinned without it is precisely how a project ends up pushing as
// the wrong account, so this calls the same IPC the accounts popover does.
//
// A GitHub account is IDENTITY -- who you are -- so it is reused across
// projects by nature, which is why the hub surfaces the switch at all. The
// pool already exists; the hub was simply the one place that could not reach
// it.
export function GithubAccountRows({ root }: { root: string | null }) {
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => {
    void window.airlock
      .githubInfo()
      .then((i) => setAccounts(i?.gh?.accounts ?? []))
      .catch(() => setAccounts([]));
  }, []);

  // Reflect the CURRENT pin, so the badge is not merely optimistic.
  useEffect(() => {
    if (!root) return;
    void window.airlock
      .resolveGithubAccount(root)
      .then((r) =>
        setPinned(
          r?.source === "override" ? (r.account?.username ?? null) : null,
        ),
      )
      .catch(() => setPinned(null));
  }, [root]);

  const pin = (host: string, username: string) => {
    if (!root) return;
    setPinned(username);
    // Two arguments, and the second is an OBJECT. Passing a bare username, or
    // null, would CLEAR the pin instead of setting it.
    void window.airlock.setProjectGithubAccount(root, { host, username });
  };

  if (!root)
    return (
      <div className="section-note">Open a project to pin an account.</div>
    );
  if (accounts === null) return <Loading label="Loading GitHub accounts" />;
  if (accounts.length === 0)
    return (
      <div className="section-note">
        No GitHub accounts — run `gh auth login`.
      </div>
    );

  return (
    <div className="gh-account-rows">
      {accounts.map((a) => (
        <button
          key={`${a.host}/${a.username}`}
          type="button"
          className="db-row"
          onClick={() => pin(a.host, a.username)}
          title={`Pin this project to ${a.username}`}
        >
          <span className="db-name">{a.username}</span>
          {pinned === a.username && <span className="sb-badge">pinned</span>}
        </button>
      ))}
    </div>
  );
}
