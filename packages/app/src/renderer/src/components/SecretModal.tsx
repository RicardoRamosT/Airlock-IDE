import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { restartActiveTerminal } from "../lib/restartActiveTerminal";
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
  const { modal, setModal, setSecrets, config } = useApp();
  const updating =
    typeof modal === "object" && modal !== null && "update" in modal
      ? modal.update
      : null;
  // Agent-requested mode: main pushed agent:request-secret and an agent is
  // awaiting the round-trip. The name is fixed (the agent specified it) and the
  // outcome MUST be reported back so the agent is never stranded.
  const requested =
    typeof modal === "object" && modal !== null && "requestSecret" in modal
      ? modal.requestSecret
      : null;
  const [name, setName] = useState(requested?.name ?? updating ?? "");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Resolve the awaiting agent exactly once: a save OR a cancel/backdrop/Escape
  // flips this, and every dismissal path checks it first so a request can never
  // be resolved twice (the second resolve would be a no-op main-side, but
  // guarding here keeps the contract explicit).
  const resolvedRef = useRef(false);

  // Report not-vaulted, then close. Used by Cancel, backdrop click, and Escape
  // in requested mode. No-op once already resolved (saved or cancelled). Stable
  // (useCallback) so the Escape effect can depend on it without re-subscribing.
  const cancelRequested = useCallback(async () => {
    if (!requested || resolvedRef.current) return;
    resolvedRef.current = true;
    await window.airlock.requestSecretResolve(requested.requestId, false);
    setModal(null);
  }, [requested, setModal]);

  // Escape dismisses the modal in requested mode (reporting not-vaulted). Only
  // wired for requested mode so the non-requested modal's behavior is unchanged.
  useEffect(() => {
    if (!requested) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void cancelRequested();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requested, cancelRequested]);

  if (modal === null) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = await window.airlock.secretsSet(name.trim(), value);
      // Requested mode: secretsSet RESOLVED, so the keychain write happened --
      // the agent's request is fulfilled even if the value looks unusual. Report
      // vaulted:true and close; do NOT keep the modal open on the !valid warning
      // (the agent is awaiting -- never strand it).
      if (requested) {
        resolvedRef.current = true;
        await window.airlock.requestSecretResolve(requested.requestId, true);
        setSecrets(await window.airlock.secretsList());
        setModal(null);
        // A newly vaulted secret only reaches the shell on spawn, so replace the
        // active terminal when injection is on.
        if (config?.injectSecretsIntoTerminal) restartActiveTerminal();
        return;
      }
      if (!meta.valid) {
        setError(
          "Saved, but the value looks unusual for this name. Check the provider hint.",
        );
      } else {
        setSecrets(await window.airlock.secretsList());
        setModal(null);
        // A newly vaulted secret only reaches the shell on spawn, so replace
        // the active terminal when injection is on.
        if (config?.injectSecretsIntoTerminal) restartActiveTerminal();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Backdrop click (the overlay itself, not the modal body) dismisses in
  // requested mode -- reporting not-vaulted. The target check avoids needing a
  // stopPropagation handler on the modal body. Keyboard dismissal is the Escape
  // effect above. Only active in requested mode (undefined otherwise) so the
  // non-requested modal cannot be backdrop-dismissed (behavior unchanged).
  const onBackdrop = requested
    ? (e: MouseEvent) => {
        if (e.target === e.currentTarget) void cancelRequested();
      }
    : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a dismiss affordance, not a control
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is handled by the global Escape effect above
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal">
        <div className="modal-title">
          {requested
            ? `Vault ${requested.name}`
            : updating
              ? `Update ${updating}`
              : "Add secret"}
        </div>
        {requested ? (
          <input
            className="modal-input"
            value={name}
            readOnly
            spellCheck={false}
          />
        ) : (
          !updating && (
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
          )
        )}
        {requested && (
          <div className="modal-caption">
            Claude is requesting this secret to use on your behalf. It is
            vaulted in your keychain; Claude never sees the value.
            {requested.providerHint ? ` Hint: ${requested.providerHint}` : ""}
          </div>
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
              if (requested) {
                await cancelRequested();
                return;
              }
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
