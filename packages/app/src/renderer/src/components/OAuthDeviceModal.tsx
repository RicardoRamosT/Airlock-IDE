import { useEffect, useState } from "react";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// The OAuth device-flow login modal: shows a user code, sends the user to the
// provider's page to approve, and closes itself when main reports success (it
// polls in the background). No secret, no redirect -- the "log in -> connected"
// path for secret-less providers (GitHub etc.).
export function OAuthDeviceModal() {
  const setModal = useApp((s) => s.setModal);
  const dev = useApp((s) =>
    typeof s.modal === "object" && s.modal !== null && "oauthDevice" in s.modal
      ? s.modal.oauthDevice
      : null,
  );
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [code, setCode] = useState<{
    userCode: string;
    verificationUri: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const id = dev?.id ?? null;
  const name = dev?.name ?? "";

  // Begin the device flow once (per extension); main returns the code to show.
  useEffect(() => {
    if (!id || !root) return;
    let cancelled = false;
    void window.airlock
      .extensionsOAuthBegin(root, id)
      .then((r) => {
        if (!cancelled)
          setCode({ userCode: r.userCode, verificationUri: r.verificationUri });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id, root]);

  // Close on a matching success; surface the error on failure.
  useEffect(() => {
    if (!id) return;
    return window.airlock.onExtensionOAuthResult((e) => {
      if (e.id !== id) return;
      if (e.ok) setModal(null);
      else setError(e.error ?? "Login failed.");
    });
  }, [id, setModal]);

  if (!dev) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Connect {name}</div>
        {!root ? (
          <div className="modal-caption">Open a project first.</div>
        ) : (
          <>
            <div className="modal-caption">
              Open the page below in your browser and enter this code to approve
              AirLock. This window updates automatically once you do.
            </div>
            <div className="oauth-code">{code ? code.userCode : "…"}</div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={!code}
                onClick={() => {
                  if (code) void navigator.clipboard?.writeText(code.userCode);
                }}
              >
                Copy code
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!code}
                onClick={() => {
                  if (code)
                    window.airlock.hostOpenExternal(code.verificationUri);
                }}
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
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setModal(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
