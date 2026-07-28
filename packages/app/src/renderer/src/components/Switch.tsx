// An on/off switch.
//
// A checkbox is the wrong control for a setting that takes effect immediately:
// checkboxes read as "select these, then submit", while a switch reads as a
// thing that is currently ON or OFF. The extension panes' Enabled / Show-in
// settings apply the moment they change, so they get a switch.
//
// It is a REAL <input type="checkbox"> underneath, hidden visually but not from
// assistive tech or the keyboard -- Space still toggles it, the label still
// targets it, and `getByLabelText` still finds it. A div with role="switch"
// would have meant reimplementing all of that by hand, worse.
//
// Visually hidden via clip rather than `display: none` or `visibility: hidden`,
// either of which would take the input out of the focus order and make the
// control unreachable without a mouse.

export function Switch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  // The visible text beside the switch.
  label: string;
  // Overrides the accessible name when the visible label is too terse on its
  // own ("Enabled" -> "Enable Slack").
  ariaLabel?: string;
  // For a setting that is currently SETTLED by something else, so toggling it
  // would change nothing -- e.g. a per-project use switch in a project whose
  // own signal already makes the extension relevant. Shown rather than hidden
  // so the state stays legible; the caller is expected to say WHY nearby.
  disabled?: boolean;
}) {
  return (
    <label className={`switch${disabled ? " disabled" : ""}`}>
      <input
        type="checkbox"
        className="switch-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      {/* Decorative: the input above carries the state and the name. */}
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  );
}
