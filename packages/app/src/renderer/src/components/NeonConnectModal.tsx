import { useEffect, useState } from "react";
import type { NeonAccountRef } from "../../../shared/ipc";
import { isLikelyPostgresUrl } from "../lib/dbConnect";
import { useApp } from "../store";

// Multi-account Neon picker. Lists the connected accounts (pick one for THIS
// project, or remove it from the pool) and adds a new API key for a new account.
// Each project binds to one account; main's neon:addAccount/setProjectAccount
// bind to the focused project.
export function NeonConnectModal() {
  const setModal = useApp((s) => s.setModal);
  const [accounts, setAccounts] = useState<NeonAccountRef[]>([]);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () =>
    void window.airlock
      .neonAccounts()
      .then(setAccounts)
      .catch(() => {});
  useEffect(() => {
    void window.airlock
      .neonAccounts()
      .then((a) => {
        setAccounts(a);
        // Empty pool: nothing to pick, jump straight to adding a key.
        if (a.length === 0) setAdding(true);
      })
      .catch(() => {});
  }, []);

  const use = (id: string) =>
    void window.airlock.neonSetProjectAccount(id).then(() => setModal(null));

  const remove = (id: string) =>
    void window.airlock.neonRemoveAccount(id).then(reload);

  const add = async () => {
    const k = key.trim();
    if (!k || busy) return;
    if (isLikelyPostgresUrl(k)) {
      setError(
        'That looks like a Postgres connection string, not a Neon API key. Use "+ Add database" in the Databases section to connect with a connection string.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Adds to the pool AND binds it to this project.
      await window.airlock.neonAddAccount(k);
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
        <div className="modal-title">Neon accounts</div>
        <div className="modal-caption">
          Pick the Neon account this project uses, or add a new API key. Each
          project can use a different account.
        </div>

        {accounts.length > 0 && (
          <div className="neon-account-list">
            {accounts.map((a) => (
              <div key={a.id} className="neon-account-item">
                <button
                  type="button"
                  className="btn"
                  onClick={() => use(a.id)}
                  title={`Use ${a.label} for this project`}
                >
                  {a.label}
                </button>
                <button
                  type="button"
                  className="row-action"
                  title="Remove this account (clears its key)"
                  onClick={() => remove(a.id)}
                >
                  <i className="codicon codicon-trash" />
                </button>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <>
            <textarea
              className={`modal-input modal-value${show ? "" : " masked"}`}
              placeholder="Personal or organization Neon API key"
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
            <div className="modal-caption">
              Stored in your macOS Keychain; never reaches the AI model. A
              project-scoped key can't be added — use a personal or organization
              key.
            </div>
          </>
        ) : (
          <div className="section-toolbar">
            <button
              type="button"
              className="btn"
              onClick={() => setAdding(true)}
            >
              <i className="codicon codicon-add" /> Add API key
            </button>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setModal(null)}
            disabled={busy}
          >
            Cancel
          </button>
          {adding && (
            <button
              type="button"
              className="btn primary"
              onClick={add}
              disabled={busy || key.trim() === ""}
            >
              {busy ? "Adding…" : "Add & use"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
