import { useEffect, useState } from "react";
import type { OAuthBeginResult } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// The secret-less OAuth login modal. Two flows, chosen by what main returns:
//   - "device": show a user code to enter at the provider's page (GitHub).
//   - "browser": the system browser is opening to the consent screen; there's
//     nothing to type -- just wait for the airlock:// callback (Slack, via the
//     broker).
// Either way the flow finishes in the background and this closes itself when
// main reports success. No secret, no redirect handled here.
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

  const id = dev?.id ?? null;
  const name = dev?.name ?? "";

  // Begin the flow once (per extension); main returns how to complete it.
  useEffect(() => {
    if (!id || !root) return;
    let cancelled = false;
    setBegun(null);
    setError(null);
    void window.airlock
      .extensionsOAuthBegin(root, id)
      .then((r) => {
        if (!cancelled) setBegun(r);
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
        ) : !begun ? (
          error ? (
            <div className="modal-error">{error}</div>
          ) : (
            <div className="modal-caption">Starting sign-in…</div>
          )
        ) : begun.kind === "browser" ? (
          // Broker flow: the browser is already opening; nothing to type.
          <>
            <div className="modal-caption">
              Opening your browser to sign in to {name}. Approve there and this
              window updates automatically.
            </div>
            {error ? (
              <div className="modal-error">{error}</div>
            ) : (
              <div className="modal-caption">Waiting for approval…</div>
            )}
          </>
        ) : (
          // Device flow: show the code to enter at the provider's page.
          <>
            <div className="modal-caption">
              Open the page below in your browser and enter this code to approve
              AirLock. This window updates automatically once you do.
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
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setModal(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
