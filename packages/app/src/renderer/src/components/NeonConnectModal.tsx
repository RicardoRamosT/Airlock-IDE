import { useState } from "react";
import { isLikelyPostgresUrl } from "../lib/dbConnect";
import { useApp } from "../store";

export function NeonConnectModal() {
  const setModal = useApp((s) => s.setModal);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!key.trim() || busy) return;
    if (isLikelyPostgresUrl(key.trim())) {
      setError(
        'That looks like a Postgres connection string, not a Neon API key. Use "+ Add database" in the Databases section to connect with a connection string.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.airlock.neonConnect(key.trim());
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Connect Neon</div>
        <div className="modal-caption">
          Paste a <strong>personal</strong> Neon API key (Neon Console → Account
          settings → API keys). A <em>project-scoped</em> key won't work —
          AirLock lists your organizations and projects, which only an
          account-level key can do.
        </div>
        <textarea
          className={`modal-input modal-value${show ? "" : " masked"}`}
          placeholder="Personal Neon API key (paste here)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
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
          Stored in your macOS Keychain. This key never reaches the AI model.
        </div>
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
            disabled={busy || key.trim() === ""}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
