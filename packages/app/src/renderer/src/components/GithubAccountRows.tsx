import { useCallback, useEffect, useState } from "react";
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

  // Reflect the CURRENT pin, so the badge is not merely optimistic. Also the
  // recovery path after a failed write: the pin installs a per-repo credential
  // helper main-side, so a badge that kept an optimistic guess would tell the
  // user their pushes use an account they do not.
  const readPin = useCallback(() => {
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

  useEffect(readPin, [readPin]);

  // A TOGGLE, not a setter. Clicking the row that is already pinned unpins it;
  // clicking a different one moves the pin (switching accounts must not require
  // unpinning first). Without the unpin arm this surface could only ever pin --
  // a second click silently re-pinned the same account, and the only way out
  // was the accounts popover, which the hub exists to save you from hunting for.
  const togglePin = (host: string, username: string) => {
    if (!root) return;
    // null is the CLEAR signal: it removes the override AND the credential
    // helper. Note a bare username would ALSO clear it -- the set form must be
    // the { host, username } object.
    const next = pinned === username ? null : { host, username };
    setPinned(next === null ? null : username);
    void window.airlock
      .setProjectGithubAccount(root, next)
      .catch((err) => {
        console.error("setProjectGithubAccount failed", err);
      })
      // Settle on what MAIN actually stored, either way -- the credential
      // helper is the real state, and the badge must not outrank it.
      .finally(readPin);
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
      {accounts.map((a) => {
        const isPinned = pinned === a.username;
        return (
          <button
            key={`${a.host}/${a.username}`}
            type="button"
            className="db-row"
            onClick={() => togglePin(a.host, a.username)}
            // A toggle has to say which way it goes: the badge alone does not
            // tell you a second click undoes it.
            aria-pressed={isPinned}
            title={
              isPinned
                ? `Unpin this project from ${a.username}`
                : `Pin this project to ${a.username}`
            }
          >
            <span className="db-name">{a.username}</span>
            {isPinned && <span className="sb-badge">pinned</span>}
          </button>
        );
      })}
    </div>
  );
}
