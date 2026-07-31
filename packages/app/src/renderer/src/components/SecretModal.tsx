import { useEffect, useState } from "react";
import { useVaultSecret } from "../lib/useVaultSecret";
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

// USER-INITIATED vaulting only: "Add secret" and "Update <name>". Agent-initiated
// requests do NOT come here any more -- they render as non-blocking cards in the
// corner (AgentRequestStack), because a dialog the user did not ask for should
// not seize the window. The keychain write itself goes through useVaultSecret,
// the one save path shared with those cards.
export function SecretModal() {
  // The modal is app-global chrome that acts on the FOCUSED project, so it uses
  // the active tab's root (the top-level mirror) -- which equals the window
  // root, so resolveRoot resolves it identically.
  const { modal, setModal, root } = useApp();
  const updating =
    typeof modal === "object" && modal !== null && "update" in modal
      ? modal.update
      : null;
  const { save, busy } = useVaultSecret();
  const [name, setName] = useState(updating ?? "");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // UPDATE mode pre-fill: fetch the CURRENT value so the user can see and tweak
  // it instead of overwriting blind. true only while that fetch is in flight.
  // The initializer is correct because App.tsx keys <SecretModal/> per open (and
  // unmounts it on close), so every open is a fresh mount -- if that
  // remount-per-open contract ever changes, this must become an effect.
  const [loading, setLoading] = useState(updating !== null);

  // secretsReveal is the same owner-triggered, audited (secret.reveal) IPC the
  // row's Reveal uses -- the value enters the renderer through the existing door
  // with the same audit trail. A missing keychain entry (null) leaves the field
  // empty, which is the pre-existing lost-value behavior.
  useEffect(() => {
    if (!updating || !root) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    window.airlock
      .secretsReveal(root, updating)
      .then((v) => {
        if (!cancelled) setValue(v ?? "");
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            `Could not load current value: ${err instanceof Error ? err.message : String(err)}`,
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [updating, root]);

  if (modal === null) return null;

  const submit = async () => {
    if (!root) {
      setError("Open a folder before vaulting a secret.");
      return;
    }
    setError(null);
    const r = await save(root, name, value);
    if (!r.ok) {
      setError(r.error ?? "Could not save.");
      return;
    }
    // Saved either way. On a suspicious value keep the dialog open with the
    // warning so the user can correct it; the secret IS vaulted regardless.
    if (r.warning) setError(r.warning);
    else setModal(null);
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
          placeholder={
            loading ? "Loading current value…" : "Secret value (paste here)"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          spellCheck={false}
          disabled={loading}
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
            onClick={() => setModal(null)}
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
