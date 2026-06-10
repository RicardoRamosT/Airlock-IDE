import { fileIconFor } from "../lib/fileIcons";

// Per-type glyph for a FILE row/tab: a colored codicon or a VS Code-style
// two-letter badge. Unknown types render the classic generic file icon, in
// the same 16px slot, so rows never shift.
export function FileIcon({ name }: { name: string }) {
  const fi = fileIconFor(name);
  if (fi.kind === "badge") {
    return (
      <span className="file-icon-badge" style={{ color: fi.color }} aria-hidden>
        {fi.text}
      </span>
    );
  }
  return (
    <i
      className={`codicon codicon-${fi.icon}`}
      style={fi.color ? { color: fi.color } : undefined}
    />
  );
}
