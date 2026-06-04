import { useState } from "react";
import { useApp } from "../store";

const COMMON_NAMES = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "SNOWFLAKE_PASSWORD",
  "SNOWFLAKE_PRIVATE_KEY",
  "JWT_SECRET",
  "GITHUB_TOKEN",
];

export function SecretModal() {
  const { modal, setModal, setSecrets, restartTerminal, config } = useApp();
  const updating =
    modal !== null && modal !== "add-secret" ? modal.update : null;
  const [name, setName] = useState(updating ?? "");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (modal === null) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = await window.airlock.secretsSet(name.trim(), value);
      if (!meta.valid) {
        setError(
          "Saved, but the value looks unusual for this name. Check the provider hint.",
        );
      } else {
        setSecrets(await window.airlock.secretsList());
        setModal(null);
        if (config?.injectSecretsIntoTerminal) restartTerminal();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">
          {updating ? `Update ${updating}` : "Add secret"}
        </div>
        {!updating && (
          <>
            <input
              className="modal-input"
              placeholder="NAME (e.g. DATABASE_URL)"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              list="common-secret-names"
              spellCheck={false}
            />
            <datalist id="common-secret-names">
              {COMMON_NAMES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </>
        )}
        <textarea
          className={`modal-input modal-value${show ? "" : " masked"}`}
          placeholder="Secret value (paste here)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
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
          This value never reaches the AI model.
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setSecrets(await window.airlock.secretsList());
              setModal(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={busy || name.trim() === "" || value === ""}
          >
            {busy ? "Saving…" : "Save to Keychain"}
          </button>
        </div>
      </div>
    </div>
  );
}
