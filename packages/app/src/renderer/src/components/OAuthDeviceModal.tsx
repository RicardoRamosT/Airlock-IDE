import { useCallback, useEffect, useState } from "react";
import type {
  OAuthBeginResult,
  SlackWorkspaceOption,
} from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// The secret-less OAuth login modal. Two flows, chosen by what main returns:
//   - "device": show a user code to enter at the provider's page (GitHub).
//   - "browser": the system browser is opening to the consent screen (Slack, via
//     the broker).
//
// Slack gets a WORKSPACE CHOOSER and deliberately does NOT auto-open the
// browser: choosing has to happen BEFORE the approval page opens, or Slack
// authorizes whichever workspace the browser session is signed into. Rows come
// from the local Slack desktop app; a browser-only workspace it has never seen
// goes through the paste-a-URL fallback. Every other provider keeps the old
// straight-to-browser behavior.
// Opened in two modes: a normal Connect or "manage" (from a connected row's
// "Change workspace").
export function OAuthDeviceModal() {
  const setModal = useApp((s) => s.setModal);
  const dev = useApp((s) =>
    typeof s.modal === "object" && s.modal !== null && "oauthDevice" in s.modal
      ? s.modal.oauthDevice
      : null,
  );
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [begun, setBegun] = useState<OAuthBeginResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The selected team id (a picker row), and the free-text fallback. Typing in
  // the fallback clears the selection: exactly one of them wins.
  const [pin, setPin] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<SlackWorkspaceOption[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [includePrivate, setIncludePrivateState] = useState(false);

  const id = dev?.id ?? null;
  const name = dev?.name ?? "";
  const manage = dev?.manage === true;
  // Only Slack has a workspace to choose.
  const chooser = id === "slack";

  // Start (or restart) the flow; main reads the persisted workspace pin.
  const begin = useCallback(() => {
    if (!id || !root) return;
    setBegun(null);
    setError(null);
    void window.airlock
      .extensionsOAuthBegin(root, id)
      .then((r) => setBegun(r))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, root]);

  // Load saved workspace config to pre-select the row / pre-fill the fallback.
  useEffect(() => {
    if (!id || !root) return;
    let cancelled = false;
    void window.airlock
      .extensionsGetConfig(root, id)
      .then((cfg) => {
        if (cancelled) return;
        const ws =
          cfg.workspace && typeof cfg.workspace === "object"
            ? (cfg.workspace as { id?: unknown; name?: unknown })
            : {};
        const pinCfg =
          typeof cfg.workspacePin === "string" ? cfg.workspacePin : "";
        const wsId = typeof ws.id === "string" ? ws.id : "";
        setPin(pinCfg || wsId);
        setPaste(pinCfg || wsId);
        setCurrent(typeof ws.name === "string" && ws.name ? ws.name : null);
        setIncludePrivateState(cfg.includePrivate === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, root]);

  // Workspaces the local Slack app knows about. [] is a normal outcome.
  useEffect(() => {
    if (!chooser) return;
    let cancelled = false;
    void window.airlock
      .slackLocalWorkspaces()
      .then((w) => {
        if (!cancelled) setWorkspaces(w);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chooser]);

  // Auto-begin only where there is nothing to choose first.
  useEffect(() => {
    if (!manage && !chooser) begin();
  }, [manage, chooser, begin]);

  // Close on a matching success; surface the error on failure.
  useEffect(() => {
    if (!id) return;
    return window.airlock.onExtensionOAuthResult((e) => {
      if (e.id !== id) return;
      if (e.ok) setModal(null);
      else setError(e.error ?? "Login failed.");
    });
  }, [id, setModal]);

  const selected = workspaces.find((w) => w.id === pin) ?? null;
  // The fallback opens on request, when there is no picker to use, or when a
  // saved pin matches no row -- otherwise "open" would silently drop that pin.
  const showPaste =
    pasteOpen || workspaces.length === 0 || (!!paste && !selected);

  // Persist the chosen workspace, then (re)open the browser pinned to it.
  // A picker row carries all three fields; pasted text carries only itself, and
  // main parses it (parseWorkspaceInput) on the way to the authorize URL.
  const openWithWorkspace = useCallback(async () => {
    if (!id || !root) return;
    const patch = selected
      ? {
          workspacePin: selected.id,
          workspacePinDomain: selected.domain,
          workspacePinName: selected.name,
        }
      : {
          workspacePin: paste.trim(),
          workspacePinDomain: "",
          workspacePinName: "",
        };
    try {
      await window.airlock.extensionsSetConfig(root, id, patch);
    } catch {
      /* a failed save shouldn't block the attempt */
    }
    begin();
  }, [id, root, selected, paste, begin]);

  // Persist the private-access opt-in immediately (merged into the slack config).
  // It gates the scopes the NEXT begin() requests -- the user reopens the browser
  // to mint a token with the new scopes.
  const setIncludePrivate = useCallback(
    async (v: boolean) => {
      setIncludePrivateState(v);
      if (!id || !root) return;
      try {
        await window.airlock.extensionsSetConfig(root, id, {
          includePrivate: v,
        });
      } catch {
        /* a failed save shouldn't block toggling */
      }
    },
    [id, root],
  );

  if (!dev) return null;

  const openLabel = begun
    ? "Reopen browser"
    : manage
      ? "Open browser to switch"
      : `Open ${name} to approve`;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">
          {manage ? `Change ${name} workspace` : `Connect ${name}`}
        </div>
        {!root ? (
          <div className="modal-caption">Open a project first.</div>
        ) : (
          <>
            {manage && !begun && (
              <div className="modal-caption">
                Current workspace: {current ?? "unknown"}
              </div>
            )}
            {begun?.kind === "browser" && (
              <>
                <div className="modal-caption">
                  Opening your browser to sign in to {name}. Approve there and
                  this window updates automatically.
                </div>
                <div className="modal-caption">Waiting for approval…</div>
              </>
            )}
            {begun?.kind === "device" && (
              <>
                <div className="modal-caption">
                  Open the page below in your browser and enter this code to
                  approve AirLock. This window updates automatically once you
                  do.
                </div>
                <div className="oauth-code">{begun.userCode}</div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void navigator.clipboard?.writeText(begun.userCode)
                    }
                  >
                    Copy code
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      window.airlock.hostOpenExternal(begun.verificationUri)
                    }
                  >
                    Open {name} to sign in
                  </button>
                </div>
                {!error && (
                  <div className="modal-caption">Waiting for approval…</div>
                )}
              </>
            )}
            {!begun && !manage && !chooser && !error && (
              <div className="modal-caption">Starting sign-in…</div>
            )}
            {error && <div className="modal-error">{error}</div>}
            {chooser && (
              <div className="oauth-workspace">
                <label className="oauth-optin">
                  <input
                    type="checkbox"
                    checked={includePrivate}
                    onChange={(e) => void setIncludePrivate(e.target.checked)}
                  />
                  Include private channels, DMs &amp; group DMs
                </label>
                <div className="section-note">
                  {includePrivate
                    ? "Your Slack app must declare the groups/im/mpim scopes. Reopen the browser to apply."
                    : "Default: public channels only."}
                </div>
                <div className="modal-caption">
                  Choose a workspace — AirLock will open Slack's approval page
                  there.
                </div>
                {workspaces.length > 0 ? (
                  <>
                    <div className="oauth-ws-list">
                      {workspaces.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`oauth-ws-row${w.id === pin ? " on" : ""}`}
                          aria-pressed={w.id === pin}
                          onClick={() => setPin(w.id)}
                        >
                          <span>{w.name}</span>
                          <span className="oauth-ws-domain">
                            {w.domain}.slack.com
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="oauth-ws-more"
                      onClick={() => setPasteOpen((v) => !v)}
                    >
                      Not listed? Paste your Slack URL
                    </button>
                  </>
                ) : (
                  // Not an error: a machine without the Slack app, or a
                  // browser-only workspace, is exactly what the fallback is for.
                  <div className="section-note">
                    No local Slack workspaces found — paste your Slack URL
                    below.
                  </div>
                )}
                {showPaste && (
                  <input
                    className="sb-control"
                    type="text"
                    placeholder="acme.slack.com or T0123ABCD"
                    value={paste}
                    onChange={(e) => {
                      setPaste(e.target.value);
                      setPin("");
                    }}
                  />
                )}
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void openWithWorkspace()}
                >
                  {openLabel}
                </button>
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setModal(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
