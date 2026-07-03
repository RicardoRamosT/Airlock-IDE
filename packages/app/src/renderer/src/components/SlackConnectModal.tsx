import { useState } from "react";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

// Connect Slack for the FOCUSED project by pasting a token. The provider
// validates it (auth.test) and vaults it main-side; the token never comes back.
// Per-project on purpose: the allow-list (the wall) is scoped to this project.
export function SlackConnectModal() {
  const setModal = useApp((s) => s.setModal);
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!token.trim() || busy || !root) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.airlock.extensionsConnect(
        root,
        "slack",
        token.trim(),
      );
      if (r.ok) {
        // Connected -> jump straight to picking the allow-listed channels (the
        // wall is what makes this useful + safe).
        setModal("slack-channels");
      } else {
        setError(r.error ?? "Could not connect.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Connect Slack</div>
        {!root ? (
          <div className="modal-caption">Open a project first.</div>
        ) : (
          <>
            <div className="modal-caption">
              Paste a Slack token (a bot or user token with{" "}
              <code>channels:read</code> + <code>channels:history</code>).
              Claude still reads ONLY the channels you allow next.
            </div>
            <textarea
              className={`modal-input modal-value${show ? "" : " masked"}`}
              placeholder="xoxb-… or xoxp-… (paste here)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              spellCheck={false}
            />
            <label className="modal-show">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
              />
              show value
            </label>
            {error && <div className="modal-error">{error}</div>}
            <div className="modal-caption">
              Stored in your macOS Keychain (per project). This token never
              reaches the AI model.
            </div>
          </>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setModal(null)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={busy || !token.trim() || !root}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
