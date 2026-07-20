import { useCallback, useEffect, useState } from "react";
import type { GithubInfo, ResolvedGithubAccount } from "../../../shared/ipc";
import { useApp } from "../store";

// onClose is owned by the footer (it renders a click-away backdrop that calls
// it). Kept in the props so the popover API is uniform with SettingsMenu.
export function AccountsPopover(_props: { onClose: () => void }) {
  const [info, setInfo] = useState<GithubInfo | null>(null);
  const [resolved, setResolved] = useState<ResolvedGithubAccount | null>(null);
  const [busy, setBusy] = useState(false);
  // The focused project's root (the popover is global, so read it from the
  // store rather than a pane context). Pin + resolve are scoped to it.
  const root = useApp((s) => s.tabState[s.activeTabId ?? ""]?.root ?? null);
  const autoSwitch = useApp((s) => s.githubAutoSwitch);
  const setAutoSwitch = useApp((s) => s.setGithubAutoSwitch);

  const refresh = useCallback(() => {
    window.airlock.githubInfo().then(setInfo).catch(console.error);
    if (root) {
      window.airlock
        .resolveGithubAccount(root)
        .then(setResolved)
        .catch(() => {
          setResolved(null);
        });
    } else {
      setResolved(null);
    }
  }, [root]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // gh auth status emits the active account first, so its order changes on
  // switch. Render in a STABLE order (host, then username) so only the dot
  // moves between rows -- the list never reshuffles.
  const orderedAccounts = info
    ? [...info.gh.accounts].sort(
        (a, b) =>
          a.host.localeCompare(b.host) ||
          a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
      )
    : [];

  const active = info?.gh.accounts.find((a) => a.active) ?? null;
  // "override" => the project is pinned to a specific account.
  const pinned = resolved?.source === "override";
  const isSsh = resolved != null && resolved.protocol !== "https";
  const mismatch =
    !pinned &&
    !!active &&
    !!info?.identity.name &&
    active.username.toLowerCase() !== info.identity.name.toLowerCase();

  const switchTo = async (host: string, username: string) => {
    setBusy(true);
    try {
      await window.airlock.githubSwitch(host, username);
      refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // Pin (account) or unpin (null) the focused project to an account: persists
  // the override AND installs/removes the per-repo credential helper main-side.
  const setPin = async (account: { host: string; username: string } | null) => {
    if (!root) return;
    setBusy(true);
    try {
      await window.airlock.setProjectGithubAccount(root, account);
      refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoSwitch = (v: boolean) => {
    setAutoSwitch(v);
    void window.airlock.prefsSet({ githubAutoSwitch: v });
  };

  return (
    <div className="popover accounts-popover">
      <div className="popover-title">GitHub accounts</div>
      {!info && <div className="popover-note">loading...</div>}
      {info && !info.gh.installed && (
        <div className="popover-note">
          GitHub CLI (gh) not found. Install it to manage accounts.
        </div>
      )}
      {info?.gh.installed && info.gh.accounts.length === 0 && (
        <div className="popover-note">
          No accounts. Run `gh auth login` in the terminal.
        </div>
      )}
      {orderedAccounts.map((a) => (
        <button
          key={`${a.host}:${a.username}`}
          type="button"
          className={`account-row${a.active ? " active" : ""}`}
          disabled={busy || a.active}
          title={a.active ? "Active account" : `Switch to ${a.username}`}
          onClick={() => switchTo(a.host, a.username)}
        >
          <span className={`status-dot${a.active ? " on" : ""}`} />
          <span className="account-name">{a.username}</span>
          <span className="account-host">{a.host}</span>
        </button>
      ))}
      {info?.identity.name && (
        <div className="identity-line">
          commits as <strong>{info.identity.name}</strong>
          {info.identity.email ? ` <${info.identity.email}>` : ""}
        </div>
      )}

      {/* Pin: bind THIS project to an account so its pushes ALWAYS use it,
          regardless of the active account or which project is focused. */}
      {root && info?.gh.installed && (
        <div className="account-pin">
          {pinned && resolved?.account ? (
            <>
              <span className="section-note">
                Pinned to <strong>{resolved.account.username}</strong> for this
                project
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setPin(null)}
              >
                Unpin
              </button>
            </>
          ) : active ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              title={`Always use ${active.username} for this project's git`}
              onClick={() =>
                setPin({ host: active.host, username: active.username })
              }
            >
              Pin {active.username} to this project
            </button>
          ) : null}
          {isSsh && (
            <span className="section-note">
              SSH remote — pin sets commit identity only (push uses your SSH
              key).
            </span>
          )}
        </div>
      )}

      {/* Non-pinned projects follow focus: switch the active account to match. */}
      <label className="account-toggle">
        <input
          type="checkbox"
          checked={autoSwitch}
          onChange={(e) => toggleAutoSwitch(e.target.checked)}
        />
        Auto-switch account to match the project
      </label>

      {mismatch && (
        <div className="identity-warning">
          <i className="codicon codicon-warning" /> active account (
          {active?.username}) doesn&rsquo;t match this repo
          {root && active && (
            <div className="section-toolbar">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  setPin({ host: active.host, username: active.username })
                }
              >
                Pin
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
