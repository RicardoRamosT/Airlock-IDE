import { type MouseEvent, useCallback, useEffect, useRef } from "react";
import { useApp } from "../store";

// Approval modal for the send_terminal_input MCP tool. Main pushes
// agent:terminal-grant-request (usePrefs sets modal.grantTerminal); the user's
// Allow/Deny is reported back via terminalGrantResolve so the awaiting agent is
// never stranded. Allowing grants this pty for the rest of the session.
export function TerminalGrantModal() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  const grant =
    typeof modal === "object" && modal !== null && "grantTerminal" in modal
      ? modal.grantTerminal
      : null;
  const resolvedRef = useRef(false);

  // The terminal's own title for nicer copy (looked up once by pty id; falls back
  // to "a terminal"). Non-reactive read: the modal is keyed per request, so a
  // one-time read at mount is correct and avoids re-rendering on title churn.
  const title = grant
    ? (() => {
        const tabs = useApp.getState().tabTerminals;
        for (const tt of Object.values(tabs))
          for (const t of tt.terminals)
            if (t.ptyId === grant.ptyId) return t.title;
        return "a terminal";
      })()
    : "a terminal";

  const respond = useCallback(
    (granted: boolean) => {
      if (!grant || resolvedRef.current) return;
      resolvedRef.current = true;
      void window.airlock.terminalGrantResolve(grant.requestId, granted);
      setModal(null);
    },
    [grant, setModal],
  );

  useEffect(() => {
    if (!grant) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") respond(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [grant, respond]);

  if (!grant) return null;

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) respond(false);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a dismiss affordance, not a control
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is handled by the global Escape effect above
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal">
        <div className="modal-title">
          Allow Claude to control this terminal?
        </div>
        <div className="modal-caption">
          Claude wants to send input to <strong>{title}</strong> in project{" "}
          <strong>{grant.label}</strong>.
        </div>
        <div className="modal-caption">
          To send: <code>{grant.preview || "(empty)"}</code>
        </div>
        <div className="modal-caption">
          If you allow, then for the rest of this session Claude can type
          anything into this terminal — including commands that run with this
          project's injected secrets, read/move files, and drive other Claude
          sessions. Only allow terminals you trust this agent to operate.
        </div>
        <div className="modal-caption">
          AirLock is provided as-is, without warranty; you are responsible for
          any actions you authorize here.
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => respond(false)}>
            Deny
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => respond(true)}
          >
            Allow for this terminal
          </button>
        </div>
      </div>
    </div>
  );
}
