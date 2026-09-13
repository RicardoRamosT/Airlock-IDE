// The confirm that stands between you and the app's other security posture.
//
// This setting is the one AirLock's threat model calls "the most important
// thing in this document": with it on, every vaulted value is placed in every
// terminal's environment at spawn, and output redaction does not apply on that
// path at all -- the agent sharing that terminal reads its own environment with
// nothing in between.
//
// It used to be a 12px --fg-dim checkbox, dimmer than the text around it and
// visually identical to the "Enabled" toggle in the extensions pane. The first
// fix put the consequence permanently in the sidebar, which is three lines of
// prose in a 230px panel -- exactly what the rest of this pass removed.
//
// So the weight lives HERE instead. The point of decision is not the sidebar,
// it is the moment you turn it on, and a modal you must dismiss gets more
// attention than a paragraph you stop seeing after a week. It also matches the
// app's own rule: a USER-initiated dialog is modal, only agent-initiated
// prompts go to the corner.
//
// ENABLE ONLY. Turning it off restores the default posture, which is safe, so
// that direction never asks.
export function InjectSecretsModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Put secrets in every terminal?</div>
        <div className="modal-caption">
          Every terminal in this project starts with your vaulted values in its
          environment, and{" "}
          <strong className="modal-warn">
            redaction does not apply to them
          </strong>
          . A Claude session sharing that terminal can read them directly,
          <code>echo $DATABASE_URL</code> returns the value in plain text.
          <br />
          <br />
          Turn this on for long-lived processes that need a credential for their
          whole life, like a dev server. You can turn it off again at any time.
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            Turn on
          </button>
        </div>
      </div>
    </div>
  );
}
