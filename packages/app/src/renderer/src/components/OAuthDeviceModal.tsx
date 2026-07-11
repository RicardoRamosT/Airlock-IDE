import { useCallback, useEffect, useState } from "react";
import type { OAuthBeginResult } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// The secret-less OAuth login modal. Two flows, chosen by what main returns:
//   - "device": show a user code to enter at the provider's page (GitHub).
//   - "browser": the system browser is opening to the consent screen (Slack, via
//     the broker). For the broker flow the user can also pin WHICH workspace to
//     sign in to (Slack's `team`): a field pre-filled from saved config, persisted
//     before (re)opening the browser.
// Opened in two modes: a normal Connect (auto-begins) or "manage" (from a
// connected row's "Change workspace" -> shows the current workspace + field and
// waits for the user to open the browser).
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
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [includePrivate, setIncludePrivateState] = useState(false);

  const id = dev?.id ?? null;
  const name = dev?.name ?? "";
  const manage = dev?.manage === true;

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

  // Load saved workspace config to pre-fill the field + show the current one.
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
        setCurrent(typeof ws.name === "string" && ws.name ? ws.name : null);
        setIncludePrivateState(cfg.includePrivate === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, root]);

  // Connect mode auto-begins; manage mode waits for the user to open the browser.
  useEffect(() => {
    if (!manage) begin();
  }, [manage, begin]);

  // Close on a matching success; surface the error on failure.
  useEffect(() => {
    if (!id) return;
    return window.airlock.onExtensionOAuthResult((e) => {
      if (e.id !== id) return;
      if (e.ok) setModal(null);
      else setError(e.error ?? "Login failed.");
    });
  }, [id, setModal]);

  // Persist the chosen workspace, then (re)open the browser pinned to it.
  const openWithWorkspace = useCallback(async () => {
    if (!id || !root) return;
    try {
      await window.airlock.extensionsSetConfig(root, id, {
        workspacePin: pin.trim(),
      });
    } catch {
      /* a failed save shouldn't block the attempt */
    }
    begin();
  }, [id, root, pin, begin]);

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

  const showWorkspace = manage || begun?.kind === "browser";

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
                {error ? (
                  <div className="modal-error">{error}</div>
                ) : (
                  <div className="modal-caption">Waiting for approval…</div>
                )}
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
                {error ? (
                  <div className="modal-error">{error}</div>
                ) : (
                  <div className="modal-caption">Waiting for approval…</div>
                )}
              </>
            )}
            {!begun && !manage && !error && (
              <div className="modal-caption">Starting sign-in…</div>
            )}
            {!begun && !manage && error && (
              <div className="modal-error">{error}</div>
            )}
            {showWorkspace && (
              <div className="oauth-workspace">
                {id === "slack" && (
                  <>
                    <label className="oauth-optin">
                      <input
                        type="checkbox"
                        checked={includePrivate}
                        onChange={(e) =>
                          void setIncludePrivate(e.target.checked)
                        }
                      />
                      Include private channels, DMs &amp; group DMs
                    </label>
                    <div className="section-note">
                      {includePrivate
                        ? "Your Slack app must declare the groups/im/mpim scopes. Reopen the browser to apply."
                        : "Default: public channels only."}
                    </div>
                  </>
                )}
                <div className="modal-caption">
                  {manage
                    ? "Enter the workspace's Team ID (T0123ABCD) or paste your Slack URL."
                    : "Wrong workspace? Enter its Team ID (T0123ABCD) or paste your Slack URL."}
                </div>
                <input
                  className="sb-control"
                  type="text"
                  placeholder="T0123ABCD or app.slack.com/client/T…"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void openWithWorkspace()}
                >
                  {manage && !begun
                    ? "Open browser to switch"
                    : "Reopen browser"}
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
