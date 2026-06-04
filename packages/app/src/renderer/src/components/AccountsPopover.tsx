import { useCallback, useEffect, useState } from "react";
import type { GithubInfo } from "../../../shared/ipc";

// onClose is owned by the footer (it renders a click-away backdrop that calls
// it). Kept in the props so the popover API is uniform with SettingsMenu.
export function AccountsPopover(_props: { onClose: () => void }) {
  const [info, setInfo] = useState<GithubInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    window.airlock.githubInfo().then(setInfo).catch(console.error);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // gh auth status emits the active account first, so its order changes on
  // switch. Render in a STABLE order (host, then username) so only the dot
  // moves between rows -- the list never reshuffles. Row keys are stable per
  // account, so React keeps the same DOM nodes; just the .active dot changes.
  const orderedAccounts = info
    ? [...info.gh.accounts].sort(
        (a, b) =>
          a.host.localeCompare(b.host) ||
          a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
      )
    : [];

  const active = info?.gh.accounts.find((a) => a.active) ?? null;
  const mismatch =
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
      {mismatch && (
        <div className="identity-warning">
          <i className="codicon codicon-warning" /> active GitHub account (
          {active?.username}) does not match this repo's commit name
        </div>
      )}
    </div>
  );
}
