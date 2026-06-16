import { useState } from "react";
import { isLikelyPostgresUrl, isValidSecretName } from "../lib/dbConnect";
import { useApp } from "../store";

export function AddDatabaseModal() {
  // App-global chrome acting on the FOCUSED project: use the top-level root
  // mirror (active tab's root == window root), same as SecretModal.
  const root = useApp((s) => s.root);
  const setModal = useApp((s) => s.setModal);
  const bumpDbRefresh = useApp((s) => s.bumpDbRefresh);
  const [name, setName] = useState("DATABASE_URL");
  const [connStr, setConnStr] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOk = isValidSecretName(name.trim());
  const connOk = isLikelyPostgresUrl(connStr);
  const canSubmit = nameOk && connStr.trim() !== "" && !busy;

  const submit = async () => {
    if (busy) return;
    if (!root) {
      setError("Open a folder before adding a database.");
      return;
    }
    if (!nameOk) {
      setError(
        "Name must be a valid identifier (letters, digits, underscore; not starting with a digit).",
      );
      return;
    }
    if (!connOk) {
      setError(
        "That doesn't look like a Postgres connection string (expected postgresql://user:password@host/db) — not a Neon API key.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.airlock.secretsSet(root, name.trim(), connStr.trim());
      bumpDbRefresh();
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
        <div className="modal-title">Add database</div>
        <div className="modal-caption">
          Paste a Postgres connection string to browse its tables. Works with
          Neon or any Postgres.
        </div>
        <input
          className="modal-input"
          placeholder="Name (e.g. DATABASE_URL)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
        />
        <textarea
          className={`modal-input modal-value${show ? "" : " masked"}`}
          placeholder="postgresql://user:password@host/dbname"
          value={connStr}
          onChange={(e) => setConnStr(e.target.value)}
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
          Stored in your project's encrypted vault. The password never reaches
          the AI model.
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
            disabled={!canSubmit}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
