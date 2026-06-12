// A small right-click popover for the editor, positioned at the click. SP1 hosts
// Go to Definition (existing behavior) and Find All References; SP2-SP4 add more
// items here. Backdrop click / action click closes it.
export function EditorContextMenu({
  x,
  y,
  onDefinition,
  onReferences,
  onClose,
}: {
  x: number;
  y: number;
  onDefinition: () => void;
  onReferences: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="palette-backdrop"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className="editor-context-menu"
        role="menu"
        style={{ position: "fixed", left: x, top: y, zIndex: 51 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <button
          type="button"
          role="menuitem"
          className="editor-context-item"
          // biome-ignore lint/a11y/noAutofocus: menu takes focus on open to prevent stale-position typing
          autoFocus
          onClick={onDefinition}
        >
          Go to Definition
        </button>
        <button
          type="button"
          role="menuitem"
          className="editor-context-item"
          onClick={onReferences}
        >
          Find All References
        </button>
      </div>
    </>
  );
}
